/**
 * controllerChecker.ts — NVMe/SATA Controller & PCIe Link Detection
 *
 * Detects storage controller issues, PCIe generation/link width mismatches,
 * and interface speed limitations.
 *
 * Windows: Get-PhysicalDisk, Get-PnpDevice
 * macOS:   system_profiler, ioreg
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
  try { fs.appendFileSync(logPath, `[${ts}] [ControllerChecker] ${msg}\n`) } catch { /* */ }
}

const psHost = PowerShellHost.getInstance('diagnostics')

async function runPS(script: string, timeoutMs = 15000): Promise<string> {
  const result = await psHost.execute(script, timeoutMs)
  return result.trim()
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ControllerInfo {
  diskIndex: number
  model: string
  controllerName: string
  interfaceType: 'NVMe' | 'SATA' | 'USB' | 'SCSI' | 'Unknown'
  pcieGeneration: string | null
  pcieLinkWidth: string | null
  pcieMaxSpeed: string | null
  pcieCurrentSpeed: string | null
  isBandwidthLimited: boolean
  queueDepth: number | null
  issues: string[]
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  recommendation: string | null
}

// ── Windows Implementation ────────────────────────────────────────────────────
async function checkControllersWindows(): Promise<ControllerInfo[]> {
  const results: ControllerInfo[] = []

  try {
    const script = `
try {
  $physDisks = Get-PhysicalDisk -ErrorAction SilentlyContinue | Select-Object DeviceId, FriendlyName, MediaType, BusType
  $controllers = Get-PnpDevice -Class 'SCSIAdapter' -ErrorAction SilentlyContinue | Select-Object InstanceId, FriendlyName, Status

  $output = @{
    disks = @($physDisks | ForEach-Object {
      @{ DeviceId = "$($_.DeviceId)"; Name = "$($_.FriendlyName)"; Media = "$($_.MediaType)"; Bus = "$($_.BusType)" }
    })
    controllers = @($controllers | ForEach-Object {
      @{ Id = "$($_.InstanceId)"; Name = "$($_.FriendlyName)"; Status = "$($_.Status)" }
    })
  }
  $output | ConvertTo-Json -Compress -Depth 3
} catch {
  Write-Output '{"disks":[],"controllers":[]}'
}
`
    const raw = await runPS(script, 20000)
    log(`Controller raw output (${raw.length} chars): ${raw.substring(0, 300)}`)

    let parsed: any = { disks: [], controllers: [] }
    try {
      if (raw) parsed = JSON.parse(raw)
    } catch {
      log(`Failed to parse controller data: ${raw.substring(0, 200)}`)
      return results
    }

    const disks = Array.isArray(parsed.disks) ? parsed.disks : [parsed.disks].filter(Boolean)
    const controllers = Array.isArray(parsed.controllers) ? parsed.controllers : [parsed.controllers].filter(Boolean)

    // Find NVMe controllers specifically
    const nvmeControllers = controllers.filter((c: any) => /NVMe|NVM Express/i.test(c.Name || ''))

    for (const disk of disks) {
      const model = (disk.Name || 'Unknown').trim()
      const busType = (disk.Bus || '').toUpperCase()
      const diskIdx = parseInt(disk.DeviceId) || 0

      let interfaceType: ControllerInfo['interfaceType'] = 'Unknown'
      if (busType === 'NVME' || busType.includes('NVM')) interfaceType = 'NVMe'
      else if (busType === 'SATA' || busType === 'ATA') interfaceType = 'SATA'
      else if (busType === 'USB') interfaceType = 'USB'
      else if (busType === 'SCSI' || busType === 'SAS') interfaceType = 'SCSI'

      const issues: string[] = []
      let severity: ControllerInfo['severity'] = 'info'
      let recommendation: string | null = null

      let controllerName = 'System Default'
      const matchedNvme = nvmeControllers[0]
      if (interfaceType === 'NVMe' && matchedNvme) {
        controllerName = matchedNvme.Name
        if (matchedNvme.Status && matchedNvme.Status !== 'OK') {
          issues.push(`NVMe controller status: ${matchedNvme.Status}`)
          severity = 'high'
        }
        if (/standard\s+nvm/i.test(controllerName)) {
          issues.push('Using generic Windows NVMe driver — manufacturer driver may be faster.')
          if (severity === 'info') severity = 'low'
          recommendation = 'Consider installing the manufacturer-specific NVMe driver.'
        }
      } else if (controllers.length > 0) {
        controllerName = controllers[0].Name || 'Standard AHCI Controller'
      }

      // SATA bottleneck for SSDs
      if (interfaceType === 'SATA' && (disk.Media || '').toUpperCase() === 'SSD') {
        issues.push('SSD on SATA interface — limited to ~550 MB/s. NVMe can provide 3-7x faster speeds.')
        if (severity === 'info') severity = 'low'
      }

      if (interfaceType === 'USB') {
        issues.push('Drive connected via USB — performance limited by USB interface.')
        if (severity === 'info') severity = 'low'
      }

      results.push({
        diskIndex: diskIdx,
        model,
        controllerName,
        interfaceType,
        pcieGeneration: null,
        pcieLinkWidth: null,
        pcieMaxSpeed: null,
        pcieCurrentSpeed: null,
        isBandwidthLimited: false,
        queueDepth: null,
        issues,
        severity,
        recommendation
      })
    }
  } catch (err: any) {
    log(`Controller check failed: ${err.message}`)
  }

  return results
}

// ── macOS Implementation ──────────────────────────────────────────────────────
async function checkControllersMacOS(): Promise<ControllerInfo[]> {
  const results: ControllerInfo[] = []

  try {
    const raw = execSync('system_profiler SPNVMeDataType SPSerialATADataType -json 2>/dev/null', {
      timeout: 15000, encoding: 'utf8'
    }).trim()

    const parsed = JSON.parse(raw)
    let diskIndex = 0

    const nvmeItems = parsed?.SPNVMeDataType || []
    for (const controller of nvmeItems) {
      const controllerName = controller._name || 'NVMe Controller'
      const items = controller?._items || [controller]
      for (const item of items) {
        results.push({
          diskIndex: diskIndex++, model: item.device_name || 'Unknown',
          controllerName, interfaceType: 'NVMe',
          pcieGeneration: item.spnvme_linkspeed || null,
          pcieLinkWidth: item.spnvme_linkwidth || null,
          pcieMaxSpeed: item.spnvme_linkspeed || null,
          pcieCurrentSpeed: item.spnvme_linkspeed || null,
          isBandwidthLimited: false, queueDepth: null,
          issues: [], severity: 'info', recommendation: null
        })
      }
    }

    const sataItems = parsed?.SPSerialATADataType || []
    for (const controller of sataItems) {
      const controllerName = controller._name || 'SATA Controller'
      const items = controller?._items || [controller]
      for (const item of items) {
        if (item.device_name) {
          results.push({
            diskIndex: diskIndex++, model: item.device_name,
            controllerName, interfaceType: 'SATA',
            pcieGeneration: null, pcieLinkWidth: null,
            pcieMaxSpeed: null, pcieCurrentSpeed: item.spsata_negotiatedlinkspeed || null,
            isBandwidthLimited: false, queueDepth: null,
            issues: [], severity: 'info', recommendation: null
          })
        }
      }
    }
  } catch (err: any) {
    log(`macOS controller check failed: ${err.message}`)
  }

  return results
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function checkControllers(): Promise<ControllerInfo[]> {
  const platform = os.platform()
  if (platform === 'win32') return checkControllersWindows()
  if (platform === 'darwin') return checkControllersMacOS()
  return []
}
