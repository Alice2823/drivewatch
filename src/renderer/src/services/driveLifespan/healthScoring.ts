import { LifespanEngineInput, HealthQuality } from './types'
import { normalizeSmartValue } from './vendorProfiles'

/**
 * ══════════════════════════════════════════════════════════════
 * Reliability Score Engine — Professional Calibration
 * ══════════════════════════════════════════════════════════════
 *
 * Scoring rules (HD Sentinel / Victoria grade thresholds):
 *
 *  Surface scan penalties (only applied to REAL hardware scans):
 *   - slowCount  = confirmed weak sectors ≥150 ms (physical media)
 *   - errorCount = actual unreadable sectors (physical failure)
 *
 *  Simulated scan results (isSimulated=true) are NEVER applied
 *  as scoring penalties — they would produce false degradation.
 *
 *  Normal USB/SCSI controller jitter (50–150 ms) is NOT penalised
 *  because it is NOT stored in slowCount after the v2 calibration.
 * ══════════════════════════════════════════════════════════════
 */
export function calculateReliabilityScore(input: LifespanEngineInput): number {
  let score = 100
  const { attributes, model, type, surfaceScanResult } = input

  console.log(`[ReliabilityEngine] 🔍 Calculating reliability score for drive: "${model}" [Type: ${type}]`)

  // Check if surface scan is real or simulated
  const scanIsReal = !!surfaceScanResult &&
    surfaceScanResult.executionMode === 'REAL_SCAN' &&
    surfaceScanResult.isSimulated !== true
  if (surfaceScanResult) {
    if (scanIsReal) {
      console.log(`[ReliabilityEngine] ✅ Real hardware surface scan detected for "${model}":`, {
        slowCount: surfaceScanResult.slowCount,
        errorCount: surfaceScanResult.errorCount,
        weakSectorsCount: surfaceScanResult.weakSectors?.length
      })
    } else {
      console.log(`[ReliabilityEngine] ⚠️  Simulated surface scan detected for "${model}" — surface penalties SUPPRESSED to prevent false degradation.`)
    }
  } else {
    console.log(`[ReliabilityEngine] ⚠️ No surface scan data for "${model}" — scoring from SMART only.`)
  }

  const getAttr = (id: number) => (attributes || []).find(a => a.id === id)

  // ── 1. SMART Attributes (Firmware Telemetry) ──────────────────────────────

  const reallocated = getAttr(5)
  if (reallocated) {
    const val = normalizeSmartValue(model, 5, reallocated.raw)
    if (val > 0) {
      score -= Math.min(val * 5, 40)
      console.log(`[ReliabilityEngine] 📉 SMART Reallocated Sectors (ID 5) raw=${val}. Deducting up to 40. Score: ${score}`)
    }
  }

  const pending = getAttr(197)
  if (pending) {
    const val = normalizeSmartValue(model, 197, pending.raw)
    if (val > 0) {
      score -= Math.min(val * 10, 50)
      console.log(`[ReliabilityEngine] 📉 SMART Pending Sectors (ID 197) raw=${val}. Deducting up to 50. Score: ${score}`)
    }
  }

  const uncorrectable = getAttr(198)
  if (uncorrectable) {
    const val = normalizeSmartValue(model, 198, uncorrectable.raw)
    if (val > 0) {
      score -= Math.min(val * 15, 60)
      console.log(`[ReliabilityEngine] 📉 SMART Uncorrectable Sectors (ID 198) raw=${val}. Deducting up to 60. Score: ${score}`)
    }
  }

  // SSD Wear Level
  if (type === 'SSD') {
    const wear = getAttr(231) || getAttr(202) || getAttr(177)
    if (wear && wear.value < 90) {
      score -= (100 - wear.value) * 0.5
      console.log(`[ReliabilityEngine] 📉 SSD Wear Level: ${wear.value}/100. Score: ${score}`)
    }
  }

  // HDD Spin Retry
  if (type === 'HDD') {
    const spinRetry = getAttr(10)
    if (spinRetry && spinRetry.raw > 0) {
      score -= 10
      console.log(`[ReliabilityEngine] 📉 HDD Spin Retry Count raw=${spinRetry.raw}. Deducting 10. Score: ${score}`)
    }
  }

  const crcErrors = getAttr(199)
  if (crcErrors && crcErrors.raw > 0) {
    score -= 5
    console.log(`[ReliabilityEngine] 📉 SMART CRC Errors raw=${crcErrors.raw}. Deducting 5. Score: ${score}`)
  }

  const unsafeShutdowns = getAttr(192) || getAttr(174)
  if (unsafeShutdowns && unsafeShutdowns.raw > 100) {
    score -= 2
    console.log(`[ReliabilityEngine] 📉 SMART Unsafe Shutdowns raw=${unsafeShutdowns.raw}. Deducting 2. Score: ${score}`)
  }

  // ── 2. Real-World Surface Degradation (REAL scans only) ───────────────────
  if (scanIsReal && surfaceScanResult) {
    // slowCount = confirmed weak sectors (≥150 ms, verified by hardware read).
    // This does NOT include normal USB/SCSI controller jitter (50–150 ms),
    // which is filtered out during the scan and stored in slowCountDisplay only.
    const confirmedWeak = surfaceScanResult.slowCount || 0
    const errorCount    = surfaceScanResult.errorCount || 0
    const isQuick       = surfaceScanResult.scanMode === 'quick'
    const scaleFactor   = isQuick ? 0.2 : 1.0

    // ── Unreadable / Bad Sectors: severe, immediate impact ────────────────
    if (errorCount > 0) {
      // Each unreadable sector is a confirmed physical failure.
      // Scale down penalty for quick scans since they only sample the drive.
      const baseDeduction = errorCount * 15 + 20
      const badDeduction = Math.min(Math.round(baseDeduction * scaleFactor), isQuick ? 25 : 70)
      score -= badDeduction
      console.log(`[ReliabilityEngine] 🚨 UNREADABLE sectors: ${errorCount} (${isQuick ? 'Quick Scan' : 'Full Scan'}). Deducting ${badDeduction}. Score: ${score}`)
    }

    // ── Confirmed Weak Sectors (≥150 ms) ──────────────────────────────────
    // Scaled conservatively:
    //   1–5   → negligible (minor aging, acceptable)
    //   6–25  → minor deduction
    //   26–100 → moderate deduction
    //   100+  → significant but capped (drive still operational)
    if (confirmedWeak > 0) {
      let weakDeduction = 0
      if (confirmedWeak <= 5) {
        weakDeduction = confirmedWeak * 0.5        // max 2.5 pts
      } else if (confirmedWeak <= 25) {
        weakDeduction = 2.5 + (confirmedWeak - 5) * 0.8   // max 18.5 pts
      } else if (confirmedWeak <= 100) {
        weakDeduction = 18.5 + (confirmedWeak - 25) * 0.5  // max 56 pts
      } else {
        weakDeduction = 56 + (confirmedWeak - 100) * 0.2   // slower growth beyond 100
      }
      const finalWeakDeduction = Math.min(Math.round(weakDeduction * scaleFactor), isQuick ? 15 : 50)
      score -= finalWeakDeduction
      console.log(`[ReliabilityEngine] 📉 Confirmed weak sectors: ${confirmedWeak} (${isQuick ? 'Quick Scan' : 'Full Scan'}). Deducting ${finalWeakDeduction}. Score: ${score}`)
    }

    // ── High-latency / retry overhead ─────────────────────────────────────
    const weakSectors = surfaceScanResult.weakSectors || []
    let retriesCount = 0
    weakSectors.forEach((sec: any) => {
      if (sec.readTimeMs > 400) retriesCount++ // only extreme latency (>400ms) counts
    })
    if (retriesCount > 0) {
      const finalRetryDeduction = Math.min(Math.round(retriesCount * 0.5 * scaleFactor), isQuick ? 3 : 10)
      score -= finalRetryDeduction
      console.log(`[ReliabilityEngine] 📉 High-latency reads (>400ms): ${retriesCount} (${isQuick ? 'Quick Scan' : 'Full Scan'}). Deducting ${finalRetryDeduction}. Score: ${score}`)
    }
  }

  // ── 3. Strict Scoring Clamps ───────────────────────────────────────────────
  //
  // Clamps are applied ONLY from confirmed real hardware scan data.
  // Simulated scans never trigger clamps.
  let finalScore = Math.max(0, Math.min(100, Math.round(score)))
  const scoreBeforeClamps = finalScore

  if (scanIsReal && surfaceScanResult) {
    const confirmedWeak = surfaceScanResult.slowCount || 0
    const errorCount    = surfaceScanResult.errorCount || 0
    const isQuick       = surfaceScanResult.scanMode === 'quick'

    if (errorCount > 0) {
      // Confirmed unreadable sectors → cap at CRITICAL (≤45) for full scan, or WARNING (≤75) for quick scan
      const clampVal = isQuick ? 75 : 45
      finalScore = Math.min(finalScore, clampVal)
      if (finalScore < scoreBeforeClamps)
        console.log(`[ReliabilityEngine] 🛑 CLAMP: Unreadable sectors present (${isQuick ? 'Quick Scan' : 'Full Scan'}) → capped at ${finalScore}%`)
    } else if (confirmedWeak >= 500) {
      // 500+ confirmed weak sectors (severe physical degradation)
      const clampVal = isQuick ? 80 : 55
      finalScore = Math.min(finalScore, clampVal)
      if (finalScore < scoreBeforeClamps)
        console.log(`[ReliabilityEngine] 🛑 CLAMP: 500+ confirmed weak sectors (${isQuick ? 'Quick Scan' : 'Full Scan'}) → capped at ${finalScore}%`)
    } else if (confirmedWeak >= 100) {
      // 100–499 confirmed weak sectors (significant degradation)
      const clampVal = isQuick ? 85 : 68
      finalScore = Math.min(finalScore, clampVal)
      if (finalScore < scoreBeforeClamps)
        console.log(`[ReliabilityEngine] 🛑 CLAMP: 100–499 confirmed weak sectors (${isQuick ? 'Quick Scan' : 'Full Scan'}) → capped at ${finalScore}%`)
    } else if (confirmedWeak >= 25) {
      // 25–99 confirmed weak sectors (moderate degradation)
      const clampVal = isQuick ? 90 : 80
      finalScore = Math.min(finalScore, clampVal)
      if (finalScore < scoreBeforeClamps)
        console.log(`[ReliabilityEngine] 🛑 CLAMP: 25–99 confirmed weak sectors (${isQuick ? 'Quick Scan' : 'Full Scan'}) → capped at ${finalScore}%`)
    }
    // 1–24 confirmed weak sectors → no hard clamp (minor aging, normal for older drives)
  }

  // ── 4. Operational Soft Floor ──────────────────────────────────────────────
  const isSmartAccessible = Array.isArray(attributes) && attributes.length > 0
  let isMediaUsable = true
  if (surfaceScanResult) {
    const total  = surfaceScanResult.totalChunks || 0
    const errors = surfaceScanResult.errorCount  || 0
    if (total > 0 && (errors / total) > 0.02) isMediaUsable = false
  }

  const driveOperational = isSmartAccessible && isMediaUsable
  if (driveOperational) {
    if (finalScore < 5) {
      console.log(`[ReliabilityEngine] 🛡️ SOFT FLOOR: Drive operational but severely degraded → floored at 5%`)
      finalScore = 5
    }
  } else if (!isMediaUsable) {
    console.log(`[ReliabilityEngine] 🚨 CATASTROPHIC FAILURE: >2% of sectors unreadable → score 0`)
    finalScore = 0
  }

  console.log(`[ReliabilityEngine] 🏆 Final Reliability Score: ${finalScore}%`)
  return finalScore
}

export function mapScoreToQuality(score: number): HealthQuality {
  if (score >= 90) return 'Excellent'
  if (score >= 70) return 'Good'
  if (score >= 50) return 'Aging'
  if (score >= 30) return 'Warning'
  return 'Critical'
}
