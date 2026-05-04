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
        gpuUsage: number;
        gpuName: string;
        gpuVramTotal: number;
        gpuVramUsed: number;
      }>
      getGpuStats: () => Promise<{
        usage: number;
        vramUsed: number;
        vramTotal: number;
        name: string;
      }>
      isAdmin: () => Promise<boolean>
      scanDisk: (drivePath: string) => void
      fixDisk: (drivePath: string) => void
      stopDiskScan: (drivePath: string) => void
      ejectDrive: (driveLetter: string) => Promise<{ success: boolean; error?: string }>
      onScanProgress: (callback: (data: any) => void) => () => void
      onScanOutput: (callback: (data: any) => void) => () => void
      onScanFinished: (callback: (data: any) => void) => () => void
      getAppVersion: () => Promise<string>
      health: {
        getDrives: () => Promise<{
          diskIndex: number
          name: string
          type: string
          mounts: string[]
          serial: string
          size: number
          temperature: number | null
          isRemovable?: boolean
        }[]>
        runSmart: (diskIndex: number) => Promise<{
          available: boolean
          fallback: boolean
          overallHealth: 'PASSED' | 'FAILED' | 'Unknown'
          temperature: number | null
          powerOnHours: number | null
          attributes: {
            id: number
            name: string
            value: number
            worst: number
            thresh: number
            raw: number
            failed: boolean
            critical: boolean
          }[]
          issues: string[]
          error?: string
        }>
        quickCheck: () => Promise<{
          diskIndex: number
          instanceName: string
          predictFailure: boolean
          reason: string
        }[]>
        runChkdsk: (driveLetter: string) => Promise<{
          driveLetter: string
          clean: boolean
          badSectors: number
          errors: number
          rawLines: string[]
          cancelled: boolean
          exitCode: number | null
          error?: string
        }>
        getScore: (payload: {
          smart: any
          chkdsk: any
          temperature: number | null
        }) => Promise<{
          score: number
          status: 'PASSED' | 'WARNING' | 'FAILED' | 'UNKNOWN'
          issues: string[]
          summary: string
          deductions: { reason: string; points: number }[]
        }>
        onChkdskOutput: (callback: (data: any) => void) => () => void
        onChkdskProgress: (callback: (data: any) => void) => () => void
        onChkdskFinished: (callback: (data: any) => void) => () => void
      }
      storage: {
        list: (dirPath: string) => Promise<any[]>
        scan: (dirPath: string) => void
        stop: () => void
        getSuggestions: (filterPath?: string) => Promise<{ largeUnused: any[]; junkFiles: any[] }>
        delete: (paths: string[]) => Promise<{ success: boolean; deletedCount: number; errors: string[] }>
        optimize: () => Promise<{ success: boolean; deletedCount: number; freedSpace: number }>
        onProgress: (callback: (node: any) => void) => () => void
        onDone: (callback: () => void) => () => void
        onError: (callback: (err: string) => void) => () => void
      }
    }
    updater: {
      check: () => void
      download: () => void
      install: () => void
      onStatus: (callback: (data: any) => void) => () => void
    }
  }
}
