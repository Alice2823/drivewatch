import { ElectronAPI } from '@electron-toolkit/preload'

// ── Shared task type (mirrors main/services/scanTaskManager.ts) ───────────────
interface ScanTask {
  taskId: string
  driveId: string
  diskIndex: number | null
  driveName: string
  scanType: 'surface' | 'stabilizer' | 'diagnostics' | 'smart' | 'health'
  scanMode: string
  status: 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'
  progress: number
  speedMBs: number
  etaSec: number
  elapsedSec: number
  startedAt: number
  finishedAt: number | null
  logLines: string[]
  telemetry: Record<string, unknown>
  error: string | null
}

declare global {
  interface Window {
    electron: ElectronAPI & {
      shell: {
        openExternal: (url: string) => Promise<void>
        openPath: (path: string) => Promise<string>
        showItemInFolder: (path: string) => void
      }
    }
    api: {
      getDiskData: () => Promise<any[]>
      getSystemStats: () => Promise<{ 
        cpuUsage: number; 
        cpuTemp: number | null; 
        cpuName: string;
        cpuCores?: number;
        cpuThreads?: number;
        ramUsage: number;
        ramTotalBytes: number;
        ramUsedBytes: number;
        gpuTemp?: number | null;
        diskTemp: number | null;
        hasCpuTemp: boolean;
        hasGpuTemp: boolean;
        hasDiskTemp: boolean;
        thermalSource: 'LHM' | 'SI' | 'None';
      }>
      getGpuStats: () => Promise<{
        usage: number;
        vramUsed: number;
        vramTotal: number;
        name: string;
        temperature: number | null;
      }[]>
      getFanRpm: () => Promise<number | null>
      isAdmin: () => Promise<boolean>
      scanDisk: (drivePath: string) => void
      fixDisk: (drivePath: string) => void
      stopDiskScan: (drivePath: string) => void
      ejectDrive: (driveLetter: string, diskIndex: number) => Promise<{ success: boolean; error?: string }>
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
          overallHealth: 'PASSED' | 'FAILED' | 'Unknown' | 'Unsupported'
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
          unsupported?: boolean
          stale?: boolean
          cachedAt?: number
        }>
        quickCheck: () => Promise<{
          diskIndex: number
          instanceName: string
          predictFailure: boolean
          reason: string
        }[]>
        checkFs: (driveLetter: string) => Promise<{
          driveLetter: string
          isDirty: boolean
          needsRepair: boolean
          offlineRepairRequired: boolean
          message: string
          severity: 'low' | 'medium' | 'high' | 'critical'
        }>
        runChkdsk: (driveLetter: string, mode?: string) => Promise<{
          driveLetter: string
          clean: boolean
          badSectors: number
          errors: number
          needsReboot?: boolean
          rawLines: string[]
          cancelled: boolean
          exitCode: number | null
          error?: string
        }>
        scheduleReboot: (driveLetter: string) => Promise<{ success: boolean; message: string }>
        getScore: (payload: {
          smart: any
          chkdsk: any
          temperature: number | null
        }) => Promise<{
          score: number | null
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
      recovery: {
        startScan: (drivePath: string, mode: string) => void
        pauseScan: () => void
        resumeScan: () => void
        stopScan: () => void
        recoverFile: (file: any, destinationPath: string) => Promise<{ success: boolean; recoveredPath?: string; quality?: string; error?: string }>
        selectDestination: () => Promise<string | null>
        onProgress: (callback: (data: any) => void) => () => void
        onFileFound: (callback: (data: any) => void) => () => void
        onStatus: (callback: (data: any) => void) => () => void
        onError: (callback: (err: string) => void) => () => void
        onDone: (callback: () => void) => () => void
      }
      nas: {
        discover: () => Promise<{ devices: any[]; scanDurationMs: number; networkRange: string; error?: string }>
        testConnection: (config: any) => Promise<{ success: boolean; latencyMs: number; serverInfo?: string; shares?: string[]; error?: string }>
        ping: (host: string) => Promise<{ online: boolean; latencyMs: number }>
        getStorageInfo: (host: string, shareName?: string) => Promise<{ totalCapacity: number; usedSpace: number; freeSpace: number; usagePercent: number; error?: string }>
        fetchData: (config: any) => Promise<{ success: boolean; pools?: any[]; datasets?: any[]; shares?: any[]; disks?: any[]; smbVolumes?: any[]; error?: string }>
      }
      surfaceScan: {
        start: (diskIndex: number, mode: 'quick' | 'full' | 'smart', model?: string, serial?: string, devicePath?: string, executionMode?: 'REAL_SCAN' | 'SIMULATION_MODE') => void
        pause: (diskIndex: number) => void
        resume: (diskIndex: number) => void
        stop: (diskIndex: number) => void
        isActive: (diskIndex: number) => Promise<boolean>
        getLastResult: (diskIndex: number, model?: string, serial?: string, devicePath?: string) => Promise<any>
        onProgress: (callback: (data: {
          percent: number
          currentLba: number
          totalLbas: number
          readSpeedMBs: number
          etaSec: number
          errorCount: number
          slowCount: number
          blocks: number[]
          totalBlocks: number
          temperature: number | null
          healthPct: number | null
          executionMode: 'REAL_SCAN' | 'SIMULATION_MODE'
          realIo: boolean
          actualBytesRead: number
          lastReadBytes: number
          lastReadLatencyMs: number
          ioTelemetry: any | null
        }) => void) => () => void
        onDone: (callback: (data: {
          success: boolean
          cancelled: boolean
          errorCount: number
          slowCount: number
          totalChunks: number
          durationSec: number
          error?: string
          executionMode: 'REAL_SCAN' | 'SIMULATION_MODE'
          realIo: boolean
          actualBytesRead: number
        }) => void) => () => void
        onError: (callback: (msg: string) => void) => () => void
      }
      diagnostics: {
        scan: (forceRefresh?: boolean) => Promise<{
          timestamp: string
          platform: string
          scanDurationMs: number
          overallScore: number
          overallStatus: 'healthy' | 'warning' | 'critical'
          firmware: Array<{
            diskIndex: number; model: string; serial: string; firmwareVersion: string
            firmwareDate: string | null; interfaceType: string; isGenericFirmware: boolean
            updateAvailable: boolean; updateRecommendation: string | null
            manufacturerUrl: string | null; severity: string; issues: string[]
          }>
          drivers: Array<{
            deviceName: string; driverProvider: string; driverVersion: string
            driverDate: string; isGenericDriver: boolean; hasWarning: boolean; hasError: boolean
            deviceStatus: string; problemCode: number | null; issues: string[]
            severity: string; recommendation: string | null; updateUrl: string | null
          }>
          controllers: Array<{
            diskIndex: number; model: string; controllerName: string; interfaceType: string
            pcieGeneration: string | null; pcieLinkWidth: string | null
            pcieMaxSpeed: string | null; pcieCurrentSpeed: string | null
            isBandwidthLimited: boolean; queueDepth: number | null
            issues: string[]; severity: string; recommendation: string | null
          }>
          trimStatus: Array<{
            diskIndex: number; model: string; isSSD: boolean
            trimSupported: boolean; trimEnabled: boolean; fileSystem: string
            issues: string[]; severity: string; recommendation: string | null
          }>
          eventLogs: Array<{
            timeCreated: string; source: string; eventId: number
            level: string; message: string; severity: string
          }>
          recommendations: Array<{
            id: string; category: string; title: string; description: string
            severity: string; actionUrl: string | null; affectedDisk: string | null
          }>
          issueCount: { info: number; low: number; medium: number; high: number; critical: number }
          error?: string
        }>
        exportReport: () => Promise<{ success: boolean; filePath?: string; error?: string }>
        exportJson: () => Promise<{ success: boolean; filePath?: string; error?: string }>
      }
      stabilizer: {
        start: (diskIndex: number, mode: 'verify' | 'stabilize' | 'chkdsk' | 'smart') => void
        pause: (diskIndex: number) => void
        resume: (diskIndex: number) => void
        stop: (diskIndex: number) => void
        isActive: (diskIndex: number) => Promise<boolean>
        onProgress: (callback: (data: {
          phase: string
          percent: number
          currentLba: number
          totalLbas: number
          stableSectors: number
          weakSectors: number
          unstableSectors: number
          unreadableSectors: number
          remappedSectors: number
          readRetries: number
          speedMBs: number
          elapsedSec: number
          etaSec: number
          temperature: number | null
          smartHealth: string | null
          logLines: string[]
          sectorMap: number[]
        }) => void) => () => void
        onDone: (callback: (data: {
          success: boolean
          cancelled: boolean
          stableSectors: number
          weakSectors: number
          unstableSectors: number
          unreadableSectors: number
          remappedSectors: number
          totalScanned: number
          durationSec: number
          healthGrade: 'HEALTHY' | 'DEGRADING' | 'CRITICAL' | 'FAILING'
          summary: string[]
        }) => void) => () => void
        onError: (callback: (msg: string) => void) => () => void
      }
      tasks: {
        getAll: () => Promise<ScanTask[]>
        getActive: () => Promise<ScanTask[]>
        requestSnapshot: () => void
        remove: (taskId: string) => void
        onList: (callback: (tasks: ScanTask[]) => void) => () => void
        onCreated: (callback: (task: ScanTask) => void) => () => void
        onProgress: (callback: (data: Partial<ScanTask> & { taskId: string }) => void) => () => void
        onStatus: (callback: (data: { taskId: string; status: ScanTask['status']; error: string | null }) => void) => () => void
        onTick: (callback: (data: { taskId: string; elapsedSec: number }) => void) => () => void
        onRemoved: (callback: (data: { taskId: string }) => void) => () => void
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
