import { app } from 'electron'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

export interface DiskData {
  id: string
  name: string
  type: string
  size: number
  used: number
  free: number
  temperature: number | null
  health: 'Good' | 'Warning' | 'Critical' | 'Unknown'
  readSpeed: number
  writeSpeed: number
  usagePercent?: number
  serial?: string
  vendor?: string
  firmware?: string
  mounts?: string[]
  diskIndex: number
  stale?: boolean
  isRemovable?: boolean
}


// ── Logging ──────────────────────────────────────────────────────────────────
const logPath = path.join(app.getPath('userData'), 'drivewatch_logs.txt')
function log(msg: string): void {
  const ts = new Date().toISOString()
  try { fs.appendFileSync(logPath, `[${ts}] ${msg}\n`) } catch { /* */ }
  console.log(msg)
}
if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '--- DriveWatch Logs ---\n')

import { PowerShellHost } from './psHost'
import { getThermalData } from './thermalService'

const psHost = PowerShellHost.getInstance()

async function runPS(scriptName: string, scriptBody: string, timeoutMs = 6000): Promise<string> {
  const result = await psHost.execute(scriptBody, timeoutMs)
  return result.trim()
}


// ── Typeperf Real-time IO Stream ─────────────────────────────────────────────
// Runs as its OWN dedicated child process — never competes with psHost queue.
// liveIO key = disk index as string ("0", "1", …)
let liveIO: Record<string, { r: number; w: number; usage: number }> = {}
let typeperfProcess: ChildProcessWithoutNullStreams | null = null
let typeperfHeaders: string[] = []
let isMonitoringEnabled = true
let monitoringRestartTimeout: NodeJS.Timeout | null = null

export function stopMonitoring(): void {
  log('[DiskService] Stopping all internal monitoring processes')
  isMonitoringEnabled = false
  if (monitoringRestartTimeout) {
    clearTimeout(monitoringRestartTimeout)
    monitoringRestartTimeout = null
  }
  if (typeperfProcess) {
    typeperfProcess.kill()
    typeperfProcess = null
  }
}

export function resumeMonitoring(): void {
  log('[DiskService] Resuming internal monitoring')
  isMonitoringEnabled = true
  startTypeperfStream()
}

function startTypeperfStream(): void {
  if (typeperfProcess || !isMonitoringEnabled) return
  log('[Typeperf] Starting stream with Read/Write/DiskTime...')

  typeperfProcess = spawn('typeperf', [
    '\\PhysicalDisk(*)\\Disk Read Bytes/sec',
    '\\PhysicalDisk(*)\\Disk Write Bytes/sec',
    '\\PhysicalDisk(*)\\% Disk Time',
    '-si', '1'
  ], { windowsHide: true })

  let buffer = ''

  typeperfProcess.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // keep incomplete last line

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue

      // Header line
      if (line.includes('PhysicalDisk')) {
        typeperfHeaders = line.split(',').map((h) => h.replace(/"/g, '').trim())
        log(`[Typeperf] Headers: ${typeperfHeaders.length} columns detected`)
        continue
      }

      // Data line — starts with a timestamp
      if (!typeperfHeaders.length || !line.includes(',')) continue

      const parts = line.split(',').map((p) => p.replace(/"/g, '').trim())
      if (parts.length < 2) continue

      // Debug: log raw data line
      log(`[Typeperf] Data: parts=${parts.length}, first=${parts[0]}, liveIO keys=${Object.keys(liveIO).join(',')}`)

      for (let i = 1; i < parts.length; i++) {
        const header = typeperfHeaders[i]
        if (!header) continue

        // Extract disk index — skip _Total
        const match = header.match(/PhysicalDisk\((\d+)[^)]*\)/)
        if (!match) continue

        const diskIdx = match[1]
        if (!liveIO[diskIdx]) liveIO[diskIdx] = { r: 0, w: 0, usage: 0 }

        const val = parseFloat(parts[i]) || 0

        if (header.includes('Read')) {
          liveIO[diskIdx].r = val / 1_048_576
        } else if (header.includes('Write')) {
          liveIO[diskIdx].w = val / 1_048_576
        } else if (header.includes('Disk Time') || header.includes('% Disk')) {
          liveIO[diskIdx].usage = Math.min(100, Math.max(0, val))
        }
      }
    }
  })

  typeperfProcess.stderr.on('data', (chunk: Buffer) => {
    log(`[Typeperf] stderr: ${chunk.toString().trim()}`)
  })

  typeperfProcess.on('error', (err) => {
    log(`[Typeperf] Error: ${err.message}`)
    typeperfProcess = null
  })

  typeperfProcess.on('exit', (code) => {
    log(`[Typeperf] Exited with code ${code}.`)
    typeperfProcess = null
    if (isMonitoringEnabled) {
      monitoringRestartTimeout = setTimeout(startTypeperfStream, 3000)
    }
  })
}

startTypeperfStream()

