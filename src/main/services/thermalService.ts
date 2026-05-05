
export async function getThermalData() {
  return {
    cpuTemp: null,
    gpuTemp: null,
    gpuMap: {},
    diskTemp: null,
    hasCpuTemp: false,
    hasGpuTemp: false,
    hasDiskTemp: false,
    source: 'None'
  }
}

export async function validateLhmService() { return true }
export function setLhmAlive() { }

// Thermal monitoring and LibreHardwareMonitor dependency permanently removed to ensure system stability and zero CPU overhead.