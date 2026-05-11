import { PowerShellHost } from './psHost'
import path from 'path'
import fs from 'fs/promises'
import { app } from 'electron'

export interface GpuStats {
  usage: number
  vramUsed: number
  vramTotal: number
  name: string
  temperature: number | null
}

let cachedGpuStats: GpuStats[] = []
let staticGpuInfo: any[] | null = null
let isPolling = false
let fetchPromise: Promise<void> | null = null

const CACHE_FILE = path.join(app.getPath('userData'), 'gpu_metadata_v2.json')
const GPU_POLL_INTERVAL_MS = 1000
const GPU_POLL_TIMEOUT_MS = 3500

async function loadCacheFromDisk() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf8')
    const parsed = JSON.parse(data)
    staticGpuInfo = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    staticGpuInfo = null
  }
}

function normalizeGpuStats(data: any): GpuStats[] {
  const rows = Array.isArray(data) ? data : data ? [data] : []

  return rows.map((g: any) => ({
    usage: Math.min(100, Math.max(0, Math.round(Number(g.usage) || 0))),
    vramUsed: Math.max(0, Math.round(Number(g.vramUsed) || 0)),
    vramTotal: Math.max(0, Math.round(Number(g.vramTotal) || 0)),
    name: g.name || 'Unknown GPU',
    temperature: typeof g.temperature === 'number' ? g.temperature : null
  }))
}

export async function warmGpuService() {
  await loadCacheFromDisk()

  const psHost = PowerShellHost.getInstance('gpu')
  const script = `
    try {
      $gpus = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object {
        @{
          Name = $_.Name
          AdapterRAM = if ($_.AdapterRAM -and $_.AdapterRAM -gt 0) { [int64]$_.AdapterRAM } else { 0 }
        }
      })
      if ($gpus.Count -gt 0) {
        Write-Output "DEBUG_STDOUT: $($gpus | ConvertTo-Json -Compress)"
      }
    } catch {
      Write-Output "DEBUG_ERROR: $($_.Exception.Message)"
    }
  `

  try {
    const stdout = await psHost.execute(script, 4000)
    if (stdout.includes('DEBUG_STDOUT:')) {
      const jsonStr = stdout.split('DEBUG_STDOUT:')[1].trim()
      const data = JSON.parse(jsonStr)
      staticGpuInfo = Array.isArray(data) ? data : [data]
      await fs.writeFile(CACHE_FILE, JSON.stringify(staticGpuInfo))
    }
  } catch {
    // Metadata is optional; live counters can still produce GPU rows.
  }
}

warmGpuService()

