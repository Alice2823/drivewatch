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
const FETCH_INTERVAL = 500 
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

export async function getGpuUsage(): Promise<GpuStats[]> {
  const now = Date.now()
  if (now - lastFetchTime < FETCH_INTERVAL && cachedGpuStats.length > 0) {
    return cachedGpuStats
  }
  lastFetchTime = now

  const psHost = PowerShellHost.getInstance('gpu')
  const includeStatic = staticGpuInfo 
    ? `$gpus = ConvertFrom-Json '${JSON.stringify(staticGpuInfo).replace(/'/g, "''")}'`
    : '$gpus = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Select-Object Name, AdapterRAM)'

  const script = `
try {
  ${includeStatic}

  # 1. Load Aggregation (WMI + PDH Fallback)
  $wmiEngines = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue
  $gpuDataMap = @{}
  for ($i = 0; $i -lt $gpus.Count; $i++) { $gpuDataMap["$i"] = @{ usage = 0; vram = 0 } }

  if ($wmiEngines) {
    foreach ($eng in $wmiEngines) {
      if ($eng.Name -match "phys_(\\d+)") {
        $idx = $matches[1]
        if ($gpuDataMap.ContainsKey($idx) -and $eng.Name -match "3D") { $gpuDataMap[$idx].usage += $eng.UtilizationPercentage }
      }
    }
  }

  for ($i = 0; $i -lt $gpus.Count; $i++) {
    if ($gpuDataMap["$i"].usage -lt 1) {
      $counters = Get-Counter "\\GPU Engine(*phys_$i*engtype_3D*)\\Utilization Percentage" -ErrorAction SilentlyContinue
      if ($counters) {
        $sum = ($counters.CounterSamples | Measure-Object -Sum CookedValue).Sum
        if ($sum -gt $gpuDataMap["$i"].usage) { $gpuDataMap["$i"].usage = $sum }
      }
    }
  }

  # 2. VRAM
  $mem = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -ErrorAction SilentlyContinue
  if ($mem) {
    foreach ($m in $mem) {
      if ($m.Name -match "phys_(\\d+)") {
        $idx = $matches[1]
        if ($gpuDataMap.ContainsKey($idx)) { $gpuDataMap[$idx].vram = [math]::Round($m.TotalCommitted / 1MB) }
      }
    }
  }

  # 3. Universal GPU Thermal Scout
  # Skipped in PowerShell, Node thermalService will handle it
  $temp = $null

  $output = @()
  for ($i = 0; $i -lt $gpus.Count; $i++) {
    $gpu = $gpus[$i]
    $data = $gpuDataMap["$i"]
    $output += @{
      name = $gpu.Name
      usage = [math]::Min(100, [math]::Round($data.usage))
      vramUsed = $data.vram
      vramTotal = [math]::Round($gpu.AdapterRAM / 1MB)
      temperature = if ($temp -gt 15 -and $temp -lt 115) { $temp } else { $null }
    }
  }
  Write-Output "DEBUG_STDOUT: $($output | ConvertTo-Json -Compress)"
} catch { Write-Output "DEBUG_ERROR: $($_.Exception.Message)" }
`

  try {
    const stdout = await psHost.execute(script, 8000)
    const thermals = await getThermalData()

    if (stdout.includes('DEBUG_STDOUT:')) {
      const jsonStr = stdout.split('DEBUG_STDOUT:')[1].trim()
      const data = JSON.parse(jsonStr)
      const results = Array.isArray(data) ? data : [data]
      cachedGpuStats = results.map((g: any, index: number) => {
        let temp = g.temperature || null
        
        if (!temp && thermals.gpuTemp !== null) {
            temp = thermals.gpuTemp
        }

        // Always fallback to CPU temp if GPU temp is completely unavailable
        if (!temp && thermals.cpuTemp !== null) {
          console.log(`[Backend] GPU Service: Falling back to CPU temp (${thermals.cpuTemp}°C) for GPU '${g.name || 'Unknown'}'`)
          temp = thermals.cpuTemp
        }

        console.log(`[Backend] GPU Service: Final GPU Temp for '${g.name || 'Unknown'}' resolved to ${temp !== null ? temp + '°C' : 'null'}`)

        return {
          usage: g.usage || 0,
          vramUsed: g.vramUsed || 0,
          vramTotal: g.vramTotal || 0,
          name: g.name || 'Unknown GPU',
          temperature: temp
        }
      })
    }
  } catch (err) {}
  return cachedGpuStats.length > 0 ? cachedGpuStats : [{ usage: 0, vramUsed: 0, vramTotal: 0, name: 'Updating...', temperature: null }]
}