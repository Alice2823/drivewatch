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

  const mainWindow = createWindow()
  recoveryEngine = new RecoveryEngine(mainWindow)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
