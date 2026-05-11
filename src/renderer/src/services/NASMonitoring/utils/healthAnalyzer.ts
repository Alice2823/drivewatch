// ============================================
// NAS MONITORING - Health Analyzer
// Produces human-readable health insights
// ============================================

import type {
  NASHealthInsight,
  NASHealthAnalysis,
  NASStorageAnalytics,
  NASSMARTData,
  NASTransferStats,
  NASDevice,
  HealthLevel
} from '../types'

function generateInsightId(): string {
  return `insight-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Analyze NAS device health and generate human-readable insights.
 * This is a read-only analysis engine — NO destructive actions.
 */
export function analyzeNASHealth(
  device: NASDevice,
  storage?: NASStorageAnalytics,
  smart?: NASSMARTData,
  transfer?: NASTransferStats
): NASHealthAnalysis {
  const insights: NASHealthInsight[] = []
  let totalScore = 100
  const now = Date.now()

  // ---- Device Status ----
  if (device.status === 'offline') {
    totalScore -= 30
    insights.push({
      id: generateInsightId(),
      severity: 'critical',
      title: 'Device Offline',
      message: 'NAS device is not responding to network probes. Check power supply and network cable connections.',
      category: 'network',
      actionRequired: true,
      timestamp: now
    })
  }

  if (device.latencyMs !== null && device.latencyMs > 100) {
    totalScore -= 10
    insights.push({
      id: generateInsightId(),
      severity: 'warning',
      title: 'High Network Latency',
      message: `Response latency is ${device.latencyMs}ms. This may indicate network congestion or a failing network interface.`,
      category: 'network',
      actionRequired: false,
      timestamp: now
    })
  }

  // ---- Storage Analysis ----
  if (storage) {
    if (storage.usagePercent > 90) {
      totalScore -= 20
      insights.push({
        id: generateInsightId(),
        severity: 'critical',
        title: 'Storage Nearly Full',
        message: `Storage usage at ${storage.usagePercent}%. Critical threshold exceeded. Free up space immediately to prevent data loss.`,
        category: 'storage',
        actionRequired: true,
        timestamp: now
      })
    } else if (storage.usagePercent > 75) {
      totalScore -= 10
      insights.push({
        id: generateInsightId(),
        severity: 'warning',
        title: 'Storage Usage High',
        message: `Storage usage at ${storage.usagePercent}%. Consider archiving old data or expanding storage capacity.`,
        category: 'storage',
        actionRequired: false,
        timestamp: now
      })
    }

    if (storage.raidStatus === 'degraded') {
      totalScore -= 25
      insights.push({
        id: generateInsightId(),
        severity: 'critical',
        title: 'RAID Degradation Risk',
        message: 'RAID array is running in degraded mode. A disk may have failed. Replace the failed drive as soon as possible to prevent data loss.',
        category: 'raid',
        actionRequired: true,
        timestamp: now
      })
    } else if (storage.raidStatus === 'rebuilding') {
      totalScore -= 10
      insights.push({
        id: generateInsightId(),
        severity: 'warning',
        title: 'RAID Rebuilding',
        message: 'RAID array is currently rebuilding. Avoid heavy I/O operations until rebuild completes.',
        category: 'raid',
        actionRequired: false,
        timestamp: now
      })
    }
  }

  // ---- SMART Analysis ----
  if (smart?.available && smart.disks.length > 0) {
    for (const disk of smart.disks) {
      // Temperature checks
      if (disk.temperature !== null && disk.temperature > 55) {
        totalScore -= 15
        insights.push({
          id: generateInsightId(),
          severity: 'critical',
          title: 'High NAS Temperature Detected',
          message: `Drive "${disk.diskName}" temperature is ${disk.temperature}°C. This exceeds safe operating limits and may cause premature failure.`,
          category: 'temperature',
          actionRequired: true,
          timestamp: now
        })
      } else if (disk.temperature !== null && disk.temperature > 45) {
        totalScore -= 5
        insights.push({
          id: generateInsightId(),
          severity: 'warning',
          title: 'Elevated Drive Temperature',
          message: `Drive "${disk.diskName}" is running warm at ${disk.temperature}°C. Ensure adequate ventilation.`,
          category: 'temperature',
          actionRequired: false,
          timestamp: now
        })
      }

      // Power-on hours
      if (disk.powerOnHours !== null && disk.powerOnHours > 40000) {
        totalScore -= 10
        insights.push({
          id: generateInsightId(),
          severity: 'warning',
          title: 'Drive Aging',
          message: `Drive "${disk.diskName}" has ${Math.round(disk.powerOnHours / 24 / 365 * 10) / 10} years of power-on time. Backup recommended soon.`,
          category: 'disk',
          actionRequired: false,
          timestamp: now
        })
      }

      // Reallocated sectors
      if (disk.reallocatedSectors > 50) {
        totalScore -= 20
        insights.push({
          id: generateInsightId(),
          severity: 'critical',
          title: 'Bad Sectors Detected',
          message: `Drive "${disk.diskName}" has ${disk.reallocatedSectors} reallocated sectors. This indicates physical media degradation. Replacement recommended.`,
          category: 'disk',
          actionRequired: true,
          timestamp: now
        })
      } else if (disk.reallocatedSectors > 10) {
        totalScore -= 10
        insights.push({
          id: generateInsightId(),
          severity: 'warning',
          title: 'Sector Reallocation Activity',
          message: `Drive "${disk.diskName}" has ${disk.reallocatedSectors} reallocated sectors. Monitor closely for increases.`,
          category: 'disk',
          actionRequired: false,
          timestamp: now
        })
      }

      // SSD Wear Level
      if (disk.isSSD && disk.ssdWearLevel !== null && disk.ssdWearLevel < 20) {
        totalScore -= 20
        insights.push({
          id: generateInsightId(),
          severity: 'critical',
          title: 'SSD Wear Level Critical',
          message: `Drive "${disk.diskName}" SSD wear level is at ${disk.ssdWearLevel}%. Drive replacement should be planned.`,
          category: 'disk',
          actionRequired: true,
          timestamp: now
        })
      } else if (disk.isSSD && disk.ssdWearLevel !== null && disk.ssdWearLevel < 50) {
        totalScore -= 5
        insights.push({
          id: generateInsightId(),
          severity: 'warning',
          title: 'SSD Wear Increasing',
          message: `Drive "${disk.diskName}" SSD wear level at ${disk.ssdWearLevel}%. Consider backup scheduling.`,
          category: 'disk',
          actionRequired: false,
          timestamp: now
        })
      }

      // Health below threshold
      if (disk.healthPercent < 50) {
        totalScore -= 15
        insights.push({
          id: generateInsightId(),
          severity: 'critical',
          title: 'Drive Health Critical',
          message: `Drive "${disk.diskName}" health at ${disk.healthPercent}%. Immediate backup and replacement recommended.`,
          category: 'disk',
          actionRequired: true,
          timestamp: now
        })
      }
    }
  }

  // ---- Network Transfer Quality ----
  if (transfer) {
    if (transfer.connectionQuality === 'poor') {
      totalScore -= 10
      insights.push({
        id: generateInsightId(),
        severity: 'warning',
        title: 'Poor Connection Quality',
        message: 'Network connection to NAS is experiencing high latency or packet loss. Check network cables and switch ports.',
        category: 'network',
        actionRequired: false,
        timestamp: now
      })
    }
  }

  // ---- General Health Recommendations ----
  if (insights.length === 0) {
    insights.push({
      id: generateInsightId(),
      severity: 'healthy',
      title: 'System Healthy',
      message: 'All NAS subsystems are operating within normal parameters. No issues detected.',
      category: 'general',
      actionRequired: false,
      timestamp: now
    })
  }

  // Clamp score
  totalScore = Math.max(0, Math.min(100, totalScore))

  // Determine overall health level
  let overallHealth: HealthLevel = 'healthy'
  if (totalScore < 40) overallHealth = 'critical'
  else if (totalScore < 70) overallHealth = 'warning'

  return {
    deviceId: device.id,
    overallHealth,
    score: totalScore,
    insights,
    lastAnalyzed: now
  }
}
