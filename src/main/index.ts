import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { spawn, execSync } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { getDiskData } from './services/diskService'
import { getSystemStats } from './services/systemService'
import { getGpuUsage } from './services/gpuService'
import { runSmartScan } from './services/scanner/smartScan'
import { runQuickHealthCheck } from './services/scanner/quickHealthCheck'
import { calculateHealthScore } from './services/scanner/healthScore'
import { runChkdskAction, checkDriveFsHealth, scheduleRebootRepair } from './services/scanner/chkdskScan'
import { StorageScanner } from './services/scanner/storageScanner'
import { validateLhmService, setLhmAlive } from './services/thermalService'
import { UpdaterService } from './services/updaterService'
import { RecoveryEngine } from './recoveryEngine'
import { DeviceEjectService } from './services/deviceEjectService'
import { runStorageDiagnostics, exportDiagnosticsReport, exportDiagnosticsJson } from './services/storageDiagnostics'
import { getCpuFanRpm } from './services/fanMonitor'
import {
  startSurfaceScan,
  pauseSurfaceScan,
  resumeSurfaceScan,
  stopSurfaceScan,
  isSurfaceScanActive
} from './services/scanner/surfaceScanEngine'
import { findBestScanResult, getAllStoredDiskIndices } from './services/scanner/scanResultStore'
import {
  startStabilizer,
  pauseStabilizer,
  resumeStabilizer,
  stopStabilizer,
  isStabilizerActive
} from './services/stabilizer/sectorStabilizer'
import { scanTaskManager } from './services/scanTaskManager'

// Keep DriveWatch from adding its own GPU load while it is measuring GPU load.
app.disableHardwareAcceleration()

const storageScanner = new StorageScanner()
let recoveryEngine: RecoveryEngine | null = null

const iconPath = app.isPackaged
  ? join(process.resourcesPath, process.platform === 'win32' ? 'icon.ico' : 'icon.icns')
  : join(__dirname, '../../build', process.platform === 'win32' ? 'icon.ico' : 'icon.icns')

/**
 * 🛡️ DETERMINISTIC STARTUP & WATCHDOG
 */

