/**
 * firmwareChecker.ts — Firmware Version & Update Detection Service
 *
 * Detects firmware versions for all storage devices and flags potential
 * firmware issues. NEVER auto-flashes firmware — only provides recommendations.
 *
 * Windows: PowerShell Get-PhysicalDisk, Get-PnpDevice, WMIC
 * macOS:   system_profiler, diskutil, ioreg
 */

import { execSync } from 'child_process'
import os from 'os'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { PowerShellHost } from './psHost'

// ── Logging ───────────────────────────────────────────────────────────────────
const logPath = path.join(app.getPath('userData'), 'drivewatch_logs.txt')
function log(msg: string): void {
  const ts = new Date().toISOString()
  try { fs.appendFileSync(logPath, `[${ts}] [FirmwareChecker] ${msg}\n`) } catch { /* */ }
}

const psHost = PowerShellHost.getInstance('diagnostics')

async function runPS(script: string, timeoutMs = 15000): Promise<string> {
  const result = await psHost.execute(script, timeoutMs)
  return result.trim()
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface FirmwareInfo {
  diskIndex: number
  model: string
  serial: string
  firmwareVersion: string
  firmwareDate: string | null
  interfaceType: 'NVMe' | 'SATA' | 'USB' | 'SCSI' | 'Unknown'
  isGenericFirmware: boolean
  updateAvailable: boolean
  updateRecommendation: string | null
  manufacturerUrl: string | null
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  issues: string[]
}

// ── Known firmware issue patterns ─────────────────────────────────────────────
const KNOWN_PROBLEMATIC_FIRMWARE: Record<string, { pattern: RegExp; message: string; url: string }[]> = {
  samsung: [
    { pattern: /GXA7[0-3]/i, message: 'Early firmware for Samsung 980 PRO — known to cause performance degradation over time.', url: 'https://semiconductor.samsung.com/consumer-storage/support/tools/' },
  ],
  crucial: [
    { pattern: /M3CR01[0-2]/i, message: 'Early Crucial MX500 firmware — update available with improved reliability.', url: 'https://www.crucial.com/support/storage-executive' },
  ],
  western: [
    { pattern: /111110WD/i, message: 'WD firmware flagged for potential TRIM issues on older drives.', url: 'https://support-en.wd.com/app/answers/detailweb/a_id/10063' },
  ],
  kingston: [
    { pattern: /SBFK[0-5]/i, message: 'Kingston firmware update available for improved power management.', url: 'https://www.kingston.com/en/support/technical/ssdmanager' },
  ],
}

// ── Manufacturer URL lookup ──────────────────────────────────────────────────
function getManufacturerUrl(model: string): string | null {
  const m = model.toLowerCase()
  if (m.includes('samsung')) return 'https://semiconductor.samsung.com/consumer-storage/support/tools/'
  if (m.includes('crucial') || m.includes('micron')) return 'https://www.crucial.com/support/storage-executive'
  if (m.includes('western') || m.includes('wd') || m.includes('sandisk')) return 'https://support-en.wd.com/'
  if (m.includes('seagate')) return 'https://www.seagate.com/support/downloads/seagate-seatools/'
  if (m.includes('kingston')) return 'https://www.kingston.com/en/support/technical/ssdmanager'
  if (m.includes('intel')) return 'https://www.intel.com/content/www/us/en/support/articles/000005969/memory-and-storage.html'
  if (m.includes('sk hynix') || m.includes('hynix')) return 'https://ssd.skhynix.com/'
  if (m.includes('toshiba') || m.includes('kioxia')) return 'https://personal.kioxia.com/en-apac/top.html'
  return null
}

// ── Windows Implementation ────────────────────────────────────────────────────
async function checkFirmwareWindows(): Promise<FirmwareInfo[]> {
  const results: FirmwareInfo[] = []

  try {
    const script = `
try {
  $disks = Get-PhysicalDisk -ErrorAction SilentlyContinue
  $wmiDisks = Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue
  $output = @()
  foreach ($d in $disks) {
    $fw = $d.FirmwareRevision
    if (-not $fw) {
      $wmiDisk = $wmiDisks | Where-Object { $_.Index -eq [int]$d.DeviceId }
      if ($wmiDisk) { $fw = $wmiDisk.FirmwareRevision }
    }
    $output += @{
      DeviceId = $d.DeviceId
      Model = $d.FriendlyName
      Serial = $d.SerialNumber
      Firmware = $fw
      MediaType = "$($d.MediaType)"
      BusType = "$($d.BusType)"
      HealthStatus = "$($d.HealthStatus)"
    }
  }
  $output | ConvertTo-Json -Compress
} catch {
  Write-Output '[]'
}
`
    const raw = await runPS(script, 20000)
    log(`Firmware raw output (${raw.length} chars): ${raw.substring(0, 300)}`)

    if (!raw || raw === '[]') return results

    let parsed: any[] = []
    try {
      const data = JSON.parse(raw)
      parsed = Array.isArray(data) ? data : [data]
    } catch {
      log(`Failed to parse firmware data: ${raw.substring(0, 200)}`)
      return results
    }

    for (const disk of parsed) {
      const model = (disk.Model || 'Unknown').trim()
      const serial = (disk.Serial || '').trim()
      const fw = (disk.Firmware || '').trim()
      const busType = (disk.BusType || '').toUpperCase()

      let interfaceType: FirmwareInfo['interfaceType'] = 'Unknown'
      if (busType === 'NVME' || busType.includes('NVM')) interfaceType = 'NVMe'
      else if (busType === 'SATA' || busType === 'ATA') interfaceType = 'SATA'
      else if (busType === 'USB') interfaceType = 'USB'
      else if (busType === 'SCSI' || busType === 'SAS') interfaceType = 'SCSI'

      const issues: string[] = []
      let severity: FirmwareInfo['severity'] = 'info'
      let updateAvailable = false
      let updateRecommendation: string | null = null

      // Check for empty firmware
      if (!fw || fw === '0' || fw === 'N/A') {
        issues.push('Firmware version could not be read — may indicate a driver or compatibility issue.')
        severity = 'medium'
      }

      // Check known problematic firmware
      const modelLower = model.toLowerCase()
      for (const [manufacturer, patterns] of Object.entries(KNOWN_PROBLEMATIC_FIRMWARE)) {
        if (modelLower.includes(manufacturer)) {
          for (const entry of patterns) {
            if (entry.pattern.test(fw)) {
              issues.push(entry.message)
              updateAvailable = true
              updateRecommendation = `Visit manufacturer's tool to check for firmware updates.`
              severity = 'high'
            }
          }
        }
      }

      const isGenericFirmware = /^[0-9.]+$/.test(fw) && fw.length <= 4

      results.push({
        diskIndex: parseInt(disk.DeviceId) || 0,
        model,
        serial,
        firmwareVersion: fw || 'Unknown',
        firmwareDate: null,
        interfaceType,
        isGenericFirmware,
        updateAvailable,
        updateRecommendation,
        manufacturerUrl: getManufacturerUrl(model),
        severity,
        issues
      })
    }
  } catch (err: any) {
    log(`Firmware check failed: ${err.message}`)
  }

  return results
}

// ── macOS Implementation ──────────────────────────────────────────────────────
async function checkFirmwareMacOS(): Promise<FirmwareInfo[]> {
  const results: FirmwareInfo[] = []

  try {
    const raw = execSync('system_profiler SPNVMeDataType SPSerialATADataType -json 2>/dev/null', {
      timeout: 15000,
      encoding: 'utf8'
    }).trim()

    const parsed = JSON.parse(raw)
    let diskIndex = 0

    const nvmeItems = parsed?.SPNVMeDataType || []
    for (const controller of nvmeItems) {
      const items = controller?._items || [controller]
      for (const item of items) {
        results.push({
          diskIndex: diskIndex++,
          model: item.device_name || item._name || 'Unknown',
          serial: item.device_serial || '',
          firmwareVersion: item.device_revision || 'Unknown',
          firmwareDate: null,
          interfaceType: 'NVMe',
          isGenericFirmware: false,
          updateAvailable: false,
          updateRecommendation: null,
          manufacturerUrl: getManufacturerUrl(item.device_name || ''),
          severity: 'info',
          issues: []
        })
      }
    }

    const sataItems = parsed?.SPSerialATADataType || []
    for (const controller of sataItems) {
      const items = controller?._items || [controller]
      for (const item of items) {
        if (item.device_name) {
          results.push({
            diskIndex: diskIndex++,
            model: item.device_name,
            serial: item.device_serial || '',
            firmwareVersion: item.device_revision || 'Unknown',
            firmwareDate: null,
            interfaceType: 'SATA',
            isGenericFirmware: false,
            updateAvailable: false,
            updateRecommendation: null,
            manufacturerUrl: getManufacturerUrl(item.device_name),
            severity: 'info',
            issues: []
          })
        }
      }
    }
  } catch (err: any) {
    log(`macOS firmware check failed: ${err.message}`)
  }

  return results
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function checkFirmware(): Promise<FirmwareInfo[]> {
  const platform = os.platform()
  if (platform === 'win32') return checkFirmwareWindows()
  if (platform === 'darwin') return checkFirmwareMacOS()
  return []
}