function buildGpuPollingScript(): string {
  const includeStatic = staticGpuInfo
    ? `$gpus = @(ConvertFrom-Json '${JSON.stringify(staticGpuInfo).replace(/'/g, "''")}')`
    : `$gpus = @()
      try {
        $gpus = @(Get-CimInstance Win32_VideoController -ErrorAction Stop | ForEach-Object {
        @{
          Name = $_.Name
          AdapterRAM = if ($_.AdapterRAM -and $_.AdapterRAM -gt 0) { [int64]$_.AdapterRAM } else { 0 }
        }
        })
      } catch {
        $gpus = @()
      }`

  return `
try {
  ${includeStatic}
  if ($null -eq $gpus) { $gpus = @() }
  if ($gpus -isnot [array]) { $gpus = @($gpus) }

  $engineRows = @()
  try {
    $engineRows = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop)
  } catch {
    $engineRows = @()
  }
  if (-not $engineRows -or $engineRows.Count -eq 0) {
    try {
      $engineCounter = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue
      $engineRows = @($engineCounter.CounterSamples | ForEach-Object {
        [pscustomobject]@{
          Name = $_.InstanceName
          UtilizationPercentage = $_.CookedValue
        }
      })
    } catch {
      $engineRows = @()
    }
  }

  $memoryRows = @()
  try {
    $memoryRows = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -ErrorAction Stop)
  } catch {
    $memoryRows = @()
  }
  if (-not $memoryRows -or $memoryRows.Count -eq 0) {
    try {
      $memoryCounter = Get-Counter '\\GPU Adapter Memory(*)\\Total Committed' -ErrorAction SilentlyContinue
      $memoryRows = @($memoryCounter.CounterSamples | ForEach-Object {
        [pscustomobject]@{
          Name = $_.InstanceName
          TotalCommitted = $_.CookedValue
        }
      })
    } catch {
      $memoryRows = @()
    }
  }

  $physIds = @{}
  for ($i = 0; $i -lt $gpus.Count; $i++) {
    $physIds["$i"] = $true
  }

  foreach ($eng in $engineRows) {
    $engineName = "$($eng.Name)".ToLowerInvariant()
    if ($engineName -match 'phys_(\\d+)') {
      $physIds[$matches[1]] = $true
    }
  }

  foreach ($mem in $memoryRows) {
    $memoryName = "$($mem.Name)".ToLowerInvariant()
    if ($memoryName -match 'phys_(\\d+)') {
      $physIds[$matches[1]] = $true
    }
  }

  $gpuDataMap = @{}
  foreach ($id in $physIds.Keys) {
    $gpuDataMap[$id] = @{ engines = @{}; vramBytes = 0 }
  }

  foreach ($eng in $engineRows) {
    $engineName = "$($eng.Name)".ToLowerInvariant()
    if ($engineName -notmatch 'phys_(\\d+)') { continue }

    $idx = $matches[1]
    if (-not $gpuDataMap.ContainsKey($idx)) { continue }

    $engineKey = 'unknown'
    if ($engineName -match '(eng_\\d+_engtype_[^_\\)]+)') {
      $engineKey = $matches[1]
    } elseif ($engineName -match 'engtype_([^_\\)]+)') {
      $engineKey = "engtype_$($matches[1])"
    }

    $value = [double]($eng.UtilizationPercentage)
    if ($value -lt 0) { continue }

    if (-not $gpuDataMap[$idx].engines.ContainsKey($engineKey)) {
      $gpuDataMap[$idx].engines[$engineKey] = 0.0
    }
    $gpuDataMap[$idx].engines[$engineKey] += $value
  }

  foreach ($mem in $memoryRows) {
    $memoryName = "$($mem.Name)".ToLowerInvariant()
    if ($memoryName -notmatch 'phys_(\\d+)') { continue }

    $idx = $matches[1]
    if (-not $gpuDataMap.ContainsKey($idx)) { continue }

    $bytes = [double]($mem.TotalCommitted)
    if ($bytes -gt 0) {
      $gpuDataMap[$idx].vramBytes += $bytes
    }
  }

  $output = @()
  $ids = @($physIds.Keys | Sort-Object { [int]$_ })
  foreach ($id in $ids) {
    $data = $gpuDataMap[$id]
    $usage = 0.0
    foreach ($engineLoad in $data.engines.Values) {
      if ($engineLoad -gt $usage) {
        $usage = $engineLoad
      }
    }

    $gpu = $null
    $gpuIndex = [int]$id
    if ($gpuIndex -ge 0 -and $gpuIndex -lt $gpus.Count) {
      $gpu = $gpus[$gpuIndex]
    }

    $adapterRam = 0
    if ($gpu -and $gpu.AdapterRAM -and [int64]$gpu.AdapterRAM -gt 0) {
      $adapterRam = [int64]$gpu.AdapterRAM
    }

    $output += @{
      name = if ($gpu -and $gpu.Name) { $gpu.Name } else { "GPU $id" }
      usage = [math]::Min(100, [math]::Round($usage))
      vramUsed = [math]::Round($data.vramBytes / 1MB)
      vramTotal = [math]::Round($adapterRam / 1MB)
      temperature = $null
    }
  }

  $output | ConvertTo-Json -Compress
} catch {
  '[]'
}
`
}

async function pollGpuStats(): Promise<void> {
  if (fetchPromise) return fetchPromise

  fetchPromise = (async () => {
    try {
      const psHost = PowerShellHost.getInstance('gpu')
      const stdout = await psHost.execute(buildGpuPollingScript(), GPU_POLL_TIMEOUT_MS)
      if (!stdout) return

      const data = JSON.parse(stdout)
      const nextStats = normalizeGpuStats(data)
      if (nextStats.length > 0) {
        cachedGpuStats = nextStats
      }
    } catch {
      // Keep the last good sample instead of flashing zero on transient counter failures.
    } finally {
      fetchPromise = null
    }
  })()

  return fetchPromise
}

export function startGpuPolling() {
  if (isPolling) return
  isPolling = true

  void pollGpuStats()
  setInterval(() => {
    void pollGpuStats()
  }, GPU_POLL_INTERVAL_MS)
}

export async function getGpuUsage(): Promise<GpuStats[]> {
  if (!isPolling) {
    startGpuPolling()
  }

  if (cachedGpuStats.length === 0) {
    await pollGpuStats()
  }

  return cachedGpuStats
}
