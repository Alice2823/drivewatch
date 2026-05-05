import { PowerShellHost } from './psHost'
import path from 'path'
import fs from 'fs/promises'
import { app } from 'electron'
import { getThermalData } from './thermalService'

export interface GpuStats {
  usage: number
  vramUsed: number
  vramTotal: number
  name: string
  temperature: number | null
}

let cachedGpuStats: GpuStats[] = []
let staticGpuInfo: any[] | null = null
let lastFetchTime = 0
const CACHE_FILE = path.join(app.getPath('userData'), 'gpu_metadata_v2.json')

async function loadCacheFromDisk() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf8')
    staticGpuInfo = JSON.parse(data)
  } catch (err) {}
}

export async function warmGpuService() {
  await loadCacheFromDisk()
  const psHost = PowerShellHost.getInstance('gpu')
  const script = `
    try {
      $gpus = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object {
          @{ Name = $_.Name; AdapterRAM = if ($_.AdapterRAM) { $_.AdapterRAM } else { 0 } }
      }
      Write-Output "DEBUG_STDOUT: $($gpus | ConvertTo-Json -Compress)"
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
  } catch (err) {}
}

warmGpuService()

let lastKnownGpuStats: GpuStats[] = []

let isPolling = false

// 🚀 Non-blocking Background Loop
export function startGpuPolling() {
  if (isPolling) return
  isPolling = true
  
  setInterval(async () => {
    try {
      const psHost = PowerShellHost.getInstance('gpu')
      const includeStatic = staticGpuInfo 
        ? `$gpus = ConvertFrom-Json '${JSON.stringify(staticGpuInfo).replace(/'/g, "''")}'`
        : '$gpus = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Select-Object Name, AdapterRAM)'

      const script = `
try {
  ${includeStatic}
  $wmiEngines = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue
  $gpuDataMap = @{}
  for ($i = 0; $i -lt $gpus.Count; $i++) { $gpuDataMap["$i"] = @{ usage = 0; vram = 0 } }
  if ($wmiEngines) {
    foreach ($eng in $wmiEngines) {
      if ($eng.Name -match "phys_(\\d+)") {
        $idx = $matches[1]
        if ($gpuDataMap.ContainsKey($idx) -and ($eng.Name -match "3D" -or $eng.Name -match "Engine_0")) { 
          if ($eng.UtilizationPercentage -gt $gpuDataMap[$idx].usage) { $gpuDataMap[$idx].usage = $eng.UtilizationPercentage }
        }
      }
    }
  }
  $mem = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -ErrorAction SilentlyContinue
  if ($mem) {
    foreach ($m in $mem) {
      if ($m.Name -match "phys_(\\d+)") {
        $idx = $matches[1]
        if ($gpuDataMap.ContainsKey($idx)) { $gpuDataMap[$idx].vram = [math]::Round($m.TotalCommitted / 1MB) }
      }
    }
  }
  $output = @()
  for ($i = 0; $i -lt $gpus.Count; $i++) {
    $gpu = $gpus[$i]
    $data = $gpuDataMap["$i"]
    $output += @{
      name = $gpu.Name
      usage = [math]::Min(100, [math]::Round($data.usage))
      vramUsed = $data.vram
      vramTotal = [math]::Round($gpu.AdapterRAM / 1MB)
    }
  }
  $output | ConvertTo-Json -Compress
} catch { }
`
      const stdout = await psHost.execute(script, 1000)
      if (stdout) {
        const data = JSON.parse(stdout)
        const results = Array.isArray(data) ? data : [data]
        cachedGpuStats = results.map((g: any) => ({
            usage: g.usage || 0,
            vramUsed: g.vramUsed || 0,
            vramTotal: g.vramTotal || 0,
            name: g.name || 'Unknown GPU',
            temperature: null
        }))
      }
    } catch (e) {}
  }, 1000)
}

export async function getGpuUsage(): Promise<GpuStats[]> {
  if (!isPolling) startGpuPolling()
  return cachedGpuStats
}