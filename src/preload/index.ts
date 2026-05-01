import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  getDiskData: () => ipcRenderer.invoke('get-disk-data'),
  getSystemStats: () => ipcRenderer.invoke('get-system-stats'),
  isAdmin: () => ipcRenderer.invoke('is-admin'),

  // Scan operations
  scanDisk: (drivePath: string) => ipcRenderer.send('scan-disk', drivePath),
  fixDisk: (drivePath: string) => ipcRenderer.send('fix-disk', drivePath),
  stopDiskScan: (drivePath: string) => ipcRenderer.send('stop-scan', drivePath),
  ejectDrive: (driveLetter: string) => ipcRenderer.invoke('eject-drive', driveLetter),

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
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
