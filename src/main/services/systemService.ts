import os from 'os'
import fs from 'fs'
import path from 'path'
import si from 'systeminformation'
import { spawn } from 'child_process'
import { app } from 'electron'
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

// ── Elevated Thermal Monitor ──────────────────────────────────────────────────

const THERMAL_FILE = path.join(os.tmpdir(), 'drivewatch_thermal.json')
let thermalMonitorStarted = false

// Sticky last-known-good temperatures — once a valid reading is obtained,
// it NEVER resets to null. This prevents flickering N/A.
let stickyTemp = { cpu: 0, gpu: 0, disk: 0 }

function startThermalMonitor() {
  if (thermalMonitorStarted) return
  thermalMonitorStarted = true

  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'thermal-monitor.ps1')
    : path.join(process.cwd(), 'resources', 'thermal-monitor.ps1')

  if (!fs.existsSync(scriptPath)) {
    console.warn('[Thermal] thermal-monitor.ps1 not found at:', scriptPath)
    return
  }

  const launchMonitor = () => {
    try {
      const child = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-Command',
        `Start-Process powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','${scriptPath.replace(/'/g, "''")}','-OutputPath','${THERMAL_FILE.replace(/'/g, "''")}' -Verb RunAs -WindowStyle Hidden`
      ], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.unref()
      console.log('[Thermal] Elevated thermal monitor launched')
    } catch (err: any) {
      console.warn('[Thermal] Could not launch elevated monitor:', err.message)
    }
  }

  launchMonitor()

  // Auto-restart: check every 15s if the thermal file is being updated
  setInterval(() => {
    try {
      if (!fs.existsSync(THERMAL_FILE)) {
        launchMonitor()
        return
      }
      const stat = fs.statSync(THERMAL_FILE)
      const ageMs = Date.now() - stat.mtimeMs
      if (ageMs > 30000) {
        launchMonitor()
      }
    } catch {}
  }, 15000)
}

function readThermalFile() {
  try {
    if (!fs.existsSync(THERMAL_FILE)) return
    const raw = fs.readFileSync(THERMAL_FILE, 'utf8')
    if (!raw || raw.trim().length < 5) return
    const data = JSON.parse(raw)

    // Update sticky temps — only overwrite with valid positive values
    if (typeof data.cpuTemp === 'number' && data.cpuTemp > 0 && data.cpuTemp < 150) {
      stickyTemp.cpu = data.cpuTemp
    }
    if (typeof data.gpuTemp === 'number' && data.gpuTemp > 0 && data.gpuTemp < 150) {
      stickyTemp.gpu = data.gpuTemp
    }
    if (typeof data.diskTemp === 'number' && data.diskTemp > 0 && data.diskTemp < 100) {
      stickyTemp.disk = data.diskTemp
    }

    // On AMD APU: CPU and GPU are same die — if one is valid, use it for both
    if (stickyTemp.cpu > 0 && stickyTemp.gpu === 0) stickyTemp.gpu = stickyTemp.cpu
    if (stickyTemp.gpu > 0 && stickyTemp.cpu === 0) stickyTemp.cpu = stickyTemp.gpu
  } catch {
    // JSON parse failed (file being written) — keep sticky values, don't reset
  }
}

let cachedStats: any = null
let isPolling = false

export function startSystemPolling() {
  if (isPolling) return
  isPolling = true

  // Start the elevated thermal monitor
  if (process.platform === 'win32') {
    startThermalMonitor()
  }

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

      // Read thermal data from the elevated helper file every cycle
      readThermalFile()

      const cpuTemp = stickyTemp.cpu > 0 ? stickyTemp.cpu : null
      const gpuTemp = stickyTemp.gpu > 0 ? stickyTemp.gpu : null
      const hasCpuTemp = cpuTemp !== null
      const hasGpuTemp = gpuTemp !== null

      cachedStats = {
        cpuUsage: Math.round(load.currentLoad),
        cpuTemp,
        cpuName: cachedCpuInfo?.name || 'Generic CPU',
        cpuCores: cachedCpuInfo?.cores || 0,
        cpuThreads: cachedCpuInfo?.threads || 0,
        ramUsage: Math.round((usedMem / totalMem) * 100),
        ramTotalBytes: totalMem,
        ramUsedBytes: usedMem,
        gpuTemp,
        diskTemp: stickyTemp.disk > 0 ? stickyTemp.disk : null,
        hasCpuTemp,
        hasGpuTemp,
        hasDiskTemp: stickyTemp.disk > 0,
        thermalSource: hasCpuTemp ? 'SI' : 'None'
      }
    } catch (e) {}
  }, 1000)
}

export function getSystemStats() {
  if (!isPolling) startSystemPolling()
  return cachedStats || { cpuUsage: 0, cpuTemp: null, cpuName: 'Loading...', ramUsage: 0, ramTotalBytes: os.totalmem(), ramUsedBytes: 0, gpuTemp: null, hasThermal: false }
}