// ── Disk Enumeration via PowerShell ──────────────────────────────────────────
interface PhysicalDisk {
  index: number
  name: string        // FriendlyName
  size: number        // bytes
  mediaType: string   // SSD / HDD / Unspecified
  busType: string     // NVMe / SATA / USB / SCSI / …
  serialNum: string
  health: string      // Healthy / Warning / Unhealthy
}

let cachedPhysical: PhysicalDisk[] = []
let cachedVolumes: any[] = []
let cachedResult: DiskData[] = []
let lastHeavy = 0
let isFetchingHeavy = false
let lastDiskCount = -1
const HEAVY_INTERVAL = 30_000

async function getFastDiskCount(): Promise<number> {
  try {
    const out = await runPS('fast_count', 'Get-CimInstance Win32_DiskDrive | Measure-Object | Select-Object -ExpandProperty Count', 2000)
    return parseInt(out) || 0
  } catch { return -1 }
}

async function refreshDiskInventory(): Promise<void> {
  const script = `
try {
  $disks = Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue | Select-Object Index, Caption, Size, InterfaceType, SerialNumber, Status
  $physDisks = Get-PhysicalDisk -ErrorAction SilentlyContinue | Select-Object DeviceId, MediaType, BusType
  $partitions = Get-Partition -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter -and $_.DriveLetter -ne [char]0 }
  $volumes = Get-Volume -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter -and $_.DriveLetter -ne [char]0 }

  $physOutput = @()
  foreach ($d in $disks) {
    $p = $physDisks | Where-Object { $_.DeviceId -eq $d.Index }
    $physOutput += @{
      index = $d.Index
      name = $d.Caption
      size = $d.Size
      mediaType = if ($p) { $p.MediaType } else { "Unspecified" }
      busType = if ($p) { $p.BusType } else { $d.InterfaceType }
      serialNum = $d.SerialNumber
      health = $d.Status
    }
  }

  $volOutput = @()
  foreach ($p in $partitions) {
    $vol = $volumes | Where-Object { $_.DriveLetter -eq $p.DriveLetter } | Select-Object -First 1
    if ($vol) {
      $volOutput += @{
        DiskNumber  = $p.DiskNumber
        DriveLetter = "$($p.DriveLetter):"
        Size        = $vol.Size
        Free        = $vol.SizeRemaining
      }
    }
  }

  @{ phys = $physOutput; vols = $volOutput } | ConvertTo-Json -Compress -Depth 3
} catch {
  Write-Output '{"phys":[], "vols":[]}'
}
`
  const out = await runPS('refresh_inventory', script, 25000)
  if (!out) return

  try {
    const parsed = JSON.parse(out)
    if (parsed.phys) {
      cachedPhysical = (Array.isArray(parsed.phys) ? parsed.phys : [parsed.phys]).map((d: any) => ({
        index: Number(d.index),
        name: (d.name || 'Unknown Disk').trim(),
        size: Number(d.size) || 0,
        mediaType: d.mediaType || 'Unspecified',
        busType: d.busType || 'Unknown',
        serialNum: (d.serialNum || '').trim(),
        health: d.health || 'Unknown'
      })).sort((a: any, b: any) => a.index - b.index)
    }
    if (parsed.vols) {
      cachedVolumes = (Array.isArray(parsed.vols) ? parsed.vols : [parsed.vols]).map((v: any) => ({
        diskIndex: parseInt(v.DiskNumber ?? '0'),
        driveLetter: v.DriveLetter || '',
        size: Number(v.Size) || 0,
        free: Number(v.Free) || 0
      })).filter((v: any) => v.driveLetter)
    }
  } catch (e: any) {
    log(`[DiskService] Inventory parse error: ${e.message}`)
  }
}

// ── Temperature via SMART/WMI ─────────────────────────────────────────────────
let cachedTemps: Record<number, number> = {}
let lastTempFetch = 0
const TEMP_INTERVAL = 2_000

async function refreshTemperatures(): Promise<void> {
  const now = Date.now()
  if (now - lastTempFetch < TEMP_INTERVAL && lastTempFetch > 0) return
  lastTempFetch = now

  // Method 1: MSStorageDriver_ATAPISmartData — reads SMART attribute 0xC2 (194 = Temperature)
  const script = `
$result = @{}
try {
  $disks = Get-PhysicalDisk
  foreach ($d in $disks) {
    $temp = (Get-StorageReliabilityCounter -PhysicalDisk $d -ErrorAction SilentlyContinue).Temperature
    if ($temp -gt 0) {
      $result[$d.DeviceId] = $temp
    }
  }
} catch { }

try {
  $smart = Get-WmiObject -Namespace root\\wmi -Class MSStorageDriver_ATAPISmartData -ErrorAction SilentlyContinue
  foreach ($s in $smart) {
    $idx = -1
    if ($s.InstanceName -match 'Disk(\\d+)') { $idx = [int]$Matches[1] }
    elseif ($s.InstanceName -match '_(\\d+)$') { $idx = [int]$Matches[1] }
    
    if ($idx -ge 0 -and (-not $result.ContainsKey("$idx"))) {
      $attr = $s.VendorSpecific
      if ($attr -and $attr.Count -ge 12) {
        for ($i = 2; $i -lt $attr.Count - 11; $i += 12) {
          if ($attr[$i] -eq 194) {
            $temp = $attr[$i + 5]
            if ($temp -gt 0 -and $temp -lt 120) {
              $result["$idx"] = $temp
            }
          }
        }
      }
    }
  }
} catch { }

if ($result.Count -gt 0) { $result | ConvertTo-Json -Compress } else { '{}' }
`
  const out = await runPS('get_temperatures', script, 20000)
  if (!out || out === '{}') return

  try {
    const parsed = JSON.parse(out)
    const newTemps: Record<number, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      const idx = parseInt(k)
      const temp = Number(v)
      if (!isNaN(idx) && !isNaN(temp) && temp > 0 && temp < 100) {
        newTemps[idx] = temp
      }
    }
    if (Object.keys(newTemps).length > 0) {
      cachedTemps = newTemps
      log(`[Temp] ${JSON.stringify(cachedTemps)}`)
    }
  } catch { /* parse failure = no temp update */ }
}

