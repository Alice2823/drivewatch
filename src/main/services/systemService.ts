import os from 'os'
import si from 'systeminformation'
import { getThermalData } from './thermalService'

let cachedCpuInfo: { name: string; cores: number; threads: number } | null = null
let isFetchingCpuInfo = false

let previousCpuTimes = os.cpus().map(cpu => cpu.times)

async function calculateCpuLoad(): Promise<number> {
  try {
    const load = await si.currentLoad()
    return Math.round(load.currentLoad)
  } catch {
    return 0
  }
}

let cachedStats: any = null
let isPolling = false

export function startSystemPolling() {
  if (isPolling) return
  isPolling = true

  setInterval(async () => {
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
          cachedCpuInfo = { name: cpus[0]?.model || 'Generic CPU', cores: Math.max(1, Math.floor(cpus.length / 2)), threads: cpus.length }
        })
      }

      const load = await si.currentLoad()
      const totalMem = os.totalmem()
      const usedMem = totalMem - os.freemem()

      cachedStats = {
        cpuUsage: Math.round(load.currentLoad),
        cpuTemp: null, // Temperature disabled
        cpuName: cachedCpuInfo?.name || 'Generic CPU',
        cpuCores: cachedCpuInfo?.cores || 0,
        cpuThreads: cachedCpuInfo?.threads || 0,
        ramUsage: Math.round((usedMem / totalMem) * 100),
        ramTotalBytes: totalMem,
        ramUsedBytes: usedMem,
        gpuTemp: null, // Temperature disabled
        diskTemp: null, // Temperature disabled
        hasCpuTemp: false,
        hasGpuTemp: false,
        hasDiskTemp: false,
        thermalSource: 'None'
      }
    } catch (e) {}
  }, 1000)
}

// ✅ IMPORTANT EXPORT (fixes your error)
export function getSystemStats() {
  if (!isPolling) startSystemPolling()
  return cachedStats || { cpuUsage: 0, cpuTemp: null, cpuName: 'Loading...', ramUsage: 0, ramTotalBytes: os.totalmem(), ramUsedBytes: 0, gpuTemp: null, hasThermal: false }
}