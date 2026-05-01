import os from 'os'
import si from 'systeminformation'

let cachedCpuInfo: { name: string; cores: number; threads: number } | null = null
let isFetchingCpuInfo = false

let cachedCpuTemp: number | null = null
let lastTempFetch = 0
const TEMP_INTERVAL = 5_000

let previousCpuTimes = os.cpus().map(cpu => cpu.times)

function calculateCpuLoad(): number {
  const currentCpus = os.cpus()
  let totalIdleDiff = 0
  let totalTickDiff = 0

  for (let i = 0; i < currentCpus.length; i++) {
    const cpu = currentCpus[i]
    const prev = previousCpuTimes[i] || cpu.times

    const idle = cpu.times.idle
    const total = Object.values(cpu.times).reduce((acc, tv) => acc + tv, 0)
    const prevIdle = prev.idle
    const prevTotal = Object.values(prev).reduce((acc, tv) => acc + tv, 0)

    totalIdleDiff += idle - prevIdle
    totalTickDiff += total - prevTotal
  }

  previousCpuTimes = currentCpus.map(cpu => cpu.times)

  if (totalTickDiff === 0) return 0
  const load = 100 - (100 * totalIdleDiff) / totalTickDiff
  return Math.round(load)
}

async function getCpuTemperature(): Promise<number | null> {
  const now = Date.now()
  if (now - lastTempFetch < TEMP_INTERVAL && lastTempFetch > 0) return cachedCpuTemp
  lastTempFetch = now

  // Fallback: PowerShell WMI thermal zone
  try {
    const script = `
try {
  $tz = Get-WmiObject MSAcpi_ThermalZoneTemperature -Namespace root/wmi -ErrorAction Stop | Select-Object -First 1
  $celsius = [math]::Round(($tz.CurrentTemperature / 10) - 273.15)
  if ($celsius -gt 0 -and $celsius -lt 120) { Write-Output $celsius } else { Write-Output '' }
} catch { Write-Output '' }
`
    const { PowerShellHost } = require('./psHost')
    const psHost = PowerShellHost.getInstance()
    const stdout = await psHost.execute(script, 4000)
    
    const temp = parseInt(stdout.trim())
    if (!isNaN(temp) && temp > 0 && temp < 120) {
      cachedCpuTemp = temp
      return temp
    }
  } catch { /* temperature not available */ }

  return cachedCpuTemp
}

export async function getSystemStats() {
  try {
    if (!cachedCpuInfo && !isFetchingCpuInfo) {
      isFetchingCpuInfo = true
      si.cpu().then(cpu => {
        cachedCpuInfo = {
          name: `${cpu.manufacturer} ${cpu.brand}`.replace(/Intel\(R\)|Core\(TM\)|CPU|@.*/gi, '').replace(/\s+/g, ' ').trim(),
          cores: cpu.physicalCores || os.cpus().length,
          threads: cpu.cores || os.cpus().length
        }
      }).catch(() => {
        const cpus = os.cpus()
        cachedCpuInfo = {
          name: cpus[0]?.model || 'Unknown CPU',
          cores: Math.max(1, Math.floor(cpus.length / 2)),
          threads: cpus.length
        }
      })
    }

    const load = calculateCpuLoad()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const usedMemPercent = Math.round((usedMem / totalMem) * 100)

    // Non-blocking temp fetch
    getCpuTemperature().catch(() => {})

    return {
      cpuUsage: load,
      cpuTemp: cachedCpuTemp,
      cpuName: cachedCpuInfo?.name || 'Fetching info...',
      cpuCores: cachedCpuInfo?.cores || 0,
      cpuThreads: cachedCpuInfo?.threads || 0,
      ramUsage: usedMemPercent,
      ramTotalBytes: totalMem,
      ramUsedBytes: usedMem
    }
  } catch (error) {
    console.error('[SystemService] Error:', error)
    return {
      cpuUsage: 0,
      cpuTemp: cachedCpuTemp,
      cpuName: 'Unknown',
      cpuCores: 0,
      cpuThreads: 0,
      ramUsage: 0,
      ramTotalBytes: 0,
      ramUsedBytes: 0
    }
  }
}
