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

const psHost = PowerShellHost.getInstance()

async function runPS(scriptName: string, scriptBody: string, timeoutMs = 6000): Promise<string> {
  const result = await psHost.execute(scriptBody, timeoutMs)
  return result.trim()
}


// ── Typeperf Real-time IO Stream ─────────────────────────────────────────────
// liveIO key = disk index as string ("0", "1", …)
let liveIO: Record<string, { r: number; w: number }> = {}
let typeperfProcess: ChildProcessWithoutNullStreams | null = null
let typeperfHeaders: string[] = []

function startTypeperfStream(): void {
  if (typeperfProcess) return
  log('[Typeperf] Starting stream...')

  typeperfProcess = spawn('typeperf', [
    '\\PhysicalDisk(*)\\Disk Read Bytes/sec',
    '\\PhysicalDisk(*)\\Disk Write Bytes/sec',
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

      // Header line — looks like: "(PDH-CSV 4.0)","\\.\PhysicalDisk(0 C:)\Disk Read Bytes/sec", ...
      if (line.includes('PhysicalDisk')) {
        typeperfHeaders = line.split(',').map((h) => h.replace(/"/g, '').trim())
        continue
      }

      // Data line — starts with a timestamp
      if (!typeperfHeaders.length || !line.includes(',')) continue

      const parts = line.split(',').map((p) => p.replace(/"/g, '').trim())
      if (parts.length < 2) continue

      for (let i = 1; i < parts.length; i++) {
        const header = typeperfHeaders[i]
        if (!header) continue

        // Extract disk index from e.g. "PhysicalDisk(0 C:)" or "PhysicalDisk(0)" or "_Total"
        const match = header.match(/PhysicalDisk\((\d+)[^)]*\)/)
        if (!match) continue // skip _Total

        const diskIdx = match[1] // "0", "1", etc.
        if (!liveIO[diskIdx]) liveIO[diskIdx] = { r: 0, w: 0 }

        const bytes = parseFloat(parts[i]) || 0
        const mb = bytes / 1_048_576

        if (header.includes('Read')) {
          liveIO[diskIdx].r = mb
        } else {
          liveIO[diskIdx].w = mb
        }
      }
    }
  })

  typeperfProcess.on('error', (err) => {
    log(`[Typeperf] Error: ${err.message}`)
    typeperfProcess = null
  })

  typeperfProcess.on('exit', () => {
    log('[Typeperf] Exited. Restarting in 5s...')
    typeperfProcess = null
    setTimeout(startTypeperfStream, 5000)
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

async function getPhysicalDisks(): Promise<PhysicalDisk[]> {
  const script = `
try {
  $disks = Get-PhysicalDisk | Select-Object DeviceId, FriendlyName, Size, MediaType, BusType, SerialNumber, HealthStatus
  $disks | ConvertTo-Json -Compress -Depth 2
} catch {
  Write-Output '[]'
}
`
  const out = await runPS('get_physical_disks', script, 20000)
  if (!out) return []

  try {
    let parsed = JSON.parse(out)
    if (!Array.isArray(parsed)) parsed = [parsed]
    return parsed.map((d: any) => ({
      index: parseInt(d.DeviceId ?? '0'),
      name: (d.FriendlyName || 'Unknown Disk').trim(),
      size: Number(d.Size) || 0,
      mediaType: d.MediaType || 'Unspecified',
      busType: d.BusType || 'Unknown',
      serialNum: (d.SerialNumber || '').trim(),
      health: d.HealthStatus || 'Unknown'
    })).sort((a: PhysicalDisk, b: PhysicalDisk) => a.index - b.index)
  } catch (e: any) {
    log(`[DiskService] PhysicalDisk parse error: ${e.message}`)
    return []
  }
}

// ── Partition → Volume mapping ────────────────────────────────────────────────
interface VolumeInfo {
  diskIndex: number
  driveLetter: string  // "C", "D", etc.
  size: number
  free: number
}

async function getVolumeMap(): Promise<VolumeInfo[]> {
  const script = `
try {
  $partitions = Get-Partition | Where-Object { $_.DriveLetter -and $_.DriveLetter -ne [char]0 }
  $volumes = Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveLetter -ne [char]0 }

  $result = @()
  foreach ($p in $partitions) {
    $vol = $volumes | Where-Object { $_.DriveLetter -eq $p.DriveLetter } | Select-Object -First 1
    if ($vol) {
      $result += [PSCustomObject]@{
        DiskNumber  = $p.DiskNumber
        DriveLetter = "$($p.DriveLetter):"
        Size        = $vol.Size
        Free        = $vol.SizeRemaining
      }
    }
  }
  $result | ConvertTo-Json -Compress -Depth 2
} catch {
  Write-Output '[]'
}
`
  const out = await runPS('get_volume_map', script, 20000)
  if (!out || out === '[]') return []

  try {
    let parsed = JSON.parse(out)
    if (!Array.isArray(parsed)) parsed = [parsed]
    return parsed.map((v: any) => ({
      diskIndex: parseInt(v.DiskNumber ?? '0'),
      driveLetter: v.DriveLetter || '',
      size: Number(v.Size) || 0,
      free: Number(v.Free) || 0
    })).filter((v: VolumeInfo) => v.driveLetter)
  } catch (e: any) {
    log(`[DiskService] VolumeMap parse error: ${e.message}`)
    return []
  }
}

// ── Temperature via SMART/WMI ─────────────────────────────────────────────────
let cachedTemps: Record<number, number> = {}
let lastTempFetch = 0
const TEMP_INTERVAL = 5_000

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

// ── Cache ─────────────────────────────────────────────────────────────────────
let cachedPhysical: PhysicalDisk[] = []
let cachedVolumes: VolumeInfo[] = []
let cachedResult: DiskData[] = []
let lastHeavy = 0
const HEAVY_INTERVAL = 30_000  // re-enumerate every 30s; IO comes from typeperf every 1s

let isFetchingHeavy = false

let lastDiskCount = -1

// ── Main Export ───────────────────────────────────────────────────────────────
export async function getDiskData(): Promise<DiskData[]> {
  const now = Date.now()
  const needsHeavy = now - lastHeavy > HEAVY_INTERVAL || cachedPhysical.length === 0

  if (needsHeavy && !isFetchingHeavy) {
    isFetchingHeavy = true
    try {
      const [phys, vols] = await Promise.all([
        getPhysicalDisks(),
        getVolumeMap()
      ])

      if (phys.length > 0) {
        if (lastDiskCount !== -1 && lastDiskCount !== phys.length) {
          log(`[DiskService] Disk count changed (${lastDiskCount} -> ${phys.length}). Restarting typeperf...`)
          if (typeperfProcess) {
            typeperfProcess.removeAllListeners('exit')
            typeperfProcess.kill()
            typeperfProcess = null
            startTypeperfStream()
          }
        }
        lastDiskCount = phys.length

        cachedPhysical = phys
        cachedVolumes = vols
        lastHeavy = Date.now()
      }
    } finally {
      isFetchingHeavy = false
    }

    // Temperature: non-blocking background refresh
    refreshTemperatures().catch(() => {})
  } else if (!needsHeavy) {
    // Lightweight: still try temperature refresh (respects cooldown)
    refreshTemperatures().catch(() => {})
  }

  if (cachedPhysical.length === 0) {
    log('[DiskService] No physical disks found')
    return cachedResult.map((d) => ({ ...d, stale: true }))
  }

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

    // Drive type label
    const bus   = phys.busType.toUpperCase()
    const media = phys.mediaType.toUpperCase()
    const name  = phys.name.toUpperCase()
    let driveType = 'HDD'
    if (bus === 'NVME' || name.includes('NVME') || name.includes('NVM EXPRESS')) {
      driveType = 'NVMe'
    } else if (bus === 'USB') {
      driveType = 'USB'
    } else if (media === 'SSD' || name.includes('SSD')) {
      driveType = 'SATA SSD'
    } else if (bus === 'SATA') {
      driveType = 'SATA HDD'
    }

    // Health
    const temp = cachedTemps[idx] ?? null
    let health: DiskData['health'] = 'Unknown'
    const hs = phys.health.toLowerCase()
    if (hs.includes('healthy')) health = 'Good'
    else if (hs.includes('warning')) health = 'Warning'
    else if (hs.includes('unhealthy')) health = 'Critical'
    else health = 'Good' // default to Good if unreported

    // Override with temperature-based warning
    if (temp !== null) {
      if (temp > 65) health = 'Critical'
      else if (temp > 55 && health === 'Good') health = 'Warning'
    }

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
