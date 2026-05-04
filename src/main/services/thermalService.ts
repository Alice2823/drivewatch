import http from 'http'
import si from 'systeminformation'

export type ThermalData = {
  cpuTemp: number | null
  gpuTemp: number | null
  diskTemp: number | null
  hasCpuTemp: boolean
  hasGpuTemp: boolean
  hasDiskTemp: boolean
  source: "LHM" | "SI" | "None"
}

// 🌐 Dynamic Subsystem State
let LHM_ALIVE = false

export function setLhmAlive(state: boolean) {
  LHM_ALIVE = state
}

export function isLhmAlive(): boolean {
  return LHM_ALIVE
}

/**
 * 🛡️ PRODUCTION THERMAL ENGINE
 * Features: Multi-source, Self-healing, Timeout-protected
 */
export async function getThermalData(): Promise<ThermalData> {
  // Tier 1: Advanced (LibreHardwareMonitor)
  // We check LHM_ALIVE (updated by main process watchdog)
  if (LHM_ALIVE) {
    try {
      const lhm = await fetchLhmWithTimeout(700) // Strict 700ms timeout
      if (lhm && lhm.Children) {
        const data = extractTemps(lhm)
        return { ...data, source: "LHM" }
      }
    } catch (err) {
      // 🚑 Auto-Recovery: Main process watchdog will handle the state flip
    }
  }

  // Tier 2: Core (systeminformation)
  try {
    const [cpu, gpu] = await Promise.all([
      si.cpuTemperature(),
      si.graphics()
    ])

    const cpuTemp = cpu.main && cpu.main > 0 ? cpu.main : null
    let gpuTemp: number | null = null
    
    if (gpu.controllers) {
      const validGpu = gpu.controllers.find(c => c.temperatureGpu && c.temperatureGpu > 0)
      gpuTemp = validGpu ? validGpu.temperatureGpu! : null
    }

    return {
      cpuTemp,
      gpuTemp,
      diskTemp: null,
      hasCpuTemp: !!cpuTemp,
      hasGpuTemp: !!gpuTemp,
      hasDiskTemp: false,
      source: "SI"
    }
  } catch (err) { /* ignore */ }

  return {
    cpuTemp: null,
    gpuTemp: null,
    diskTemp: null,
    hasCpuTemp: false,
    hasGpuTemp: false,
    hasDiskTemp: false,
    source: "None"
  }
}

/**
 * 🔍 Health Check: Verifies server without blocking
 */
export async function validateLhmService(timeout = 1000): Promise<boolean> {
  try {
    const data = await fetchLhmWithTimeout(timeout)
    return !!(data && data.Children)
  } catch {
    return false
  }
}

/**
 * 📦 Safe Fetch Wrapper (Node http implementation)
 */
function fetchLhmWithTimeout(timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get('http://localhost:8085/data.json', res => {
      if (res.statusCode !== 200) {
        reject(new Error(`Bad Status: ${res.statusCode}`))
        return
      }
      let raw = ''
      res.on('data', chunk => (raw += chunk))
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw))
        } catch (e) {
          reject(new Error('JSON Parse Error'))
        }
      })
    })

    req.on('error', err => reject(err))
    
    // 🔥 Strict Timeout Protection
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('LHM_TIMEOUT'))
    })
  })
}

/**
 * STRICT LHM PARSER
 */
function extractTemps(rootNode: any) {
  const res = { cpuTemp: null, gpuTemp: null, diskTemp: null, hasCpuTemp: false, hasGpuTemp: false, hasDiskTemp: false }
  let dGpu: number | null = null, iGpu: number | null = null, isAPU = false

  function traverse(node: any, hwType: string = '', hwName: string = '') {
    if (!node) return
    const text = (node.Text || '').toLowerCase(), type = (node.Type || '').toLowerCase(), valStr = node.Value || ''
    let curHwType = hwType, curHwName = hwName

    if (node.ImageURL) {
      const img = node.ImageURL.toLowerCase(), name = text.toLowerCase()
      if (img.includes('cpu') || name.includes('ryzen') || name.includes('intel core')) curHwType = 'cpu'
      else if (img.includes('nvidia') || img.includes('ati') || name.includes('radeon') || name.includes('vega') || name.includes('graphics')) {
        curHwType = 'gpu'
        if (name.includes('vega') || name.includes('graphics') || name.includes('intel') || name.includes('uhd')) isAPU = true
      }
      else if (img.includes('hdd') || img.includes('ssd')) curHwType = 'disk'
      curHwName = text
    }

    if (type === 'temperature') {
      const num = parseFloat(valStr.replace(',', '.'))
      if (!isNaN(num) && num > 0) {
        if (curHwType === 'cpu' && (text.includes('package') || text.includes('tctl') || text.includes('tdie') || text.includes('core'))) {
          res.cpuTemp = num; res.hasCpuTemp = true
        } else if (curHwType === 'gpu' && (text.includes('core') || text.includes('gpu') || text.includes('edge'))) {
          if (curHwName.includes('nvidia') || curHwName.includes('radeon rx')) dGpu = Math.max(dGpu || 0, num)
          else iGpu = Math.max(iGpu || 0, num)
        } else if (curHwType === 'disk' && (text.includes('temp') || text.includes('composite'))) {
          res.diskTemp = Math.max(res.diskTemp || 0, num); res.hasDiskTemp = true
        }
      }
    }
    if (node.Children) node.Children.forEach((c: any) => traverse(c, curHwType, curHwName))
  }

  traverse(rootNode)
  if (dGpu !== null) { res.gpuTemp = dGpu; res.hasGpuTemp = true }
  else if (iGpu !== null) { res.gpuTemp = iGpu; res.hasGpuTemp = true }
  else if (isAPU && res.hasCpuTemp) { res.gpuTemp = res.cpuTemp; res.hasGpuTemp = true }

  return res
}