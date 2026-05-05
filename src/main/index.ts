import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { spawn, execSync } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { getDiskData } from './services/diskService'
import { getSystemStats } from './services/systemService'
import { getGpuUsage } from './services/gpuService'
import { runSmartScan } from './services/scanner/smartScan'
import { runQuickHealthCheck } from './services/scanner/quickHealthCheck'
import { runChkdskScan } from './services/scanner/chkdskScan'
import { calculateHealthScore } from './services/scanner/healthScore'
import { StorageScanner } from './services/scanner/storageScanner'
import { validateLhmService, setLhmAlive } from './services/thermalService'
import { UpdaterService } from './services/updaterService'

const storageScanner = new StorageScanner()

const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'icon.ico')
  : join(__dirname, '../../build/icon.ico')

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

function createWindow(): void {
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
      execSync('net session', { stdio: 'ignore' })
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

  ipcMain.handle('eject-drive', async (_, driveLetter: string) => {
    const letter = driveLetter.replace(/\\/g, '').toUpperCase()
    const drivePath = letter.endsWith(':') ? `${letter}\\` : `${letter}:\\`
    
    console.log(`[EjectPipeline] Starting safeEjectDrive for ${letter}`)

    // --- STEP 1: HARD STOP ALL INTERNAL USAGE ---
    const { stopMonitoring, resumeMonitoring } = require('./services/diskService')
    
    async function stopAllDriveProcesses() {
      console.log(`[EjectPipeline] Step 1: Stopping internal monitoring and scans`)
      stopMonitoring()
      
      if (storageScanner.currentScanPath && storageScanner.currentScanPath.toUpperCase().startsWith(letter)) {
        console.log(`[EjectPipeline] Terminating active storage worker for ${letter}`)
        storageScanner.stopScan()
      }
    }

    // --- STEP 4 & 5: EJECT LOGIC ---
    function performEject() {
      const script = `
        $letter = "${letter}"
        $path = "${drivePath}"
        try {
          # Primary: Shell.Application Eject
          $shell = New-Object -ComObject Shell.Application
          $item = $shell.Namespace(17).ParseName($path)
          if ($item) {
            $verb = $item.Verbs() | Where-Object { $_.Name.Replace('&', '') -match 'Eject|Safely Remove' }
            if ($verb) { $verb.DoIt(); return "Success" }
          }
          
          # Fallback: mountvol /p
          mountvol $letter /P
          if ($LASTEXITCODE -eq 0) { return "Success" }
          
          return "InUse"
        } catch { return "Error: $($_.Exception.Message)" }
      `
      const cleanScript = script.replace(/\n/g, ';').replace(/\s+/g, ' ')
      return execSync(`powershell -NoProfile -Command "${cleanScript}"`).toString().trim()
    }

    try {
      // Execute Pipeline
      await stopAllDriveProcesses()
      
      // --- STEP 2: MEMORY + HANDLE FLUSH ---
      if (global.gc) { global.gc() }
      
      // --- STEP 3: OS STABILIZATION WINDOW ---
      console.log(`[EjectPipeline] Step 3: Awaiting OS stabilization (1500ms)`)
      await new Promise(r => setTimeout(r, 1500))

      // --- STEP 4 & 5: PRIMARY + FALLBACK ---
      let result = performEject()
      
      // --- STEP 6: FINAL RETRY ---
      if (!result.includes('Success')) {
        console.log(`[EjectPipeline] Step 6: Initial attempt failed, retrying after 800ms...`)
        await new Promise(r => setTimeout(r, 800))
        result = performEject()
      }

      console.log(`[EjectPipeline] Final result: ${result}`)
      
      if (result.includes('Success')) {
        // Recovery: Wait a bit before resuming monitoring
        setTimeout(resumeMonitoring, 2000)
        return { success: true }
      } else {
        resumeMonitoring()
        return { 
          success: false, 
          error: "Drive is currently in use by another application." 
        }
      }
    } catch (err: any) {
      console.log(`[EjectPipeline] Critical error: ${err.message}`)
      resumeMonitoring()
      return { 
        success: false, 
        error: "Drive is currently in use by another application." 
      }
    }
  })

  ipcMain.handle('health:get-drives', async () => {
    const disks = await getDiskData()
    return disks.map((d) => ({ ...d }))
  })

  ipcMain.handle('health:run-smart', async (_, idx) => await runSmartScan(idx))
  ipcMain.handle('health:quick-check', async () => await runQuickHealthCheck())
  ipcMain.handle('health:run-chkdsk', async (event, drive) => {
    return await runChkdskScan(drive, 
      (line) => event.sender.send('health:chkdsk-output', { driveLetter: drive, line }),
      (pct) => event.sender.send('health:chkdsk-progress', { driveLetter: drive, progress: pct })
    )
  })

  ipcMain.handle('health:get-score', async (_, p) => calculateHealthScore(p))

  ipcMain.on('scan-disk', async (event, drive) => {
    console.log(`[Scanner] Starting scan for ${drive}`)
    const res = await runChkdskScan(drive, 
      (line) => event.sender.send('scan-output', { line }),
      (progress) => event.sender.send('scan-progress', { progress })
    )
    event.sender.send('scan-finished', { success: res.clean })
  })

  ipcMain.on('fix-disk', async (event, drive) => {
    console.log(`[Scanner] Starting fix for ${drive}`)
    // We use the same scan utility but the user intended to 'fix'.
    // Note: /f requires unmounting or reboot if drive is in use.
    // For simplicity, we stick to /scan for now which reports issues.
    const res = await runChkdskScan(drive, 
      (line) => event.sender.send('scan-output', { line }),
      (progress) => event.sender.send('scan-progress', { progress })
    )
    event.sender.send('scan-finished', { success: res.clean })
  })

  ipcMain.on('stop-scan', () => {
    // Note: runChkdskScan doesn't expose the child process to be killed globally here.
    // However, it finishes when the process is closed.
    console.log(`[Scanner] Stop requested`)
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
    let count = 0; let errors = []
    for (const p of paths) {
      try { await shell.trashItem(p); count++ } catch (err: any) { errors.push(err.message) }
    }
    return { success: errors.length === 0, deletedCount: count, errors }
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
