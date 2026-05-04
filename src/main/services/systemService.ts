import os from 'os'
import si from 'systeminformation'
import { getThermalData } from './thermalService'

let cachedCpuInfo: { name: string; cores: number; threads: number } | null = null
let isFetchingCpuInfo = false

let previousCpuTimes = os.cpus().map(cpu => cpu.times)

function calculateCpuLoad(): number {
  const currentCpus = os.cpus()
  let totalIdleDiff = 0
  let totalTickDiff = 0

  for (let i = 0; i < currentCpus.length; i++) {
    const cpu = currentCpus[i]
    const prev = previousCpuTimes[i] || cpu.times

    const idle = cpu.times.idle
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0)

    totalIdleDiff += idle - prev.idle
    totalTickDiff += total - Object.values(prev).reduce((a, b) => a + b, 0)
  }

  previousCpuTimes = currentCpus.map(cpu => cpu.times)

  return totalTickDiff === 0
    ? 0
    : Math.round(100 - (100 * totalIdleDiff) / totalTickDiff)
}

// ✅ IMPORTANT EXPORT (fixes your error)
export async function getSystemStats() {
  try {
    if (!cachedCpuInfo && !isFetchingCpuInfo) {
      isFetchingCpuInfo = true

      si.cpu().then(cpu => {
        cachedCpuInfo = {
          name: `${cpu.manufacturer} ${cpu.brand}`
            .replace(/Intel\(R\)|Core\(TM\)|CPU|@.*/gi, '')
            .replace(/\s+/g, ' ')
            .trim(),
          cores: cpu.physicalCores || os.cpus().length,
          threads: cpu.cores || os.cpus().length
        }
      }).catch(() => {
        const cpus = os.cpus()
        cachedCpuInfo = {
          name: cpus[0]?.model || 'Generic CPU',
          cores: Math.max(1, Math.floor(cpus.length / 2)),
          threads: cpus.length
        }
      })
    }

    const cpuUsage = calculateCpuLoad()

    const totalMem = os.totalmem()
    const usedMem = totalMem - os.freemem()
    const ramUsage = Math.round((usedMem / totalMem) * 100)

    // 🔥 GET TEMPERATURES
    const temps = await getThermalData()

    return {
      cpuUsage,
      cpuTemp: temps.cpuTemp,
      cpuName: cachedCpuInfo?.name || 'Generic CPU',
      cpuCores: cachedCpuInfo?.cores || 0,
      cpuThreads: cachedCpuInfo?.threads || 0,
      ramUsage,
      ramTotalBytes: totalMem,
      ramUsedBytes: usedMem,
      gpuTemp: temps.gpuTemp,
      diskTemp: temps.diskTemp, 
      hasCpuTemp: temps.hasCpuTemp,
      hasGpuTemp: temps.hasGpuTemp,
      hasDiskTemp: temps.hasDiskTemp,
      thermalSource: temps.source
    }
  } catch (error) {
    return {
      cpuUsage: 0,
      cpuTemp: null,
      cpuName: 'Generic CPU',
      cpuCores: 0,
      cpuThreads: 0,
      ramUsage: 0,
      ramTotalBytes: os.totalmem(),
      ramUsedBytes: 0,
      gpuTemp: null,
      diskTemps: [],
      hasThermal: false
    }
  }
}