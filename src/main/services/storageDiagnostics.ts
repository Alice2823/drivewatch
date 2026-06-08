/**
 * storageDiagnostics.ts — Unified Storage Diagnostics Orchestrator
 *
 * Aggregates all storage health checks into a single comprehensive report.
 * Provides severity scoring, recommendations engine, caching, and export.
 *
 * This is the main entry point that coordinates:
 * - firmwareChecker
 * - driverChecker
 * - controllerChecker
 * - trimChecker
 */

import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'

import { checkFirmware, type FirmwareInfo } from './firmwareChecker'
import { checkDrivers, type DriverInfo, type EventLogEntry } from './driverChecker'
import { checkControllers, type ControllerInfo } from './controllerChecker'
import { checkTrim, type TrimStatus } from './trimChecker'
import { getDiskData } from './diskService'
import { generatePdfReport } from './pdfReportGenerator'

// ── Logging ───────────────────────────────────────────────────────────────────
const logPath = path.join(app.getPath('userData'), 'drivewatch_logs.txt')
function log(msg: string): void {
  const ts = new Date().toISOString()
  try { fs.appendFileSync(logPath, `[${ts}] [StorageDiagnostics] ${msg}\n`) } catch { /* */ }
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface DiagnosticRecommendation {
  id: string
  category: 'firmware' | 'driver' | 'controller' | 'trim' | 'performance' | 'smart'
  title: string
  description: string
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  actionUrl: string | null
  affectedDisk: string | null
}

export interface StorageDiagnosticReport {
  timestamp: string
  platform: string
  scanDurationMs: number
  overallScore: number
  overallStatus: 'healthy' | 'warning' | 'critical'
  firmware: FirmwareInfo[]
  drivers: DriverInfo[]
  controllers: ControllerInfo[]
  trimStatus: TrimStatus[]
  eventLogs: EventLogEntry[]
  recommendations: DiagnosticRecommendation[]
  issueCount: { info: number; low: number; medium: number; high: number; critical: number }
  error?: string
}

// ── Cache ─────────────────────────────────────────────────────────────────────
let cachedReport: StorageDiagnosticReport | null = null
let lastScanTime = 0
const CACHE_DURATION_MS = 60_000 // 1 minute cache

// ── Severity Scoring ──────────────────────────────────────────────────────────
// Per-category maximum deductions — prevents a flood of low-severity issues
// from a single category (e.g. 20 generic driver warnings) from collapsing
// the score to 0.
const SEVERITY_WEIGHTS: Record<string, number> = {
  info:     0,
  low:      3,
  medium:   10,
  high:     20,
  critical: 40,
}

// Maximum points any single category can deduct from the score.
// This prevents 20 generic-driver warnings from wiping out the entire score.
const CATEGORY_CAPS: Record<string, number> = {
  firmware:    25,
  drivers:     20,   // cap: even 20 generic-driver warnings can't exceed 20 pts
  controllers: 15,
  trim:        10,
  events:      30,
}

function calculateOverallScore(report: Omit<StorageDiagnosticReport, 'overallScore' | 'overallStatus'>): { score: number; status: 'healthy' | 'warning' | 'critical' } {
  const categoryDeductions: Record<string, number> = {
    firmware:    0,
    drivers:     0,
    controllers: 0,
    trim:        0,
    events:      0,
  }

  // Diminishing-returns accumulation within each category, then hard-capped
  const addDeduction = (cat: string, sev: string) => {
    const weight = SEVERITY_WEIGHTS[sev] || 0
    if (weight === 0) return
    const cap = CATEGORY_CAPS[cat] ?? 25
    if (categoryDeductions[cat] >= cap) return   // already at cap — ignore
    const remaining = cap - categoryDeductions[cat]
    // First issue takes full weight; subsequent issues take 30% (diminishing returns)
    const effective = categoryDeductions[cat] === 0 ? weight : weight * 0.3
    categoryDeductions[cat] = Math.min(cap, categoryDeductions[cat] + effective)
    void remaining  // used implicitly via Math.min above
  }

  for (const fw of report.firmware)       addDeduction('firmware',    fw.severity)
  for (const drv of report.drivers)       addDeduction('drivers',     drv.severity)
  for (const ctrl of report.controllers)  addDeduction('controllers', ctrl.severity)
  for (const trim of report.trimStatus)   addDeduction('trim',        trim.severity)
  for (const evt of report.eventLogs)     addDeduction('events',      evt.severity)

  const totalDeductions = Object.values(categoryDeductions).reduce((a, b) => a + b, 0)
  const score = Math.max(0, Math.min(100, Math.round(100 - totalDeductions)))

  let status: 'healthy' | 'warning' | 'critical' = 'healthy'
  if (score < 60) status = 'critical'
  else if (score < 85) status = 'warning'

  return { score, status }
}

// ── Recommendations Engine ───────────────────────────────────────────────────
function generateRecommendations(report: Omit<StorageDiagnosticReport, 'overallScore' | 'overallStatus' | 'recommendations'>): DiagnosticRecommendation[] {
  const recommendations: DiagnosticRecommendation[] = []
  let recId = 0

  // Firmware recommendations
  for (const fw of report.firmware) {
    if (fw.updateAvailable) {
      recommendations.push({
        id: `rec_${recId++}`,
        category: 'firmware',
        title: `Firmware update available for ${fw.model}`,
        description: fw.updateRecommendation || 'Visit the manufacturer website to check for firmware updates.',
        severity: fw.severity,
        actionUrl: fw.manufacturerUrl,
        affectedDisk: fw.model
      })
    }
    for (const issue of fw.issues) {
      if (!fw.updateAvailable) {
        recommendations.push({
          id: `rec_${recId++}`,
          category: 'firmware',
          title: `Firmware issue on ${fw.model}`,
          description: issue,
          severity: fw.severity,
          actionUrl: fw.manufacturerUrl,
          affectedDisk: fw.model
        })
      }
    }
  }

  // Driver recommendations
  for (const drv of report.drivers) {
    if (drv.isGenericDriver) {
      recommendations.push({
        id: `rec_${recId++}`,
        category: 'driver',
        title: `Generic driver detected: ${drv.deviceName}`,
        description: drv.recommendation || 'Install the manufacturer-specific storage driver for better performance.',
        severity: drv.severity,
        actionUrl: drv.updateUrl,
        affectedDisk: drv.deviceName
      })
    }
    if (drv.hasError || drv.hasWarning) {
      recommendations.push({
        id: `rec_${recId++}`,
        category: 'driver',
        title: `Driver issue: ${drv.deviceName}`,
        description: drv.issues.join(' '),
        severity: drv.severity,
        actionUrl: drv.updateUrl,
        affectedDisk: drv.deviceName
      })
    }
  }

  // Controller recommendations
  for (const ctrl of report.controllers) {
    if (ctrl.isBandwidthLimited) {
      recommendations.push({
        id: `rec_${recId++}`,
        category: 'controller',
        title: `PCIe bandwidth limitation on ${ctrl.model}`,
        description: ctrl.recommendation || 'Check that the drive is installed in the correct slot.',
        severity: ctrl.severity,
        actionUrl: null,
        affectedDisk: ctrl.model
      })
    }
    for (const issue of ctrl.issues) {
      if (!ctrl.isBandwidthLimited) {
        recommendations.push({
          id: `rec_${recId++}`,
          category: 'controller',
          title: `Controller note: ${ctrl.model}`,
          description: issue,
          severity: ctrl.severity,
          actionUrl: null,
          affectedDisk: ctrl.model
        })
      }
    }
  }

  // TRIM recommendations
  for (const trim of report.trimStatus) {
    if (trim.isSSD && !trim.trimEnabled) {
      recommendations.push({
        id: `rec_${recId++}`,
        category: 'trim',
        title: `TRIM disabled for ${trim.model}`,
        description: trim.recommendation || 'Enable TRIM for optimal SSD performance.',
        severity: trim.severity,
        actionUrl: null,
        affectedDisk: trim.model
      })
    }
  }

  // Event log recommendations
  if (report.eventLogs.length > 0) {
    const criticalEvents = report.eventLogs.filter(e => e.severity === 'critical')
    if (criticalEvents.length > 0) {
      recommendations.push({
        id: `rec_${recId++}`,
        category: 'smart',
        title: `${criticalEvents.length} critical disk event(s) in Event Viewer`,
        description: `Disk-related errors detected in the last 48 hours. Check Event Viewer for details: ${criticalEvents[0].message.substring(0, 150)}`,
        severity: 'critical',
        actionUrl: null,
        affectedDisk: null
      })
    }
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
  recommendations.sort((a, b) => (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5))

  return recommendations
}

// ── Issue Count ──────────────────────────────────────────────────────────────
function countIssues(report: Omit<StorageDiagnosticReport, 'overallScore' | 'overallStatus' | 'recommendations' | 'issueCount'>): StorageDiagnosticReport['issueCount'] {
  const counts = { info: 0, low: 0, medium: 0, high: 0, critical: 0 }

  const allSeverities = [
    ...report.firmware.map(f => f.severity),
    ...report.drivers.map(d => d.severity),
    ...report.controllers.map(c => c.severity),
    ...report.trimStatus.map(t => t.severity),
    ...report.eventLogs.map(e => e.severity),
  ]

  for (const sev of allSeverities) {
    if (sev in counts) counts[sev as keyof typeof counts]++
  }

  return counts
}

// ── Main Scan ─────────────────────────────────────────────────────────────────
export async function runStorageDiagnostics(forceRefresh = false): Promise<StorageDiagnosticReport> {
  // Return cache if fresh enough
  if (!forceRefresh && cachedReport && Date.now() - lastScanTime < CACHE_DURATION_MS) {
    return cachedReport
  }

  const startTime = Date.now()
  log('Starting comprehensive storage diagnostics scan...')

  try {
    // Run all checks in parallel for speed
    const [firmware, driverResult, controllers, trimStatus] = await Promise.all([
      checkFirmware().catch(err => { log(`Firmware check error: ${err.message}`); return [] as FirmwareInfo[] }),
      checkDrivers().catch(err => { log(`Driver check error: ${err.message}`); return { drivers: [] as DriverInfo[], events: [] as EventLogEntry[] } }),
      checkControllers().catch(err => { log(`Controller check error: ${err.message}`); return [] as ControllerInfo[] }),
      checkTrim().catch(err => { log(`TRIM check error: ${err.message}`); return [] as TrimStatus[] }),
    ])

    const scanDurationMs = Date.now() - startTime

    const partialReport = {
      timestamp: new Date().toISOString(),
      platform: os.platform(),
      scanDurationMs,
      firmware,
      drivers: driverResult.drivers,
      controllers,
      trimStatus,
      eventLogs: driverResult.events,
    }

    const issueCount = countIssues(partialReport as any)
    const recommendations = generateRecommendations(partialReport as any)
    const { score, status } = calculateOverallScore(partialReport as any)

    const report: StorageDiagnosticReport = {
      ...partialReport,
      overallScore: score,
      overallStatus: status,
      recommendations,
      issueCount,
    }

    cachedReport = report
    lastScanTime = Date.now()

    log(`Diagnostics scan complete in ${scanDurationMs}ms — Score: ${score}/100 (${status})`)
    return report
  } catch (err: any) {
    log(`Diagnostics scan failed: ${err.message}`)
    return {
      timestamp: new Date().toISOString(),
      platform: os.platform(),
      scanDurationMs: Date.now() - startTime,
      overallScore: 100,   // scan failed — don't penalise the score
      overallStatus: 'healthy',
      firmware: [],
      drivers: [],
      controllers: [],
      trimStatus: [],
      eventLogs: [],
      recommendations: [],
      issueCount: { info: 0, low: 0, medium: 0, high: 0, critical: 0 },
      error: err.message
    }
  }
}

// ── Export Report ─────────────────────────────────────────────────────────────
export async function exportDiagnosticsReport(): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const report = cachedReport || await runStorageDiagnostics()
    const disks = await getDiskData()
    
    const now = new Date()
    const timestamp = now.toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0].slice(0, 16)
    const fileName = `DriveWatch_Report_${timestamp}.pdf`
    const filePath = path.join(app.getPath('documents'), fileName)

    await generatePdfReport(report, disks, filePath)
    log(`PDF Report exported to: ${filePath}`)

    return { success: true, filePath }
  } catch (err: any) {
    log(`Report export failed: ${err.message}`)
    return { success: false, error: err.message }
  }
}

export async function exportDiagnosticsJson(): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const report = cachedReport || await runStorageDiagnostics()
    const fileName = `DriveWatch_Diagnostics_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    const filePath = path.join(app.getPath('documents'), fileName)

    const exportData = {
      _header: 'DriveWatch Storage Health Center — Advanced JSON Export',
      _generated: report.timestamp,
      _platform: report.platform,
      overallScore: report.overallScore,
      overallStatus: report.overallStatus,
      issueCount: report.issueCount,
      recommendations: report.recommendations,
      firmware: report.firmware,
      drivers: report.drivers,
      controllers: report.controllers,
      trimStatus: report.trimStatus,
      eventLogs: report.eventLogs,
    }

    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf8')
    log(`Advanced JSON Report exported to: ${filePath}`)

    return { success: true, filePath }
  } catch (err: any) {
    log(`JSON Export failed: ${err.message}`)
    return { success: false, error: err.message }
  }
}

// ── Re-export types for convenience ──────────────────────────────────────────
export type { FirmwareInfo } from './firmwareChecker'
export type { DriverInfo, EventLogEntry } from './driverChecker'
export type { ControllerInfo } from './controllerChecker'
export type { TrimStatus } from './trimChecker'
