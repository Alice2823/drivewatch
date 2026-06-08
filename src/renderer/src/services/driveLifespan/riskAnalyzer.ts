import { LifespanEngineInput, RiskLevel, SmartInsight } from './types'
import { normalizeSmartValue } from './vendorProfiles'

// ── Stale Risk Cache Contamination Prevention ────────────────────────────────
export const pendingCriticalFlags = new Set<string>()
export const previousRiskFactors = new Map<string, any>()
export const cachedSurfacePenalties = new Map<string, number>()

/**
 * Helper to calculate the baseline SMART health percentage.
 */
export function calculateSmartHealth(attributes: any[], type: 'SSD' | 'HDD'): number {
  if (type === 'SSD') {
    const wear = (attributes || []).find(a => [231, 202, 177].includes(a.id))
    if (wear) return wear.value
  }
  
  // HDD or SSD fallback: calculate health based on critical attributes
  let health = 100
  const reallocated = (attributes || []).find(a => a.id === 5)
  if (reallocated) {
    health -= Math.min(reallocated.raw * 2, 30) // cap reallocated deduction at 30% for health
  }
  const pending = (attributes || []).find(a => a.id === 197)
  if (pending && pending.raw > 0) {
    health -= Math.min(pending.raw * 5, 50)
  }
  const uncorrectable = (attributes || []).find(a => a.id === 198)
  if (uncorrectable && uncorrectable.raw > 0) {
    health -= Math.min(uncorrectable.raw * 10, 60)
  }
  return Math.max(0, health)
}

/**
 * ══════════════════════════════════════════════════════════════
 * Risk Analyzer — Professional Calibration (v3 Rewrite)
 * ══════════════════════════════════════════════════════════════
 */
