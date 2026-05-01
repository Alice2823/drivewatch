import { app, shell, BrowserWindow, ipcMain, Notification } from 'electron'

import { join } from 'path'
import { spawn, ChildProcess, execSync } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getDiskData } from './services/diskService'
import { getSystemStats } from './services/systemService'

const activeScans = new Map<string, ChildProcess>()

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon,
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

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.drivewatch')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // ── Admin Check ──
  ipcMain.handle('is-admin', async () => {
    try {
      execSync('net session', { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })

  // ── Disk Data (on-demand from renderer) ──
  ipcMain.handle('get-disk-data', async () => {
    try {
      return await getDiskData()
    } catch (error: any) {
      console.error('[Main] getDiskData error:', error.message)
      return []
    }
  })

  // ── System Stats (CPU, RAM, Temp) ──
  ipcMain.handle('get-system-stats', async () => {
    try {
      return await getSystemStats()
    } catch (error: any) {
      console.error('[Main] getSystemStats error:', error.message)
      return { cpuUsage: 0, cpuTemp: null, ramUsage: 0 }
    }
  })

  // ── Drive Scan ──
  ipcMain.on('scan-disk', (event, drivePath: string) => {
    try {
      if (activeScans.has(drivePath)) {
        console.log('[Main] Scan already in progress for:', drivePath)
        event.reply('scan-output', { drivePath, line: '[INFO] Scan already in progress for this drive.' })
        return
      }

      console.log('[Main] Starting scan for:', drivePath)
      event.reply('scan-output', { drivePath, line: `[INFO] Starting chkdsk /scan on ${drivePath}...` })

      const child = spawn('chkdsk', [drivePath, '/scan'], {
        windowsHide: true
      })
      activeScans.set(drivePath, child)

      child.stdout.on('data', (data) => {
        const output = data.toString()
        const lines = output.split('\n').filter((l: string) => l.trim())

        for (const line of lines) {
          event.reply('scan-output', { drivePath, line: line.trim() })

          // Parse progress percentage
          const match = line.match(/(\d+)\s*percent\s*complete/i)
          if (match) {
            const progress = parseInt(match[1])
            event.reply('scan-progress', { drivePath, progress })
          }
        }
      })

      child.stderr.on('data', (data) => {
        const output = data.toString()
        const lines = output.split('\n').filter((l: string) => l.trim())
        for (const line of lines) {
          event.reply('scan-output', { drivePath, line: `[ERROR] ${line.trim()}` })
        }
      })

      child.on('close', (code) => {
        activeScans.delete(drivePath)
        event.reply('scan-output', {
          drivePath,
          line: code === 0
            ? '[DONE] Scan completed successfully. No issues found.'
            : `[DONE] Scan finished with exit code ${code}.`
        })
        event.reply('scan-finished', { drivePath, success: code === 0, code })
      })

      child.on('error', (err) => {
        activeScans.delete(drivePath)
        event.reply('scan-output', { drivePath, line: `[ERROR] ${err.message}` })
        event.reply('scan-finished', { drivePath, success: false, error: err.message })
      })
    } catch (error: any) {
      activeScans.delete(drivePath)
      event.reply('scan-output', { drivePath, line: `[ERROR] ${error.message}` })
      event.reply('scan-finished', { drivePath, success: false, error: error.message })
    }
  })

  // ── Fix Disk ──
  ipcMain.on('fix-disk', (event, drivePath: string) => {
    try {
      if (activeScans.has(drivePath)) {
        event.reply('scan-output', { drivePath, line: '[INFO] An operation is already in progress for this drive.' })
        return
      }

      console.log('[Main] Starting fix for:', drivePath)
      event.reply('scan-output', { drivePath, line: `[INFO] Starting deep repair (chkdsk /f /x) on ${drivePath}...` })

      const child = spawn('chkdsk', [drivePath, '/f', '/x'], {
        windowsHide: true
      })
      activeScans.set(drivePath, child)

      child.stdout.on('data', (data) => {
        const output = data.toString()
        const lines = output.split('\n').filter((l: string) => l.trim())
        for (const line of lines) {
          event.reply('scan-output', { drivePath, line: line.trim() })
          
          // Automatically confirm scheduling on reboot if prompted
          if (line.includes('(Y/N)?')) {
            event.reply('scan-output', { drivePath, line: '[INFO] Volume is in use. Automatically scheduling repair for the next reboot...' })
            child.stdin.write('Y\n')
          }

          if (line.includes('cannot run because the volume is in use') || line.includes('schedule this volume to be checked')) {
            event.reply('scan-output', { drivePath, line: '[SUCCESS] Repair has been scheduled. Please restart your computer to complete the process.' })
          }

          const match = line.match(/(\d+)\s*percent\s*complete/i)
          if (match) {
            const progress = parseInt(match[1])
            event.reply('scan-progress', { drivePath, progress })
          }
        }
      })

      child.stderr.on('data', (data) => {
        const output = data.toString()
        const lines = output.split('\n').filter((l: string) => l.trim())
        for (const line of lines) {
          event.reply('scan-output', { drivePath, line: `[ERROR] ${line.trim()}` })
        }
      })

      child.on('close', (code) => {
        activeScans.delete(drivePath)
        event.reply('scan-output', {
          drivePath,
          line: code === 0
            ? '[DONE] Repair operation completed or scheduled successfully.'
            : `[DONE] Repair operation finished. Exit code: ${code}.`
        })
        event.reply('scan-finished', { drivePath, success: code === 0, code })
      })

      child.on('error', (err) => {
        activeScans.delete(drivePath)
        event.reply('scan-output', { drivePath, line: `[ERROR] ${err.message}` })
        event.reply('scan-finished', { drivePath, success: false, error: err.message })
      })
    } catch (error: any) {
      activeScans.delete(drivePath)
      event.reply('scan-output', { drivePath, line: `[ERROR] ${error.message}` })
      event.reply('scan-finished', { drivePath, success: false, error: error.message })
    }
  })

  // ── Stop Scan ──
  ipcMain.on('stop-scan', (event, drivePath: string) => {
    const child = activeScans.get(drivePath)
    if (child && child.pid) {
      console.log('[Main] Stopping scan for:', drivePath)
      try {
        // On Windows, SIGTERM doesn't work reliably. Use taskkill.
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' })
        } else {
          child.kill('SIGTERM')
        }
      } catch {
        child.kill()
      }
      activeScans.delete(drivePath)
      event.reply('scan-output', { drivePath, line: '[INFO] Scan stopped by user.' })
      event.reply('scan-finished', { drivePath, success: false, error: 'Cancelled by user' })
    }
  })

  // ── Eject Drive ──
  ipcMain.handle('eject-drive', async (_, driveLetter: string) => {
    try {
      console.log('[Main] Ejecting drive:', driveLetter)
      const cleanLetter = driveLetter.endsWith(':') ? driveLetter : `${driveLetter}:`
      
      const script = `(New-Object -ComObject Shell.Application).Namespace(17).ParseName('${cleanLetter}').InvokeVerb('Eject')`
      execSync(`powershell -Command "${script}"`)

      // Show Native Windows Notification
      new Notification({
        title: 'Safe to Remove Hardware',
        body: `The '${cleanLetter}' drive can now be safely removed from the computer.`,
        silent: false
      }).show()

      return { success: true }
    } catch (error: any) {
      console.error('[Main] Eject failed:', error.message)
      
      new Notification({
        title: 'Eject Failed',
        body: `Could not eject drive ${driveLetter}. It might be in use.`,
        silent: false
      }).show()

      return { success: false, error: error.message }
    }
  })


  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
