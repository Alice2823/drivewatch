// ============================================
// NAS MONITORING - Format Utilities
// Pure helper functions for display formatting
// ============================================

/**
 * Format latency with appropriate unit
 */
export function formatLatency(ms: number | null): string {
  if (ms === null || ms < 0) return '—'
  if (ms < 1) return '<1ms'
  return `${Math.round(ms)}ms`
}

/**
 * Format bytes into human-readable storage string
 */
export function formatNASBytes(bytes: number, decimals = 2): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

/**
 * Format network speed (bytes/sec to human readable)
 */
export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k))
  return `${parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

/**
 * Format power-on hours to human-readable duration
 */
export function formatPowerOnHours(hours: number | null): string {
  if (hours === null || hours <= 0) return '—'
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 365) return `${days}d ${hours % 24}h`
  const years = (days / 365).toFixed(1)
  return `${years}yr`
}

/**
 * Format temperature with degree symbol
 */
export function formatNASTemp(temp: number | null): string {
  if (temp === null || temp <= 0) return '—'
  return `${Math.round(temp)}°C`
}

/**
 * Get color class based on health level
 */
export function getHealthColor(level: string): string {
  switch (level) {
    case 'healthy': return 'text-success'
    case 'warning': return 'text-warning'
    case 'critical': return 'text-danger'
    default: return 'text-muted'
  }
}

/**
 * Get background color class based on health level
 */
export function getHealthBgColor(level: string): string {
  switch (level) {
    case 'healthy': return 'bg-success'
    case 'warning': return 'bg-warning'
    case 'critical': return 'bg-[#ef4444]'
    default: return 'bg-muted'
  }
}

/**
 * Get vendor display label
 */
export function getVendorLabel(vendor: string): string {
  switch (vendor) {
    case 'TrueNAS': return 'TrueNAS'
    case 'Synology': return 'Synology DSM'
    case 'QNAP': return 'QNAP QTS'
    case 'SMB': return 'SMB Share'
    case 'Generic': return 'NAS Device'
    default: return 'Unknown'
  }
}

/**
 * Get connection quality label
 */
export function getConnectionQualityLabel(quality: string): string {
  switch (quality) {
    case 'excellent': return 'Excellent'
    case 'good': return 'Good'
    case 'fair': return 'Fair'
    case 'poor': return 'Poor'
    default: return 'Unknown'
  }
}

/**
 * Get connection quality color
 */
export function getConnectionQualityColor(quality: string): string {
  switch (quality) {
    case 'excellent': return 'text-success'
    case 'good': return 'text-primary'
    case 'fair': return 'text-warning'
    case 'poor': return 'text-[#ef4444]'
    default: return 'text-muted'
  }
}

/**
 * Determine connection quality from latency
 */
export function getQualityFromLatency(latencyMs: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (latencyMs < 5) return 'excellent'
  if (latencyMs < 20) return 'good'
  if (latencyMs < 100) return 'fair'
  return 'poor'
}