// ── Background Polling ───────────────────────────────────────────────────────
async function runDiskBackgroundLoop() {
  if (!isMonitoringEnabled) {
    setTimeout(runDiskBackgroundLoop, 1500)
    return
  }

  const now = Date.now()
  const currentCount = await getFastDiskCount()
  const countChanged = lastDiskCount !== -1 && currentCount !== lastDiskCount
  const needsHeavy = countChanged || now - lastHeavy > HEAVY_INTERVAL || cachedPhysical.length === 0

  if (!isFetchingHeavy) {
    isFetchingHeavy = true
    try {
      if (needsHeavy) {
        log(`[DiskService] Refreshing disks (reason: ${countChanged ? 'count changed' : 'interval'})`)
        await refreshDiskInventory()
        
        if (lastDiskCount !== -1 && lastDiskCount !== cachedPhysical.length) {
          if (typeperfProcess) { typeperfProcess.kill(); typeperfProcess = null; }
          startTypeperfStream()
        }
        lastDiskCount = cachedPhysical.length
        lastHeavy = Date.now()
      }
      await refreshTemperatures().catch(() => {})
    } finally { isFetchingHeavy = false }
  }

  setTimeout(runDiskBackgroundLoop, 1500)
}

// Start immediately
runDiskBackgroundLoop()

// ── Main Export (INSTANT CACHE) ──────────────────────────────────────────────
export async function getDiskData(): Promise<DiskData[]> {
  const disks: DiskData[] = []

  for (const phys of cachedPhysical) {
    const idx = phys.index

    // Volumes on this disk
    const vols = cachedVolumes.filter((v) => v.diskIndex === idx)
    const mounts = vols.map((v) => v.driveLetter)  // ["C:", "D:"]
    const totalSize = vols.reduce((s, v) => s + v.size, 0) || phys.size
    const totalFree = vols.reduce((s, v) => s + v.free, 0)
    const totalUsed = Math.max(0, totalSize - totalFree)

    // IO from typeperf (index matches PhysicalDisk index)
    const io = liveIO[String(idx)]
    const readSpeed  = io ? Math.max(0, io.r) : 0
    const writeSpeed = io ? Math.max(0, io.w) : 0
    const usagePercent = io ? Math.min(100, Math.max(0, io.usage)) : 0

    // Drive type label
    const bus   = phys.busType.toUpperCase()
    const media = phys.mediaType.toUpperCase()
    const name  = phys.name.toUpperCase()
    let driveType = 'HDD'
    if (bus === 'NVME' || name.includes('NVME') || name.includes('NVM EXPRESS')) driveType = 'NVMe'
    else if (bus === 'USB') driveType = 'USB'
    else if (media === 'SSD' || name.includes('SSD')) driveType = 'SATA SSD'
    else if (bus === 'SATA') driveType = 'SATA HDD'

    // Health (Status only)
    let health: DiskData['health'] = 'Unknown'
    const hs = phys.health.toLowerCase()
    if (hs.includes('healthy') || hs.includes('ok')) health = 'Good'
    else if (hs.includes('warning')) health = 'Warning'
    else if (hs.includes('unhealthy')) health = 'Critical'
    else health = 'Good' 

    // Temperature (WMI Fallback)
    let temp = cachedTemps[idx] ?? null

    disks.push({
      id: `disk_${idx}`,
      name: phys.name,
      type: driveType,
      size: totalSize,
      used: totalUsed,
      free: totalFree,
      temperature: temp,
      health,
      readSpeed,
      writeSpeed,
      usagePercent,
      serial: phys.serialNum || undefined,
      mounts,
      diskIndex: idx,
      isRemovable: bus === 'USB' || bus === 'SD' || bus === 'MMC' || name.includes('USB')
    })
  }

  if (disks.length > 0) {
    cachedResult = disks
    return disks
  }
  return cachedResult.map((d) => ({ ...d, stale: true }))
}
