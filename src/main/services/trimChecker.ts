/**
 * trimChecker.ts — TRIM Status Detection Service
 *
 * Detects TRIM/UNMAP support and enablement status for SSDs.
 * NEVER modifies TRIM settings — only reports status.
 *
 * Windows: fsutil behavior query DisableDeleteNotify, Get-PhysicalDisk
 * macOS:   system_profiler SPNVMeDataType, diskutil info
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
  try { fs.appendFileSync(logPath, `[${ts}] [TrimChecker] ${msg}\n`) } catch { /* */ }
}

const psHost = PowerShellHost.getInstance('diagnostics')

async function runPS(script: string, timeoutMs = 15000): Promise<string> {
  const result = await psHost.execute(script, timeoutMs)
  return result.trim()
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface TrimStatus {
  diskIndex: number
  model: string
  isSSD: boolean
  trimSupported: boolean
  trimEnabled: boolean
  fileSystem: string
  issues: string[]
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  recommendation: string | null
}

// ── Windows Implementation ────────────────────────────────────────────────────
async function checkTrimWindows(): Promise<TrimStatus[]> {
  const results: TrimStatus[] = []

  try {
    const script = `
try {
  $disks = Get-PhysicalDisk -ErrorAction SilentlyContinue | Select-Object DeviceId, FriendlyName, MediaType, BusType
  $trimRaw = & fsutil behavior query DisableDeleteNotify 2>&1
  $trimLine = "$trimRaw"
  $trimDisabled = $trimLine -match '= 1'
  $vols = Get-Volume -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter -and $_.DriveLetter -ne [char]0 } | Select-Object DriveLetter, FileSystemType -First 1
  $fs = if ($vols) { "$($vols.FileSystemType)" } else { "Unknown" }

  $output = @()
  foreach ($d in $disks) {
    $media = "$($d.MediaType)".ToUpper()
    $bus = "$($d.BusType)".ToUpper()
    $name = "$($d.FriendlyName)".ToUpper()
    $isSSD = ($media -eq 'SSD') -or ($bus -eq 'NVME') -or ($name -match 'SSD|NVME')
    $output += @{
      DeviceId = "$($d.DeviceId)"
      Model = "$($d.FriendlyName)"
      IsSSD = $isSSD
      TrimDisabled = $trimDisabled
      FileSystem = $fs
    }
  }
  $output | ConvertTo-Json -Compress
} catch {
  Write-Output '[]'
}
`
    const raw = await runPS(script, 15000)
    log(`TRIM raw output (${raw.length} chars): ${raw.substring(0, 300)}`)

    if (!raw || raw === '[]') return results

    let parsed: any[] = []
    try {
      const data = JSON.parse(raw)
      parsed = Array.isArray(data) ? data : [data]
    } catch {
      log(`Failed to parse TRIM data: ${raw.substring(0, 200)}`)
      return results
    }

    for (const disk of parsed) {
      const model = (disk.Model || 'Unknown').trim()
      const isSSD = disk.IsSSD === true
      const trimDisabled = disk.TrimDisabled === true
      const fileSystem = (disk.FileSystem || 'Unknown').trim()

      const issues: string[] = []
      let severity: TrimStatus['severity'] = 'info'
      let recommendation: string | null = null

      const trimEnabled = isSSD ? !trimDisabled : false

      if (isSSD && trimDisabled) {
        issues.push('TRIM is disabled — this can reduce SSD performance and lifespan over time.')
        severity = 'high'
        recommendation = 'Enable TRIM by running "fsutil behavior set DisableDeleteNotify 0" in an elevated command prompt.'
      }

      results.push({
        diskIndex: parseInt(disk.DeviceId) || 0,
        model,
        isSSD,
        trimSupported: isSSD,
        trimEnabled,
        fileSystem,
        issues,
        severity,
        recommendation
      })
    }
  } catch (err: any) {
    log(`TRIM check failed: ${err.message}`)
  }

  return results
}

// ── macOS Implementation ──────────────────────────────────────────────────────
async function checkTrimMacOS(): Promise<TrimStatus[]> {
  const results: TrimStatus[] = []

  try {
    const raw = execSync('system_profiler SPNVMeDataType SPSerialATADataType -json 2>/dev/null', {
      timeout: 15000, encoding: 'utf8'
    }).trim()

    const parsed = JSON.parse(raw)
    let diskIndex = 0

    const nvmeItems = parsed?.SPNVMeDataType || []
    for (const controller of nvmeItems) {
      const items = controller?._items || [controller]
      for (const item of items) {
        const trimSupport = item.spnvme_trim_support || 'Unknown'
        const isEnabled = trimSupport.toLowerCase() === 'yes'
        results.push({
          diskIndex: diskIndex++,
          model: item.device_name || item._name || 'Unknown',
          isSSD: true, trimSupported: true, trimEnabled: isEnabled,
          fileSystem: 'APFS',
          issues: isEnabled ? [] : ['TRIM may not be enabled on this NVMe device.'],
          severity: isEnabled ? 'info' : 'medium',
          recommendation: isEnabled ? null : 'TRIM should be enabled for optimal SSD performance.'
        })
      }
    }

    const sataItems = parsed?.SPSerialATADataType || []
    for (const controller of sataItems) {
      const items = controller?._items || [controller]
      for (const item of items) {
        if (item.device_name) {
          const isSSD = (item.spsata_medium_type || '').toLowerCase().includes('solid')
          const isEnabled = (item.spsata_trim_support || '').toLowerCase() === 'yes'
          results.push({
            diskIndex: diskIndex++,
            model: item.device_name, isSSD, trimSupported: isSSD, trimEnabled: isEnabled,
            fileSystem: 'APFS',
            issues: (isSSD && !isEnabled) ? ['TRIM not enabled for third-party SSD.'] : [],
            severity: (isSSD && !isEnabled) ? 'medium' : 'info',
            recommendation: (isSSD && !isEnabled) ? 'Enable TRIM using "sudo trimforce enable" in Terminal.' : null
          })
        }
      }
    }
  } catch (err: any) {
    log(`macOS TRIM check failed: ${err.message}`)
  }

  return results
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function checkTrim(): Promise<TrimStatus[]> {
  const platform = os.platform()
  if (platform === 'win32') return checkTrimWindows()
  if (platform === 'darwin') return checkTrimMacOS()
  return []
}
