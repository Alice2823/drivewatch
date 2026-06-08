/**
 * driverChecker.ts — Storage Driver Health Detection Service
 *
 * Detects outdated, generic, or problematic storage drivers.
 * NEVER auto-installs drivers — only provides recommendations.
 *
 * Windows: Get-PnpDevice, driverquery, Event Viewer
 * macOS:   ioreg, kextstat
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
  try { fs.appendFileSync(logPath, `[${ts}] [DriverChecker] ${msg}\n`) } catch { /* */ }
}

const psHost = PowerShellHost.getInstance('diagnostics')

async function runPS(script: string, timeoutMs = 15000): Promise<string> {
  const result = await psHost.execute(script, timeoutMs)
  return result.trim()
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface DriverInfo {
  deviceName: string
  driverProvider: string
  driverVersion: string
  driverDate: string
  isGenericDriver: boolean
  hasWarning: boolean
  hasError: boolean
  deviceStatus: string
  problemCode: number | null
  issues: string[]
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  recommendation: string | null
  updateUrl: string | null
}

export interface EventLogEntry {
  timeCreated: string
  source: string
  eventId: number
  level: string
  message: string
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
}

// ── Generic NVMe driver detection ─────────────────────────────────────────────
// Only NVMe generic drivers are worth flagging — SATA AHCI and Storage Spaces
// are the CORRECT standard drivers on most Windows systems.
const GENERIC_NVME_PATTERNS = [
  /standard\s+nvm\s*e?\s+express/i,
]

// ── Manufacturer-specific driver download URLs ───────────────────────────────
function getDriverDownloadUrl(model: string): string | null {
  const m = model.toLowerCase()
  if (m.includes('samsung')) return 'https://semiconductor.samsung.com/consumer-storage/support/tools/'
  if (m.includes('intel')) return 'https://www.intel.com/content/www/us/en/download/720755/intel-rapid-storage-technology-driver.html'
  if (m.includes('amd')) return 'https://www.amd.com/en/support'
  return null
}

// ── Windows Implementation ────────────────────────────────────────────────────
async function checkDriversWindows(): Promise<{ drivers: DriverInfo[]; events: EventLogEntry[] }> {
  const drivers: DriverInfo[] = []
  const events: EventLogEntry[] = []

  // 1. Storage controller drivers
  try {
    const script = `
try {
  $storageDevices = Get-PnpDevice -Class 'DiskDrive','SCSIAdapter','hdc' -ErrorAction SilentlyContinue | Select-Object InstanceId, FriendlyName, Status, Problem, Class
  $output = @()
  foreach ($dev in $storageDevices) {
    $provider = ''
    $version = ''
    $dateStr = ''
    try {
      $drvInfo = Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName 'DEVPKEY_Device_DriverProvider','DEVPKEY_Device_DriverVersion','DEVPKEY_Device_DriverDate' -ErrorAction SilentlyContinue
      $provider = ($drvInfo | Where-Object { $_.KeyName -eq 'DEVPKEY_Device_DriverProvider' }).Data
      $version = ($drvInfo | Where-Object { $_.KeyName -eq 'DEVPKEY_Device_DriverVersion' }).Data
      $rawDate = ($drvInfo | Where-Object { $_.KeyName -eq 'DEVPKEY_Device_DriverDate' }).Data
      if ($rawDate) { $dateStr = $rawDate.ToString('yyyy-MM-dd') }
    } catch { }
    $output += @{
      Name = "$($dev.FriendlyName)"
      Status = "$($dev.Status)"
      Problem = $dev.Problem
      Provider = "$provider"
      Version = "$version"
      Date = "$dateStr"
    }
  }
  $output | ConvertTo-Json -Compress
} catch {
  Write-Output '[]'
}
`
    const raw = await runPS(script, 25000)
    log(`Driver raw output (${raw.length} chars): ${raw.substring(0, 300)}`)

    let parsed: any[] = []
    try {
      if (raw && raw !== '[]') {
        const data = JSON.parse(raw)
        parsed = Array.isArray(data) ? data : [data]
      }
    } catch {
      log(`Failed to parse driver data: ${raw.substring(0, 200)}`)
    }

    for (const dev of parsed) {
      const name = (dev.Name || 'Unknown Device').trim()
      const provider = (dev.Provider || 'Unknown').trim()
      const version = (dev.Version || 'Unknown').trim()
      const dateStr = (dev.Date || 'Unknown').trim()
      const status = (dev.Status || 'Unknown').trim()
      const problemCode = dev.Problem !== undefined && dev.Problem !== null ? Number(dev.Problem) : null

      const issues: string[] = []
      let severity: DriverInfo['severity'] = 'info'
      let recommendation: string | null = null

      // Only flag generic NVMe drivers — SATA AHCI / Storage Spaces are standard & correct
      const isGeneric = GENERIC_NVME_PATTERNS.some(p => p.test(name)) ||
        (provider.toLowerCase().includes('microsoft') && name.toLowerCase().includes('nvme'))

      if (isGeneric) {
        issues.push('Using generic Windows NVMe driver. The manufacturer driver may offer slightly better performance.')
        severity = 'low'
        recommendation = 'Consider installing the manufacturer-specific NVMe driver.'
      }

      const hasWarning = status === 'Degraded' || status === 'Warning'
      const hasError = status === 'Error' || status === 'Unknown'

      if (hasError && status === 'Error') {
        issues.push(`Device is reporting error status. Check Device Manager.`)
        // Only escalate to critical if it's NOT a generic driver warning
        if (!isGeneric) severity = 'critical'
        recommendation = 'Check Device Manager for error details.'
      } else if (hasWarning) {
        issues.push(`Device is in a degraded state: ${status}.`)
        if (!isGeneric) severity = 'high'
        recommendation = 'Update the driver to the latest version.'
      }

      if (problemCode && problemCode > 0) {
        // Code 45 = "Currently, this hardware device is not connected to the computer"
        // This is a phantom/disconnected device entry — informational only, not a real failure
        if (problemCode === 45) {
          issues.push(`Device Manager Code 45: device not currently connected (phantom entry — informational).`)
          if (severity === 'info') severity = 'info'  // do NOT escalate
        } else {
          issues.push(`Device Manager problem code ${problemCode}.`)
          if (severity === 'info') severity = 'medium'
        }
      }

      if (dateStr && dateStr !== 'Unknown' && dateStr.length >= 10) {
        try {
          const driverDate = new Date(dateStr)
          const twoYearsAgo = new Date()
          twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
          if (driverDate < twoYearsAgo) {
            issues.push(`Driver is from ${dateStr} — over 2 years old.`)
            if (severity === 'info') severity = 'low'
          }
        } catch { /* invalid date */ }
      }

      drivers.push({
        deviceName: name,
        driverProvider: provider,
        driverVersion: version,
        driverDate: dateStr,
        isGenericDriver: isGeneric,
        hasWarning,
        hasError: hasError && status === 'Error',
        deviceStatus: status,
        problemCode,
        issues,
        severity,
        recommendation,
        updateUrl: getDriverDownloadUrl(name)
      })
    }
  } catch (err: any) {
    log(`Driver check failed: ${err.message}`)
  }

  // 2. Disk-related Event Viewer errors (last 48 hours)
  try {
    const eventScript = `
try {
  $cutoff = (Get-Date).AddHours(-48)
  $events = Get-WinEvent -FilterHashtable @{ LogName='System'; ProviderName='disk','ntfs','storahci','stornvme','partmgr'; Level=1,2,3; StartTime=$cutoff } -MaxEvents 15 -ErrorAction SilentlyContinue
  $output = @()
  foreach ($e in $events) {
    $msg = "$($e.Message)"
    if ($msg.Length -gt 250) { $msg = $msg.Substring(0,250) }
    $output += @{
      Time = $e.TimeCreated.ToString('o')
      Source = "$($e.ProviderName)"
      Id = $e.Id
      Level = "$($e.LevelDisplayName)"
      Msg = $msg
    }
  }
  $output | ConvertTo-Json -Compress
} catch {
  Write-Output '[]'
}
`
    const raw = await runPS(eventScript, 15000)

    let parsed: any[] = []
    try {
      if (raw && raw !== '[]') {
        const data = JSON.parse(raw)
        parsed = Array.isArray(data) ? data : [data]
      }
    } catch { /* */ }

    for (const evt of parsed) {
      if (!evt.Source) continue
      const level = (evt.Level || '').toLowerCase()
      const eventId = evt.Id || 0
      const message = (evt.Msg || '').toLowerCase()

      let severity: EventLogEntry['severity'] = 'info'

      // ── Classify by event ID first (most accurate) ──────────────────────────
      // Event 51  = "An error was detected on device ... during a paging operation"
      //             This is NORMAL on Windows when the system pages to/from disk.
      //             It only becomes concerning if it happens hundreds of times/hour.
      // Event 153 = "The IO operation at logical block address ... was retried"
      //             Single retries are normal; repeated retries indicate a problem.
      // Event 129 = StorPort reset — can be normal during heavy I/O
      // Event 11  = Controller error — more serious
      if (eventId === 51 || eventId === 153 || eventId === 129) {
        severity = 'low'   // informational — not a real failure
      } else if (eventId === 11 || eventId === 15) {
        severity = 'high'  // controller error / device not ready
      } else if (level.includes('critical')) {
        severity = 'critical'
      } else if (level.includes('error')) {
        // Generic error — check message for paging keywords before escalating
        if (message.includes('paging') || message.includes('retried') || message.includes('reset')) {
          severity = 'low'
        } else {
          severity = 'high'
        }
      } else if (level.includes('warning')) {
        severity = 'medium'
      }

      events.push({
        timeCreated: evt.Time || '',
        source: evt.Source || '',
        eventId,
        level: evt.Level || 'Unknown',
        message: (evt.Msg || '').trim(),
        severity
      })
    }
  } catch (err: any) {
    log(`Event log check failed: ${err.message}`)
  }

  return { drivers, events }
}

// ── macOS Implementation ──────────────────────────────────────────────────────
async function checkDriversMacOS(): Promise<{ drivers: DriverInfo[]; events: EventLogEntry[] }> {
  const drivers: DriverInfo[] = []

  try {
    const kextRaw = execSync('kextstat 2>/dev/null | grep -i -E "IOStorage|AHCI|NVMe|APFS|IOBlockStorage"', {
      timeout: 8000, encoding: 'utf8'
    }).trim()

    for (const line of kextRaw.split('\n')) {
      if (!line.trim()) continue
      const parts = line.trim().split(/\s+/)
      const kextName = parts.find(p => p.includes('.')) || 'Unknown'
      const version = parts.find(p => /^\d+\.\d+/.test(p)) || 'Unknown'

      drivers.push({
        deviceName: kextName, driverProvider: 'Apple', driverVersion: version,
        driverDate: 'System', isGenericDriver: false, hasWarning: false, hasError: false,
        deviceStatus: 'OK', problemCode: null, issues: [], severity: 'info',
        recommendation: null, updateUrl: null
      })
    }
  } catch (err: any) {
    log(`macOS driver check failed: ${err.message}`)
  }

  return { drivers, events: [] }
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function checkDrivers(): Promise<{ drivers: DriverInfo[]; events: EventLogEntry[] }> {
  const platform = os.platform()
  if (platform === 'win32') return checkDriversWindows()
  if (platform === 'darwin') return checkDriversMacOS()
  return { drivers: [], events: [] }
}
