import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getDiskData: () => Promise<any[]>
      getSystemStats: () => Promise<{ 
        cpuUsage: number; 
        cpuTemp: number | null; 
        cpuName: string;
        cpuCores: number;
        cpuThreads: number;
        ramUsage: number;
        ramTotalBytes: number;
        ramUsedBytes: number;
      }>
      isAdmin: () => Promise<boolean>
      scanDisk: (drivePath: string) => void
      fixDisk: (drivePath: string) => void
      stopDiskScan: (drivePath: string) => void
      ejectDrive: (driveLetter: string) => Promise<{ success: boolean; error?: string }>
      onScanProgress: (callback: (data: any) => void) => () => void
      onScanOutput: (callback: (data: any) => void) => () => void
      onScanFinished: (callback: (data: any) => void) => () => void
    }
  }
}
