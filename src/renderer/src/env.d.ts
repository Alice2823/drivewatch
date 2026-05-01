/// <reference types="vite/client" />

interface Window {
  api: {
    getDiskData: () => Promise<any[]>
    isAdmin: () => Promise<boolean>
    scanDisk: (drivePath: string) => void
    stopDiskScan: (drivePath: string) => void
    onScanProgress: (callback: (data: any) => void) => () => void
    onScanOutput: (callback: (data: any) => void) => () => void
    onScanFinished: (callback: (data: any) => void) => () => void
  }
}