export function analyzeRisk(input: LifespanEngineInput, score: number): { risk: RiskLevel, insights: SmartInsight[] } {
  // ── 1. Clear stale derived risk cache contamination ───────────────────────
  pendingCriticalFlags.clear()
  previousRiskFactors.clear()
  cachedSurfacePenalties.clear()

  const insights: SmartInsight[] = []
  const { attributes, temperature, model, type, surfaceScanResult, smartUnsupported } = input

  console.log(`[RiskAnalyzer] 🔍 Determining risk level for "${model}" (score=${score}%)`)

  // Determine if surface scan data is from real hardware
  const scanIsReal = !!surfaceScanResult &&
    surfaceScanResult.executionMode === 'REAL_SCAN' &&
    surfaceScanResult.isSimulated !== true
  const isSimulated = surfaceScanResult?.isSimulated === true

  if (surfaceScanResult && !scanIsReal) {
    console.log(`[RiskAnalyzer] ⚠️ Simulated surface scan — surface risk factors SUPPRESSED`)
  }

  // ── SMART Insight Generation ──────────────────────────────────────────────
  const addSmartInsight = (id: number, name: string, msg: string, severity: 'info' | 'warning' | 'critical') => {
    const attr = (attributes || []).find(a => a.id === id)
    if (attr) {
      const rawVal = normalizeSmartValue(model, id, attr.raw)
      if (rawVal > 0) {
        insights.push({ attributeId: id, name, message: msg, severity })
        console.log(`[RiskAnalyzer] 💡 SMART Insight [${severity.toUpperCase()}]: "${name}" (ID ${id})`)
      }
    }
  }

  // Map standard insights based on actual drive type
  if (type === 'SSD') {
    // SSD specific insights
    const criticalWarningAttr = (attributes || []).find(a => a.id === 1)
    if (criticalWarningAttr && criticalWarningAttr.raw > 0) {
      insights.push({
        attributeId: 1,
        name: 'NVMe Critical Warning',
        message: `NVMe controller reported critical warning status (flags: ${criticalWarningAttr.raw}).`,
        severity: 'critical'
      })
    }
    
    // Media errors (ID 5)
    addSmartInsight(5, 'Media Errors', 'NAND flash media errors indicate cell or read/write degradation.', 'critical')
    // Unsafe shutdowns (ID 192)
    addSmartInsight(192, 'Unsafe Shutdowns', 'Unsafe shutdowns can risk filesystem corruption or sudden power-loss failure.', 'warning')
  } else {
    // HDD specific insights
    addSmartInsight(5, 'Reallocated Sectors', 'Reallocated sectors indicate damaged storage areas remapped by drive firmware.', 'warning')
    addSmartInsight(197, 'Pending Sectors', 'Pending sectors indicate unstable disk regions that may cause read failures.', 'critical')
    addSmartInsight(198, 'Uncorrectable Sectors', 'Uncorrectable errors represent permanent data loss risks.', 'critical')
    addSmartInsight(10, 'Spin Retry Count', 'Failed spin-up attempts indicate mechanical wear in the drive motor or bearings.', 'critical')
  }

  // Generic SATA / Connection check (ID 199)
  addSmartInsight(199, 'CRC Error Count', 'UltraDMA CRC errors often indicate a faulty SATA/USB cable or connection.', 'warning')

  // ── Real-World Surface Degradation Insights (real hardware scans only) ────
  let unreadableCount = 0
  let confirmedWeak = 0

  if (scanIsReal && surfaceScanResult) {
    unreadableCount = surfaceScanResult.errorCount || 0
    confirmedWeak = surfaceScanResult.slowCount || 0

    if (unreadableCount > 0) {
      insights.push({
        attributeId: 9991,
        name: 'Physical Media Failure',
        message: `${unreadableCount} unreadable sector${unreadableCount > 1 ? 's' : ''} detected — confirmed physical degradation of disk platters or NAND cells.`,
        severity: 'critical'
      })
      console.log(`[RiskAnalyzer] 💡 Surface Insight [CRITICAL]: Physical Media Failure (${unreadableCount} unreadable)`)
    }

    if (confirmedWeak >= 25) {
      const severity: 'info' | 'warning' | 'critical' =
        confirmedWeak >= 500 ? 'critical' :
        confirmedWeak >= 100 ? 'warning' : 'info'
      insights.push({
        attributeId: 9992,
        name: 'Surface Decay Detected',
        message: `${confirmedWeak} confirmed weak sectors (≥150 ms read latency). Physical media access speed is degrading.`,
        severity
      })
      console.log(`[RiskAnalyzer] 💡 Surface Insight [${severity.toUpperCase()}]: Surface Decay (${confirmedWeak} confirmed weak sectors)`)
    }
  }

  // ── Risk Level Determination ──────────────────────────────────────────────
  let risk: RiskLevel = 'LOW'
  let riskReason = 'Nominal telemetry — no significant issues'

  const smartHealth = smartUnsupported ? null : calculateSmartHealth(attributes || [], type)

  // 1. Gather all critical metrics
  const hasCriticalSmartFlag = insights.some(i => i.severity === 'critical' && i.attributeId < 9000)
  const hasWarningSmartFlag = insights.some(i => i.severity === 'warning' && i.attributeId < 9000)

  const pendingAttr = (attributes || []).find(a => a.id === 197)
  const uncorrectableAttr = (attributes || []).find(a => a.id === 198)
  const reallocatedAttr = (attributes || []).find(a => a.id === 5)
  const criticalWarningAttr = (attributes || []).find(a => a.id === 1)

  const isPendingActive = pendingAttr && pendingAttr.raw > 0
  const isUncorrectableActive = uncorrectableAttr && uncorrectableAttr.raw > 0
  const isCriticalWarningActive = type === 'SSD' && criticalWarningAttr && criticalWarningAttr.raw > 0
  
  // Media errors on SSD (ID 5)
  const isMediaErrorActive = type === 'SSD' && reallocatedAttr && reallocatedAttr.raw > 0
  
  // Reallocated sector explosion: HDD reallocated sectors > 100
  const isReallocatedExplosion = type === 'HDD' && reallocatedAttr && reallocatedAttr.raw > 100

  const isDriveInaccessible = !smartUnsupported && (!attributes || attributes.length === 0)

  // Catastrophic scan failures (>2% of sectors are unreadable)
  let isCatastrophicScanFailure = false
  if (surfaceScanResult && scanIsReal) {
    const total = surfaceScanResult.totalChunks || 0
    const errors = surfaceScanResult.errorCount || 0
    if (total > 0 && (errors / total) > 0.02) {
      isCatastrophicScanFailure = true
    }
  }

  // ── RISK CLASSIFICATION HIERARCHY ─────────────────────────────────────────

  // A. CRITICAL (strictly validated)
  if (
    unreadableCount > 0 ||
    isPendingActive ||
    isUncorrectableActive ||
    isMediaErrorActive ||
    isReallocatedExplosion ||
    isCriticalWarningActive ||
    (smartHealth !== null && smartHealth < 50) ||
    score < 30 ||
    isDriveInaccessible ||
    isCatastrophicScanFailure
  ) {
    risk = 'CRITICAL'
    const reasonParts: string[] = []
    if (unreadableCount > 0) reasonParts.push(`unreadable=${unreadableCount}`)
    if (isPendingActive) reasonParts.push(`pending sectors active`)
    if (isUncorrectableActive) reasonParts.push(`uncorrectable sectors active`)
    if (isMediaErrorActive) reasonParts.push(`media errors active`)
    if (isReallocatedExplosion) reasonParts.push(`reallocated explosion (${reallocatedAttr?.raw})`)
    if (isCriticalWarningActive) reasonParts.push(`NVMe critical warning active`)
    if (smartHealth !== null && smartHealth < 50) reasonParts.push(`SMART health < 50 (${smartHealth}%)`)
    if (score < 30) reasonParts.push(`reliability < 30 (${score}%)`)
    if (isDriveInaccessible) reasonParts.push(`drive inaccessible`)
    if (isCatastrophicScanFailure) reasonParts.push(`catastrophic scan failure`)
    riskReason = `Critical: ${reasonParts.join(', ')}`
  }
  // B. HIGH
  else if (
    confirmedWeak >= 200 ||
    (smartHealth !== null && smartHealth >= 50 && smartHealth <= 70) ||
    (score >= 30 && score <= 60) ||
    (temperature !== null && temperature >= 55) ||
    (type === 'HDD' && hasCriticalSmartFlag) // e.g. mechanical retry flags but not exploded
  ) {
    risk = 'HIGH'
    const reasonParts: string[] = []
    if (confirmedWeak >= 200) reasonParts.push(`weak sectors=${confirmedWeak}`)
    if (smartHealth !== null && smartHealth >= 50 && smartHealth <= 70) reasonParts.push(`SMART health 50-70 (${smartHealth}%)`)
    if (score >= 30 && score <= 60) reasonParts.push(`reliability 30-60 (${score}%)`)
    if (temperature !== null && temperature >= 55) reasonParts.push(`overheating (${temperature}°C)`)
    if (type === 'HDD' && hasCriticalSmartFlag) reasonParts.push(`mechanical spin retry active`)
    riskReason = `High: ${reasonParts.join(', ')}`
  }
  // C. MEDIUM
  else if (
    (confirmedWeak >= 10 && confirmedWeak < 200) ||
    hasWarningSmartFlag ||
    (smartHealth !== null && smartHealth > 70 && smartHealth < 90) ||
    (score > 60 && score <= 80) ||
    (temperature !== null && temperature >= 45 && temperature < 55)
  ) {
    risk = 'MEDIUM'
    const reasonParts: string[] = []
    if (confirmedWeak >= 10) reasonParts.push(`weak sectors=${confirmedWeak}`)
    if (hasWarningSmartFlag) reasonParts.push(`minor SMART warnings present`)
    if (smartHealth !== null && smartHealth > 70 && smartHealth < 90) reasonParts.push(`SMART health 70-90 (${smartHealth}%)`)
    if (score > 60 && score <= 80) reasonParts.push(`reliability 60-80 (${score}%)`)
    if (temperature !== null && temperature >= 45 && temperature < 55) reasonParts.push(`moderate temperature (${temperature}°C)`)
    riskReason = `Medium: ${reasonParts.join(', ')}`
  }
  // D. LOW
  else {
    risk = 'LOW'
    riskReason = 'Nominal telemetry — no critical SMART attributes, excellent reliability'
  }

  // ── SMART HEALTH NORMALIZATION & CONSISTENCY CHECK ────────────────────────
  if (
    (smartHealth === null || smartHealth >= 90) &&
    score >= 85 &&
    unreadableCount === 0 &&
    confirmedWeak === 0 &&
    !isCriticalWarningActive &&
    !isPendingActive &&
    !isUncorrectableActive &&
    !isMediaErrorActive
  ) {
    risk = 'LOW'
    riskReason = 'no critical SMART attributes'
  }

  // ── REQUIRED DIAGNOSTIC VALIDATION PANEL LOG ──────────────────────────────
  console.log(`
[RiskEngine]
risk=${risk}
reason=${riskReason}
unreadable=${unreadableCount}
weak=${confirmedWeak}
smartHealth=${smartHealth}
reliability=${score}
simulation=${isSimulated}
  `)

  return { risk, insights }
}
