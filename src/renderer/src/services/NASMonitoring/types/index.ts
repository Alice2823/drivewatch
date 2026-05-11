// ============================================
// NAS MONITORING - Type Definitions
// Isolated module: does NOT modify existing types
// ============================================

/** Supported NAS vendor types */
export type NASVendor = 'TrueNAS' | 'Synology' | 'QNAP' | 'SMB' | 'Generic' | 'Unknown'

/** NAS connection protocol */
export type NASProtocol = 'smb' | 'ssh'

/** Device online/offline status */
export type NASDeviceStatus = 'online' | 'offline' | 'connecting' | 'error' | 'unknown'

/** Connection state */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'failed' | 'testing'

/** Health badge levels */
export type HealthLevel = 'healthy' | 'warning' | 'critical' | 'unknown'

/** RAID types */
export type RAIDType = 'RAID0' | 'RAID1' | 'RAID5' | 'RAID6' | 'RAID10' | 'RAIDZ1' | 'RAIDZ2' | 'RAIDZ3' | 'JBOD' | 'Mirror' | 'Stripe' | 'Unknown'

// ============================================
// Device Discovery
// ============================================

export interface NASDevice {
  id: string
  name: string
  ip: string
  port: number
  vendor: NASVendor
  status: NASDeviceStatus
  latencyMs: number | null
  mac?: string
  hostname?: string
  lastSeen: number // timestamp
  discoveredAt: number // timestamp
  shares?: string[]
}

export interface NASDiscoveryScanResult {
  devices: NASDevice[]
  scannedAt: number
  scanDurationMs: number
  networkRange: string
  error?: string
}

// ============================================
// Connection System
// ============================================

export interface NASConnectionConfig {
  deviceId: string
  protocol: NASProtocol
  host: string
  port: number
  username: string
  password: string // Will be handled securely
  shareName?: string
  rememberCredentials: boolean
}

export interface NASConnectionStatus {
  deviceId: string
  state: ConnectionState
  connectedAt?: number
  lastError?: string
  protocol?: NASProtocol
}

export interface NASConnectionTestResult {
  success: boolean
  latencyMs: number
  serverInfo?: string
  shares?: string[]
  error?: string
}

// ============================================
// Storage Analytics
// ============================================

export interface NASStorageAnalytics {
  deviceId: string
  totalCapacity: number // bytes
  usedSpace: number // bytes
  freeSpace: number // bytes
  usagePercent: number
  diskCount: number
  raidType: RAIDType
  raidStatus: 'optimal' | 'degraded' | 'rebuilding' | 'failed' | 'unknown'
  volumes: NASVolume[]
  lastUpdated: number
}

export interface NASVolume {
  name: string
  mountPoint: string
  totalSize: number
  usedSize: number
  freeSize: number
  filesystem: string
  status: 'healthy' | 'degraded' | 'error'
}

// ============================================
// SMART Monitoring
// ============================================

export interface NASSMARTData {
  deviceId: string
  disks: NASDiskSMART[]
  lastUpdated: number
  available: boolean
}

export interface NASDiskSMART {
  diskId: string
  diskName: string
  model: string
  serial: string
  temperature: number | null
  powerOnHours: number | null
  healthPercent: number
  reallocatedSectors: number
  ssdWearLevel: number | null
  healthLevel: HealthLevel
  isSSD: boolean
  capacity: number
  errors: string[]
  readSpeed?: number
  writeSpeed?: number
  throughputHistory?: NASTransferPoint[]
}

// ============================================
// Transfer Monitor
// ============================================

export interface NASTransferStats {
  deviceId: string
  uploadSpeed: number // bytes/sec
  downloadSpeed: number // bytes/sec
  connectionQuality: 'excellent' | 'good' | 'fair' | 'poor'
  latencyMs: number
  history: NASTransferPoint[]
  lastUpdated: number
}

export interface NASTransferPoint {
  timestamp: number
  upload: number
  download: number
}

// ============================================
// Health Analysis
// ============================================

export interface NASHealthAnalysis {
  deviceId: string
  overallHealth: HealthLevel
  score: number // 0-100
  insights: NASHealthInsight[]
  lastAnalyzed: number
}

export interface NASHealthInsight {
  id: string
  severity: HealthLevel
  title: string
  message: string
  category: 'temperature' | 'raid' | 'disk' | 'network' | 'storage' | 'general'
  actionRequired: boolean
  timestamp: number
}

// ============================================
// Aggregate State
// ============================================

export interface NASMonitoringState {
  devices: NASDevice[]
  connections: Record<string, NASConnectionStatus>
  storage: Record<string, NASStorageAnalytics>
  smart: Record<string, NASSMARTData>
  transfers: Record<string, NASTransferStats>
  health: Record<string, NASHealthAnalysis>
  isScanning: boolean
  lastScanAt: number | null
  error: string | null
}

export const initialNASMonitoringState: NASMonitoringState = {
  devices: [],
  connections: {},
  storage: {},
  smart: {},
  transfers: {},
  health: {},
  isScanning: false,
  lastScanAt: null,
  error: null
}