async function startHardwareMonitor() {
  const monitorPath = app.isPackaged
    ? join(process.resourcesPath, 'monitor', 'LibreHardwareMonitor.exe')
    : join(process.cwd(), 'resources', 'monitor', 'LibreHardwareMonitor.exe')

  try {
    // 1️⃣ Initial Launch Attempt
    const monitorProcess = spawn(monitorPath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    monitorProcess.unref()

    // 2️⃣ Initial Sync: Wait for first response
    console.log('[Main] Initializing hardware monitoring subsystem...')
    for (let i = 0; i < 10; i++) {
      const isUp = await validateLhmService(800)
      if (isUp) {
        console.log('[Main] Hardware monitor server is LIVE.')
        setLhmAlive(true)
        break
      }
      await new Promise(r => setTimeout(r, 1000))
    }

    // 3️⃣ 🔥 Background Watchdog (Self-Healing)
    // Checks health every 5 seconds to handle runtime crashes or delayed starts
    setInterval(async () => {
      const isUp = await validateLhmService(500) // Fast 500ms heartbeat
      setLhmAlive(isUp)
      
      // Optional: Auto-relaunch if crashed and not running in tasklist
      // (Simplified: we prioritize mode-switching over aggressive relaunching)
    }, 5000)

  } catch (err: any) {
    console.warn('[Main] Non-fatal launch error:', err.message)
    setLhmAlive(false)
  }
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const updater = UpdaterService.getInstance()
  updater.setMainWindow(mainWindow)
  updater.init()

  return mainWindow
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.drivewatch.app')

  // 🚀 Start Monitoring Subsystem (Self-Healing Watchdog)
  // Disabled as per user request to remove LibreHardwareMonitor
  // if (process.platform === 'win32') {
  //   startHardwareMonitor() 
  // }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // --- IPC HANDLERS ---
  ipcMain.handle('is-admin', async () => {
    try {
      if (process.platform === 'win32') {
        execSync('net session', { stdio: 'ignore' })
      } else {
        const uid = execSync('id -u').toString().trim()
        if (uid !== '0') return false
      }
      return true
    } catch { return false }
  })

  ipcMain.handle('get-disk-data', async () => {
    try { return await getDiskData() } catch { return [] }
  })

  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })

  ipcMain.handle('get-fan-rpm', async () => {
    try { return await getCpuFanRpm() } catch { return null }
  })

  ipcMain.handle('get-system-stats', async () => {
    try { return await getSystemStats() } catch { return null }
  })

  ipcMain.handle('get-gpu-stats', async () => {
    try { return await getGpuUsage() } catch { return [] }
  })

  ipcMain.handle('eject-drive', async (_, driveLetter: string, diskIndex: number) => {
    return await DeviceEjectService.safelyEjectDrive(driveLetter, diskIndex)
  })

  ipcMain.handle('health:get-drives', async () => {
    const disks = await getDiskData()
    return disks.map((d) => ({ ...d }))
  })

  ipcMain.handle('health:check-fs', async (_, drive) => {
    return await checkDriveFsHealth(drive)
  })

  ipcMain.handle('health:run-smart', async (_, idx) => await runSmartScan(idx))
  ipcMain.handle('health:quick-check', async () => await runQuickHealthCheck())
  
  ipcMain.handle('health:run-chkdsk', async (event, drive, mode = 'scan') => {
    return await runChkdskAction(drive, mode,
      (line) => event.sender.send('health:chkdsk-output', { driveLetter: drive, line }),
      (pct) => event.sender.send('health:chkdsk-progress', { driveLetter: drive, progress: pct })
    )
  })

  ipcMain.handle('health:schedule-reboot', async (_, drive) => {
    return await scheduleRebootRepair(drive)
  })

  ipcMain.handle('health:get-score', async (_, p) => calculateHealthScore(p))

  let activeChkdskSignal: AbortController | null = null

  ipcMain.on('scan-disk', async (event, drive) => {
    console.log(`[Scanner] Starting scan for ${drive}`)
    if (activeChkdskSignal) activeChkdskSignal.abort()
    activeChkdskSignal = new AbortController()

    event.sender.send('scan-output', { line: '[INFO] Initializing engine...' })
    
    try {
      const res = await runChkdskAction(drive, 'scan',
        (line) => event.sender.send('scan-output', { line }),
        (progress) => event.sender.send('scan-progress', { progress }),
        activeChkdskSignal.signal
      )
      event.sender.send('scan-finished', { success: res.clean })
    } catch (err: any) {
      event.sender.send('scan-output', { line: `[ERROR] ${err.message}` })
      event.sender.send('scan-finished', { success: false })
    } finally {
      activeChkdskSignal = null
    }
  })

  ipcMain.on('fix-disk', async (event, drive) => {
    console.log(`[Scanner] Starting fix for ${drive}`)
    if (activeChkdskSignal) activeChkdskSignal.abort()
    activeChkdskSignal = new AbortController()

    event.sender.send('scan-output', { line: '[INFO] Initializing fix engine...' })

    try {
      const res = await runChkdskAction(drive, 'scan',
        (line) => event.sender.send('scan-output', { line }),
        (progress) => event.sender.send('scan-progress', { progress }),
        activeChkdskSignal.signal
      )
      event.sender.send('scan-finished', { success: res.clean })
    } catch (err: any) {
      event.sender.send('scan-output', { line: `[ERROR] ${err.message}` })
      event.sender.send('scan-finished', { success: false })
    } finally {
      activeChkdskSignal = null
    }
  })

  ipcMain.on('stop-scan', () => {
    console.log(`[Scanner] Stop requested`)
    if (activeChkdskSignal) {
      activeChkdskSignal.abort()
      activeChkdskSignal = null
    }
  })

  ipcMain.handle('storage:list', async (_, path) => await storageScanner.listFolder(path))
  
  ipcMain.on('storage:scan', (event, path) => {
    // Set up listeners for this specific scan session
    const onProgress = (node: any) => event.sender.send('storage:progress', node)
    const onDone = () => event.sender.send('storage:done')
    
    storageScanner.once('done', () => {
      storageScanner.off('progress', onProgress)
    })
    
    storageScanner.on('progress', onProgress)
    storageScanner.once('done', onDone)
    
    storageScanner.scanFolder(path)
  })

  ipcMain.on('storage:stop', () => storageScanner.stopScan())
  ipcMain.handle('storage:get-suggestions', (_, path) => storageScanner.getSuggestions(path))
  ipcMain.handle('storage:delete', async (_, paths) => {
    let count = 0; const errors: string[] = []
    for (const p of paths) {
      try { await shell.trashItem(p); count++ } catch (err: any) { errors.push(err.message) }
    }
    return { success: errors.length === 0, deletedCount: count, errors }
  })

  // --- STORAGE HEALTH CENTER IPC ---
  ipcMain.handle('diagnostics:scan', async (_, forceRefresh?: boolean) => {
    const taskId = `diagnostics-all-${Date.now()}`
    scanTaskManager.createTask({
      taskId,
      driveId: 'all',
      diskIndex: null,
      driveName: 'All Drives',
      scanType: 'diagnostics',
      scanMode: 'full'
    })
    scanTaskManager.setStatus(taskId, 'running')
    try {
      const result = await runStorageDiagnostics(forceRefresh ?? false)
      scanTaskManager.updateProgress(taskId, { progress: 100 })
      scanTaskManager.setStatus(taskId, 'done')
      return result
    } catch (err: any) {
      scanTaskManager.setStatus(taskId, 'error', err.message)
      return { error: err.message, overallScore: 0, overallStatus: 'critical', firmware: [], drivers: [], controllers: [], trimStatus: [], eventLogs: [], recommendations: [], issueCount: { info: 0, low: 0, medium: 0, high: 0, critical: 0 }, timestamp: new Date().toISOString(), platform: process.platform, scanDurationMs: 0 }
    }
  })

  ipcMain.handle('diagnostics:export', async () => {
    try { return await exportDiagnosticsReport() }
    catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('diagnostics:export-json', async () => {
    try { return await exportDiagnosticsJson() }
    catch (err: any) { return { success: false, error: err.message } }
  })

  // --- RECOVERY LAB IPC ---
  ipcMain.on('recovery:start-scan', (_, { drivePath, mode }) => {
    recoveryEngine?.startScan(drivePath, mode)
  })

  ipcMain.on('recovery:pause-scan', () => {
    recoveryEngine?.pauseScan()
  })

  ipcMain.on('recovery:resume-scan', () => {
    recoveryEngine?.resumeScan()
  })

  ipcMain.on('recovery:stop-scan', () => {
    recoveryEngine?.stopScan()
  })

  ipcMain.handle('recovery:recover-file', async (_, { file, destinationPath }) => {
    // If no destination provided, show folder picker
    let dest = destinationPath
    if (!dest && recoveryEngine) {
      dest = await recoveryEngine.selectDestination()
      if (!dest) return { success: false, error: 'No destination selected' }
    }
    return await recoveryEngine?.recoverFile(file, dest)
  })

  ipcMain.handle('recovery:select-destination', async () => {
    return await recoveryEngine?.selectDestination()
  })

  // --- NAS MONITORING IPC ---
  const nasService = await import('./services/nasService')

  ipcMain.handle('nas:discover', async () => {
    try { return await nasService.discoverNASDevices() }
    catch (err: any) { return { devices: [], scanDurationMs: 0, networkRange: '', error: err.message } }
  })

  ipcMain.handle('nas:test-connection', async (_, config) => {
    try { return await nasService.testNASConnection(config) }
    catch (err: any) { return { success: false, latencyMs: 0, error: err.message } }
  })

  ipcMain.handle('nas:ping', async (_, host) => {
    try { return await nasService.pingNASDevice(host) }
    catch { return { online: false, latencyMs: -1 } }
  })

  ipcMain.handle('nas:storage-info', async (_, host, shareName) => {
    try { return await nasService.getNASStorageInfo(host, shareName) }
    catch (err: any) { return { totalCapacity: 0, usedSpace: 0, freeSpace: 0, usagePercent: 0, error: err.message } }
  })

  // Real TrueNAS data fetch (SSH-based)
  const nasDataService = await import('./services/nasDataService')

  ipcMain.handle('nas:fetch-data', async (_, config: { host: string; username: string; password: string; port?: number; protocol?: string; shares?: string[] }) => {
    try {
      // Route 1: SSH protocol — full TrueNAS data via SSH commands
      if (config.protocol === 'ssh') {
        const data = await nasDataService.fetchTrueNASData(config.host, config.username, config.password, config.port || 22)
        
        // Accept partial data: If we got pools OR disks OR datasets, we successfully authenticated and parsed something.
        if ((data.pools && data.pools.length > 0) || (data.disks && data.disks.length > 0) || (data.datasets && data.datasets.length > 0)) {
          return { success: true, ...data }
        }
        
        // STRICT SSH: Never silently fall back to SMB if user explicitly chose SSH
        if (data.error) {
          return { success: false, pools: [], datasets: [], shares: [], disks: [], error: `SSH Authentication or Command Failed: ${data.error}` }
        }
        return { success: false, pools: [], datasets: [], shares: [], disks: [], error: 'SSH connection succeeded but returned no valid storage data. Check TrueNAS permissions.' }
      }

      // Route 2: SMB protocol — enumerate shares and query each share's storage
      // First get the list of shares from discovery or from config
      let shareList = config.shares || []
      if (shareList.length === 0) {
        try {
          const { exec: cpExec } = await import('child_process')
          const { promisify: pUtil } = await import('util')
          const runCmd = pUtil(cpExec)
          const { stdout } = await runCmd(`net view \\\\${config.host} /all 2>nul`, { timeout: 8000 })
          const lines = stdout.split('\n').filter((l: string) => l.includes('Disk'))
          shareList = lines.map((l: string) => l.trim().split(/\s{2,}/)[0]).filter(Boolean)
        } catch { /* enumeration failure is non-critical */ }
      }

      if (shareList.length > 0) {
        const smb = await nasDataService.fetchSMBShareStorage(config.host, shareList, config.username, config.password)
        if (smb.volumes && smb.volumes.length > 0) {
          return { success: true, pools: [], datasets: [], shares: [], disks: [], smbVolumes: smb.volumes }
        }
      }

      return { success: false, pools: [], datasets: [], shares: [], disks: [], error: 'Could not retrieve storage data' }
    } catch (err: any) {
      return { success: false, pools: [], datasets: [], shares: [], disks: [], error: err.message }
    }
  })

  // NAS live I/O stats via SSH (iostat/diskstats/zpool)
  ipcMain.handle('nas:io-stats', async (_, config: { host: string; username: string; password: string; port?: number }) => {
    try {
      const { executeSSH } = await import('./services/NASSSH/commands')
      const escapedPw = config.password.replace(/'/g, "'\\''")
      const sudoCmd = config.username === 'root' ? '' : `echo '${escapedPw}' | sudo -S `

      // Query ALL disk I/O using multiple methods for maximum coverage
      // 1. zpool iostat for pooled disks
      // 2. iostat for ALL physical disks (including non-pooled ones like PNY CS900)
      const [zpoolOut, iostatOut] = await Promise.all([
        executeSSH(
          config.host, config.username, config.password,
          `export PATH=$PATH:/sbin:/usr/sbin:/usr/local/sbin; ${sudoCmd} zpool iostat -v 1 2 2>/dev/null | tail -50`,
          config.port || 22
        ).catch(() => ''),
        executeSSH(
          config.host, config.username, config.password,
          `export PATH=$PATH:/sbin:/usr/sbin:/usr/local/sbin; cat /proc/diskstats 2>/dev/null || iostat -dxI 2>/dev/null || ${sudoCmd} iostat -dx 2>/dev/null`,
          config.port || 22
        ).catch(() => '')
      ])

      const disks: { name: string; readSectors: number; writeSectors: number }[] = []
      const seenDevices = new Set<string>()
      let format = 'unknown'

      // Parse zpool iostat (pooled disks)
      if (zpoolOut && (zpoolOut.includes('alloc') || zpoolOut.includes('bandwidth'))) {
        const lines = zpoolOut.split('\n')
        let inSecondReport = false
        let dashCount = 0
        for (const line of lines) {
          if (line.includes('---')) { dashCount++; if (dashCount >= 2) inSecondReport = true; continue }
          if (!inSecondReport) continue
          // Skip pool-level aggregate lines (not indented with spaces)
          // Disk lines in zpool iostat -v are indented with 2+ spaces
          if (!/^\s{2,}/.test(line) && !/^\t/.test(line)) continue
          const parts = line.trim().split(/\s+/)
          if (parts.length >= 7 && /^(da|ada|nvme|nvd|sd|mfid|vtbd)/.test(parts[0])) {
            const parseBW = (s: string): number => {
              if (!s || s === '0' || s === '-') return 0
              const m = s.match(/^([\d.]+)([KMG]?)/)
              if (!m) return 0
              const num = parseFloat(m[1])
              if (m[2] === 'K') return num * 1024
              if (m[2] === 'M') return num * 1024 * 1024
              if (m[2] === 'G') return num * 1024 * 1024 * 1024
              return num
            }
            const name = parts[0].replace(/[sp]\d+$/, '') // ada0s1 → ada0
            if (!seenDevices.has(name)) {
              seenDevices.add(name)
              const readBps = parseBW(parts[5])
              const writeBps = parseBW(parts[6])
              // Sanity clamp: max realistic per-disk throughput is 600 MB/s (NVMe) or 200 MB/s (SATA)
              const maxBps = 600 * 1024 * 1024
              disks.push({
                name,
                readSectors: Math.round(Math.min(readBps, maxBps) / 512),
                writeSectors: Math.round(Math.min(writeBps, maxBps) / 512)
              })
            }
          }
        }
        if (disks.length > 0) format = 'zpool-rate'
      }

      // Parse iostat / diskstats for ALL disks (catches non-pooled drives)
      if (iostatOut) {
        const lines = iostatOut.split('\n')
        const isLinux = lines.some(l => /^\s*\d+\s+\d+\s+(sd|nvme|vd)/.test(l))

        if (isLinux) {
          for (const line of lines) {
            const parts = line.trim().split(/\s+/)
            if (parts.length >= 10 && /^(sd|da|ada|nvme|md|vd|xvd)/.test(parts[2])) {
              if (/\d+$/.test(parts[2]) && !/^(md\d+|nvme\d+n\d+)$/.test(parts[2])) continue
              if (!seenDevices.has(parts[2])) {
                seenDevices.add(parts[2])
                disks.push({ name: parts[2], readSectors: parseInt(parts[5]) || 0, writeSectors: parseInt(parts[9]) || 0 })
              }
            }
          }
          if (format === 'unknown') format = 'linux'
        } else {
          // FreeBSD iostat -dxI or iostat -dx
          for (const line of lines) {
            const parts = line.trim().split(/\s+/)
            if (parts.length >= 5 && /^(da|ada|nvme|nvd|md|vtbd|mfid)/.test(parts[0])) {
              const name = parts[0]
              if (!seenDevices.has(name)) {
                seenDevices.add(name)
                // iostat -dxI: device r/s w/s kr/s kw/s
                const readKB = parseFloat(parts[3]) || parseFloat(parts[1]) || 0
                const writeKB = parseFloat(parts[4]) || parseFloat(parts[2]) || 0
                disks.push({ name, readSectors: Math.round(readKB * 2), writeSectors: Math.round(writeKB * 2) })
              }
            }
          }
          if (format === 'unknown' && disks.length > 0) format = 'freebsd-iostat'
        }
      }

      // Combine: if zpool gave rates and iostat also gave rates, mark as rate-based
      if (format === 'zpool-rate' || format === 'freebsd-iostat') format = 'zpool-rate'

      console.log(`[NAS IO] Fetched ${disks.length} disks (format=${format}): ${disks.map(d => `${d.name}:r=${d.readSectors},w=${d.writeSectors}`).join(', ')}`)

      return { success: true, disks, timestamp: Date.now(), format }
    } catch (err: any) {
      return { success: false, disks: [], timestamp: Date.now(), error: err.message }
    }
  })

  // ── SURFACE SCAN IPC ──────────────────────────────────────────────────────
  // All operations are safe, READ-ONLY, and additive to the existing codebase.

  ipcMain.on('surface:start', (event, diskIndex: number, mode: string, model?: string, serial?: string, devicePath?: string, executionMode?: string) => {
    console.log(`[SurfaceScan] Starting ${mode} scan on disk ${diskIndex} | executionMode="${executionMode ?? 'REAL_SCAN'}" model="${model ?? ''}" serial="${serial ?? ''}" device="${devicePath ?? `\\\\.\\PhysicalDrive${diskIndex}`}"`)

    // Register background task
    const taskId = `surface-${diskIndex}-${Date.now()}`
    const task = scanTaskManager.createTask({
      taskId,
      driveId: `disk_${diskIndex}`,
      diskIndex,
      driveName: model || `Disk ${diskIndex}`,
      scanType: 'surface',
      scanMode: mode
    })
    scanTaskManager.setStatus(taskId, 'running')

    startSurfaceScan(
      diskIndex,
      mode as any,
      {
        onProgress: (p) => {
          event.sender.send('surface:progress', p)
          scanTaskManager.updateProgress(taskId, {
            progress: p.percent,
            speedMBs: p.readSpeedMBs,
            etaSec: p.etaSec,
            telemetry: {
              currentLba: p.currentLba,
              totalLbas: p.totalLbas,
              errorCount: p.errorCount,
              slowCount: p.slowCount,
              temperature: p.temperature,
              healthPct: p.healthPct,
              executionMode: p.executionMode
            }
          })
        },
        onDone: (r) => {
          event.sender.send('surface:done', r)
          scanTaskManager.updateProgress(taskId, { progress: 100 })
          scanTaskManager.setStatus(taskId, r.cancelled ? 'cancelled' : 'done')
        },
        onError: (msg) => {
          event.sender.send('surface:error', msg)
          scanTaskManager.setStatus(taskId, 'error', msg)
        }
      },
      model ?? '',
      serial ?? '',
      devicePath ?? '',
      executionMode === 'SIMULATION_MODE' ? 'SIMULATION_MODE' : 'REAL_SCAN'
    ).catch((err) => {
      console.error('[SurfaceScan] Fatal:', err)
      event.sender.send('surface:error', err?.message ?? 'Unknown error')
      scanTaskManager.setStatus(taskId, 'error', err?.message ?? 'Unknown error')
    })
  })

  ipcMain.on('surface:pause', (_, diskIndex: number) => {
    pauseSurfaceScan(diskIndex)
    // Find the running surface task for this disk and mark paused
    const task = scanTaskManager.getAllTasks().find(
      t => t.scanType === 'surface' && t.diskIndex === diskIndex && t.status === 'running'
    )
    if (task) scanTaskManager.setStatus(task.taskId, 'paused')
  })

  ipcMain.on('surface:resume', (_, diskIndex: number) => {
    resumeSurfaceScan(diskIndex)
    const task = scanTaskManager.getAllTasks().find(
      t => t.scanType === 'surface' && t.diskIndex === diskIndex && t.status === 'paused'
    )
    if (task) scanTaskManager.setStatus(task.taskId, 'running')
  })

  ipcMain.on('surface:stop', (_, diskIndex: number) => {
    stopSurfaceScan(diskIndex)
    const task = scanTaskManager.getAllTasks().find(
      t => t.scanType === 'surface' && t.diskIndex === diskIndex && (t.status === 'running' || t.status === 'paused')
    )
    if (task) scanTaskManager.setStatus(task.taskId, 'cancelled')
  })

  ipcMain.handle('surface:is-active', (_, diskIndex: number) => {
    return isSurfaceScanActive(diskIndex)
  })
  
  ipcMain.handle('surface:get-last-result', (_, diskIndex: number, model?: string, serial?: string, devicePath?: string) => {
    const allIndices: number[] = getAllStoredDiskIndices()
    console.log(`[ScanStore] 🔍 IPC get-last-result: diskIndex=${diskIndex}, model="${model ?? ''}", serial="${serial ?? ''}", storedKeys=[${allIndices.join(', ')}]`)

    // Use full multi-stage lookup (serial -> model -> devicePath -> partial model).
    const result = findBestScanResult(diskIndex, model, serial, devicePath)

    if (result) {
      console.log(`[ScanStore] ✅ IPC result found: storedDiskIndex=${result.diskIndex}, slowCount=${result.slowCount}, errorCount=${result.errorCount}`)
      return result
    }

    console.warn(`[ScanStore] ❌ IPC: No scan result found for diskIndex=${diskIndex}. Run Surface Scan first.`)
    return null
  })

  // ── SECTOR STABILIZER IPC ──────────────────────────────────────────────────
  ipcMain.on('stabilizer:start', (event, diskIndex: number, mode: string) => {
    console.log(`[Stabilizer] Starting ${mode} on disk ${diskIndex}`)

    const taskId = `stabilizer-${diskIndex}-${Date.now()}`
    scanTaskManager.createTask({
      taskId,
      driveId: `disk_${diskIndex}`,
      diskIndex,
      driveName: `Disk ${diskIndex}`,
      scanType: 'stabilizer',
      scanMode: mode
    })
    scanTaskManager.setStatus(taskId, 'running')

    startStabilizer(diskIndex, mode as any, {
      onProgress: (p) => {
        event.sender.send('stabilizer:progress', p)
        scanTaskManager.updateProgress(taskId, {
          progress: p.percent,
          speedMBs: p.speedMBs,
          etaSec: p.etaSec,
          telemetry: {
            phase: p.phase,
            stableSectors: p.stableSectors,
            weakSectors: p.weakSectors,
            unstableSectors: p.unstableSectors,
            unreadableSectors: p.unreadableSectors,
            remappedSectors: p.remappedSectors,
            temperature: p.temperature
          }
        })
      },
      onDone: (r) => {
        event.sender.send('stabilizer:done', r)
        scanTaskManager.updateProgress(taskId, { progress: 100 })
        scanTaskManager.setStatus(taskId, r.cancelled ? 'cancelled' : 'done')
      },
      onError: (msg) => {
        event.sender.send('stabilizer:error', msg)
        scanTaskManager.setStatus(taskId, 'error', msg)
      }
    }).catch((err) => {
      event.sender.send('stabilizer:error', err?.message ?? 'Unknown error')
      scanTaskManager.setStatus(taskId, 'error', err?.message ?? 'Unknown error')
    })
  })

  ipcMain.on('stabilizer:pause', (_, diskIndex: number) => {
    pauseStabilizer(diskIndex)
    const task = scanTaskManager.getAllTasks().find(
      t => t.scanType === 'stabilizer' && t.diskIndex === diskIndex && t.status === 'running'
    )
    if (task) scanTaskManager.setStatus(task.taskId, 'paused')
  })

  ipcMain.on('stabilizer:resume', (_, diskIndex: number) => {
    resumeStabilizer(diskIndex)
    const task = scanTaskManager.getAllTasks().find(
      t => t.scanType === 'stabilizer' && t.diskIndex === diskIndex && t.status === 'paused'
    )
    if (task) scanTaskManager.setStatus(task.taskId, 'running')
  })

  ipcMain.on('stabilizer:stop', (_, diskIndex: number) => {
    stopStabilizer(diskIndex)
    const task = scanTaskManager.getAllTasks().find(
      t => t.scanType === 'stabilizer' && t.diskIndex === diskIndex && (t.status === 'running' || t.status === 'paused')
    )
    if (task) scanTaskManager.setStatus(task.taskId, 'cancelled')
  })

  ipcMain.handle('stabilizer:is-active', (_, diskIndex: number) => isStabilizerActive(diskIndex))

  // ── TASK REGISTRY IPC ──────────────────────────────────────────────────────
  // Renderer can request a full snapshot at any time (e.g. after navigation)
  ipcMain.handle('tasks:get-all', () => scanTaskManager.getAllTasks())
  ipcMain.handle('tasks:get-active', () => scanTaskManager.getActiveTasks())
  ipcMain.on('tasks:request-snapshot', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) scanTaskManager.sendSnapshotTo(win)
  })
  ipcMain.on('tasks:remove', (_, taskId: string) => {
    scanTaskManager.removeTask(taskId)
  })

  const mainWindow = createWindow()
  recoveryEngine = new RecoveryEngine(mainWindow)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
