export type RecoveryMode = 'quick' | 'deep';

export interface RecoverableFile {
  id: string;
  name: string;
  extension: string;
  path: string;
  size: number;
  deletionDate?: string;
  status: 'recoverable' | 'partially_overwritten' | 'corrupted' | 'excellent';
  probability: number; // 0 to 100
  sectorStart: number;
  sectorCount: number;
  mimeType?: string;
  source: 'recycle_bin' | 'mft_deleted' | 'signature_carve';
  driveLetter?: string;
  recycleBinPath?: string; // Path to $R file for recycle bin recovery
  dataRuns?: { clusterOffset: number; clusterCount: number }[];
  residentData?: number[];
  bytesPerCluster?: number;
  bytesPerSector?: number;
  hasTerminator?: boolean;
  recoveryNote?: string;
}

export interface ScanProgress {
  scannedSectors: number;
  totalSectors: number;
  percentage: number;
  foundFiles: number;
  speed: number;
  eta: number;
  isComplete: boolean;
  isPaused: boolean;
  currentOperation: string;
  stage: string;
}

export interface RecoveryHealthReport {
  driveType: string;
  isSSD: boolean;
  trimActive: boolean;
  overwrittenSectors: number;
  healthWarning?: string;
  successProbability: number;
}

export interface RecoveryResult {
  success: boolean;
  recoveredPath?: string;
  error?: string;
  quality?: string;
}
