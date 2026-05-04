import { autoUpdater, UpdateInfo } from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log'

// Configure logging
autoUpdater.logger = log
// @ts-ignore
autoUpdater.logger.transports.file.level = 'info'

export class UpdaterService {
  private static instance: UpdaterService
  private mainWindow: BrowserWindow | null = null

  private constructor() {
    this.setupListeners()
    this.setupIpc()
  }

  public static getInstance(): UpdaterService {
    if (!UpdaterService.instance) {
      UpdaterService.instance = new UpdaterService()
    }
    return UpdaterService.instance
  }

  public setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  private setupListeners(): void {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      this.sendToRenderer('update-status', { status: 'checking' })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.sendToRenderer('update-status', { 
        status: 'available', 
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseDate: info.releaseDate
      })
    })

    autoUpdater.on('update-not-available', () => {
      this.sendToRenderer('update-status', { status: 'not-available' })
    })

    autoUpdater.on('download-progress', (progressObj) => {
      this.sendToRenderer('update-status', { 
        status: 'downloading', 
        progress: progressObj.percent,
        bytesPerSecond: progressObj.bytesPerSecond,
        totalBytes: progressObj.total,
        transferredBytes: progressObj.transferred
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      this.sendToRenderer('update-status', { 
        status: 'ready',
        version: info.version
      })
    })

    autoUpdater.on('error', (err) => {
      log.error('Updater Error:', err)
      this.sendToRenderer('update-status', { 
        status: 'error', 
        error: err.message || 'Unknown update error' 
      })
    })
  }

  private setupIpc(): void {
    ipcMain.on('updater:check', () => {
      autoUpdater.checkForUpdates().catch(err => {
        log.error('Check for updates failed:', err)
      })
    })

    ipcMain.on('updater:download', () => {
      autoUpdater.downloadUpdate().catch(err => {
        log.error('Download update failed:', err)
      })
    })

    ipcMain.on('updater:install', () => {
      autoUpdater.quitAndInstall()
    })
  }

  private sendToRenderer(channel: string, data: any): void {
    if (this.mainWindow) {
      this.mainWindow.webContents.send(channel, data)
    }
  }

  public init(): void {
    // Initial check on app start
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      log.error('Initial check for updates failed:', err)
    })
  }
}
