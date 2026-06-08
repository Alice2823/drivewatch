import { exec } from 'child_process'
import log from 'electron-log'

export async function getCpuFanRpm(): Promise<number | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      log.info('[FanMonitor] Non-Windows platform detected, skipping fan sensor.')
      return resolve(null) // Only Windows is priority
    }

    // Attempt 1: LibreHardwareMonitor
    // Note: We don't filter by Name LIKE '%CPU%' because some motherboard sensors just say "Fan #1"
    const lhmCmd = `powershell "$sensors = Get-WmiObject -namespace 'root\\LibreHardwareMonitor' -query \\"SELECT * FROM Sensor WHERE SensorType = 'Fan'\\" -ErrorAction SilentlyContinue; if ($sensors) { foreach ($s in $sensors) { Write-Output \\"LHM:$($s.Name):$($s.SensorType):$($s.Value)\\" } }"`
    
    exec(lhmCmd, (err, stdout) => {
      if (!err && stdout.trim()) {
        const lines = stdout.trim().split('\n')
        for (const line of lines) {
           const parts = line.trim().split(':')
           if (parts.length >= 4) {
              const name = parts[1]
              const type = parts[2]
              const val = parseInt(parts[3])
              if (!isNaN(val) && val > 0) {
                 log.info(`[FanMonitor] Detected LHM sensor - Name: ${name}, Type: ${type}, RPM: ${val}`)
                 return resolve(val)
              }
           }
        }
      } else if (err) {
        log.warn(`[FanMonitor] LHM initialization failed or not running. Error: ${err.message}`)
      } else {
        log.warn(`[FanMonitor] LHM running but no Fan sensors detected.`)
      }

      // Attempt 2: OpenHardwareMonitor
      const ohmCmd = `powershell "$sensors = Get-WmiObject -namespace 'root\\OpenHardwareMonitor' -query \\"SELECT * FROM Sensor WHERE SensorType = 'Fan'\\" -ErrorAction SilentlyContinue; if ($sensors) { foreach ($s in $sensors) { Write-Output \\"OHM:$($s.Name):$($s.SensorType):$($s.Value)\\" } }"`
      exec(ohmCmd, (err2, stdout2) => {
        if (!err2 && stdout2.trim()) {
          const lines = stdout2.trim().split('\n')
          for (const line of lines) {
             const parts = line.trim().split(':')
             if (parts.length >= 4) {
                const name = parts[1]
                const type = parts[2]
                const val = parseInt(parts[3])
                if (!isNaN(val) && val > 0) {
                   log.info(`[FanMonitor] Detected OHM sensor - Name: ${name}, Type: ${type}, RPM: ${val}`)
                   return resolve(val)
                }
             }
          }
        } else if (err2) {
          log.warn(`[FanMonitor] OHM initialization failed or not running. Error: ${err2.message}`)
        }

        // Attempt 3: Standard Win32_Fan (WMI)
        const winCmd = `powershell "$fans = Get-WmiObject -Class Win32_Fan -ErrorAction SilentlyContinue; if ($fans) { foreach ($f in $fans) { Write-Output \\"WMI:$($f.Name):Fan:$($f.DesiredSpeed)\\" } }"`
        exec(winCmd, (err3, stdout3) => {
          if (!err3 && stdout3.trim()) {
            const lines = stdout3.trim().split('\n')
            for (const line of lines) {
               const parts = line.trim().split(':')
               if (parts.length >= 4) {
                  const name = parts[1]
                  const type = parts[2]
                  const val = parseInt(parts[3])
                  if (!isNaN(val) && val > 0) {
                     log.info(`[FanMonitor] Detected Win32_Fan sensor - Name: ${name}, Type: ${type}, RPM: ${val}`)
                     return resolve(val)
                  }
               }
            }
          } else if (err3) {
            log.warn(`[FanMonitor] Win32_Fan query failed. Error: ${err3.message}`)
          }
          
          log.info('[FanMonitor] No fan sensors detected through any available provider (LHM/OHM/WMI). Fan RPM is likely not exposed by BIOS.')
          resolve(null)
        })
      })
    })
  })
}
