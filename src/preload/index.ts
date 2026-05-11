import { contextBridge, ipcRenderer, shell } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const electron = {
  ...electronAPI,
  shell: {
    openExternal: (url: string) => shell.openExternal(url)
  }
}

// Custom APIs for renderer
const api = {
  getDiskData: () => ipcRenderer.invoke('get-disk-data'),
  getSystemStats: () => ipcRenderer.invoke('get-system-stats'),
  getGpuStats: () => ipcRenderer.invoke('get-gpu-stats'),
  isAdmin: () => ipcRenderer.invoke('is-admin'),

  // Scan operations
  scanDisk: (drivePath: string) => ipcRenderer.send('scan-disk', drivePath),
  fixDisk: (drivePath: string) => ipcRenderer.send('fix-disk', drivePath),
  stopDiskScan: (drivePath: string) => ipcRenderer.send('stop-scan', drivePath),
  ejectDrive: (driveLetter: string, diskIndex: number) => ipcRenderer.invoke('eject-drive', driveLetter, diskIndex),
  waitForThermalServer: () => ipcRenderer.invoke('thermal:wait'),
  restartThermalMonitor: () => ipcRenderer.send('thermal:restart'),

  // Scan event listeners
  onScanProgress: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('scan-progress', handler)
    return () => ipcRenderer.removeListener('scan-progress', handler)
  },
  onScanOutput: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('scan-output', handler)
    return () => ipcRenderer.removeListener('scan-output', handler)
  },
  onScanFinished: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('scan-finished', handler)
    return () => ipcRenderer.removeListener('scan-finished', handler)
  },
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Health Scanner
  health: {
    getDrives: () => ipcRenderer.invoke('health:get-drives'),
    runSmart: (diskIndex: number) => ipcRenderer.invoke('health:run-smart', diskIndex),
    quickCheck: () => ipcRenderer.invoke('health:quick-check'),
    checkFs: (driveLetter: string) => ipcRenderer.invoke('health:check-fs', driveLetter),
    runChkdsk: (driveLetter: string, mode?: string) => ipcRenderer.invoke('health:run-chkdsk', driveLetter, mode),
    scheduleReboot: (driveLetter: string) => ipcRenderer.invoke('health:schedule-reboot', driveLetter),
    getScore: (payload: any) => ipcRenderer.invoke('health:get-score', payload),

    onChkdskOutput: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('health:chkdsk-output', handler)
      return () => ipcRenderer.removeListener('health:chkdsk-output', handler)
    },
    onChkdskProgress: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('health:chkdsk-progress', handler)
      return () => ipcRenderer.removeListener('health:chkdsk-progress', handler)
    },
    onChkdskFinished: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('health:chkdsk-finished', handler)
      return () => ipcRenderer.removeListener('health:chkdsk-finished', handler)
    }
  },
  // Storage Explorer & Smart Cleaner
  storage: {
    list: (dirPath: string) => ipcRenderer.invoke('storage:list', dirPath),
    scan: (dirPath: string) => ipcRenderer.send('storage:scan', dirPath),
    stop: () => ipcRenderer.send('storage:stop'),
    getSuggestions: (filterPath?: string) => ipcRenderer.invoke('storage:get-suggestions', filterPath),
    delete: (paths: string[]) => ipcRenderer.invoke('storage:delete', paths),
    optimize: () => ipcRenderer.invoke('storage:optimize'),
    onProgress: (callback: (node: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('storage:progress', handler)
      return () => ipcRenderer.removeListener('storage:progress', handler)
    },
    onDone: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('storage:done', handler)
      return () => ipcRenderer.removeListener('storage:done', handler)
    },
    onError: (callback: (err: string) => void) => {
      const handler = (_: any, err: string) => callback(err)
      ipcRenderer.on('storage:error', handler)
      return () => ipcRenderer.removeListener('storage:error', handler)
    }
  },
  recovery: {
    startScan: (drivePath: string, mode: string) => ipcRenderer.send('recovery:start-scan', { drivePath, mode }),
    pauseScan: () => ipcRenderer.send('recovery:pause-scan'),
    resumeScan: () => ipcRenderer.send('recovery:resume-scan'),
    stopScan: () => ipcRenderer.send('recovery:stop-scan'),
    recoverFile: (file: any, destinationPath: string) => ipcRenderer.invoke('recovery:recover-file', { file, destinationPath }),
    selectDestination: () => ipcRenderer.invoke('recovery:select-destination'),
    onProgress: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('recovery:progress', handler)
      return () => ipcRenderer.removeListener('recovery:progress', handler)
    },
    onFileFound: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('recovery:file-found', handler)
      return () => ipcRenderer.removeListener('recovery:file-found', handler)
    },
    onStatus: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('recovery:status', handler)
      return () => ipcRenderer.removeListener('recovery:status', handler)
    },
    onError: (callback: (err: string) => void) => {
      const handler = (_: any, err: string) => callback(err)
      ipcRenderer.on('recovery:error', handler)
      return () => ipcRenderer.removeListener('recovery:error', handler)
    },
    onDone: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('recovery:done', handler)
      return () => ipcRenderer.removeListener('recovery:done', handler)
    }
  },
  nas: {
    discover: () => ipcRenderer.invoke('nas:discover'),
    testConnection: (config: any) => ipcRenderer.invoke('nas:test-connection', config),
    ping: (host: string) => ipcRenderer.invoke('nas:ping', host),
    getStorageInfo: (host: string, shareName?: string) => ipcRenderer.invoke('nas:storage-info', host, shareName),
    fetchData: (config: any) => ipcRenderer.invoke('nas:fetch-data', config)
  }
}

const updater = {
  check: () => ipcRenderer.send('updater:check'),
  download: () => ipcRenderer.send('updater:download'),
  install: () => ipcRenderer.send('updater:install'),
  onStatus: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.removeListener('update-status', handler)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electron)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('updater', updater)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electron
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.updater = updater
}
