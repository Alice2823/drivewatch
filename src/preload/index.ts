import { contextBridge, ipcRenderer, shell } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const electron = {
  ...electronAPI,
  shell: {
    openExternal: (url: string) => shell.openExternal(url),
    openPath: (path: string) => shell.openPath(path),
    showItemInFolder: (path: string) => shell.showItemInFolder(path)
  }
}

// Custom APIs for renderer
const api = {
  getDiskData: () => ipcRenderer.invoke('get-disk-data'),
  getSystemStats: () => ipcRenderer.invoke('get-system-stats'),
  getGpuStats: () => ipcRenderer.invoke('get-gpu-stats'),
  getFanRpm: () => ipcRenderer.invoke('get-fan-rpm'),
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
    fetchData: (config: any) => ipcRenderer.invoke('nas:fetch-data', config),
    getIoStats: (config: any) => ipcRenderer.invoke('nas:io-stats', config)
  },
  diagnostics: {
    scan: (forceRefresh?: boolean) => ipcRenderer.invoke('diagnostics:scan', forceRefresh),
    exportReport: () => ipcRenderer.invoke('diagnostics:export'),
    exportJson: () => ipcRenderer.invoke('diagnostics:export-json')
  },
  surfaceScan: {
    start: (diskIndex: number, mode: string, model?: string, serial?: string, devicePath?: string, executionMode?: string) => ipcRenderer.send('surface:start', diskIndex, mode, model, serial, devicePath, executionMode),
    pause: (diskIndex: number) => ipcRenderer.send('surface:pause', diskIndex),
    resume: (diskIndex: number) => ipcRenderer.send('surface:resume', diskIndex),
    stop: (diskIndex: number) => ipcRenderer.send('surface:stop', diskIndex),
    isActive: (diskIndex: number) => ipcRenderer.invoke('surface:is-active', diskIndex),
    getLastResult: (diskIndex: number, model?: string, serial?: string, devicePath?: string) => ipcRenderer.invoke('surface:get-last-result', diskIndex, model, serial, devicePath),
    onProgress: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('surface:progress', handler)
      return () => ipcRenderer.removeListener('surface:progress', handler)
    },
    onDone: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('surface:done', handler)
      return () => ipcRenderer.removeListener('surface:done', handler)
    },
    onError: (callback: (msg: string) => void) => {
      const handler = (_: any, msg: string) => callback(msg)
      ipcRenderer.on('surface:error', handler)
      return () => ipcRenderer.removeListener('surface:error', handler)
    }
  },
  stabilizer: {
    start: (diskIndex: number, mode: string) => ipcRenderer.send('stabilizer:start', diskIndex, mode),
    pause: (diskIndex: number) => ipcRenderer.send('stabilizer:pause', diskIndex),
    resume: (diskIndex: number) => ipcRenderer.send('stabilizer:resume', diskIndex),
    stop: (diskIndex: number) => ipcRenderer.send('stabilizer:stop', diskIndex),
    isActive: (diskIndex: number) => ipcRenderer.invoke('stabilizer:is-active', diskIndex),
    onProgress: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('stabilizer:progress', handler)
      return () => ipcRenderer.removeListener('stabilizer:progress', handler)
    },
    onDone: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('stabilizer:done', handler)
      return () => ipcRenderer.removeListener('stabilizer:done', handler)
    },
    onError: (callback: (msg: string) => void) => {
      const handler = (_: any, msg: string) => callback(msg)
      ipcRenderer.on('stabilizer:error', handler)
      return () => ipcRenderer.removeListener('stabilizer:error', handler)
    }
  },
  // ── Background Task Registry ──────────────────────────────────────────────
  tasks: {
    getAll: () => ipcRenderer.invoke('tasks:get-all'),
    getActive: () => ipcRenderer.invoke('tasks:get-active'),
    requestSnapshot: () => ipcRenderer.send('tasks:request-snapshot'),
    remove: (taskId: string) => ipcRenderer.send('tasks:remove', taskId),
    onList: (callback: (tasks: any[]) => void) => {
      const handler = (_: any, tasks: any[]) => callback(tasks)
      ipcRenderer.on('tasks:list', handler)
      return () => ipcRenderer.removeListener('tasks:list', handler)
    },
    onCreated: (callback: (task: any) => void) => {
      const handler = (_: any, task: any) => callback(task)
      ipcRenderer.on('tasks:created', handler)
      return () => ipcRenderer.removeListener('tasks:created', handler)
    },
    onProgress: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('tasks:progress', handler)
      return () => ipcRenderer.removeListener('tasks:progress', handler)
    },
    onStatus: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('tasks:status', handler)
      return () => ipcRenderer.removeListener('tasks:status', handler)
    },
    onTick: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('tasks:tick', handler)
      return () => ipcRenderer.removeListener('tasks:tick', handler)
    },
    onRemoved: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('tasks:removed', handler)
      return () => ipcRenderer.removeListener('tasks:removed', handler)
    }
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
