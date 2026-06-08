import { LifespanAnalysis, LifespanEngineInput } from './types'
import { calculateReliabilityScore, mapScoreToQuality } from './healthScoring'
import { analyzeTemperature } from './temperatureAnalyzer'
import { analyzeUsage } from './usageAnalyzer'
import { analyzeRisk, pendingCriticalFlags, previousRiskFactors, cachedSurfacePenalties, calculateSmartHealth } from './riskAnalyzer'
import { estimateLifespan, estimateFailureProbabilities } from './predictionEngine'

export async function analyzeDriveLifespan(input: LifespanEngineInput): Promise<LifespanAnalysis> {
  return new Promise((resolve) => {
    setTimeout(() => {
      // ── Entry-point validation ────────────────────────────────────────────
      console.group(`[LifespanEngine] 🚀 analyzeDriveLifespan — "${input.model}"`)
      console.log('Drive type:', input.type)
      console.log('SMART attributes count:', input.attributes?.length ?? 0)
      console.log('Temperature:', input.temperature)
      console.log('Power-on hours:', input.powerOnHours)

      const scanResult = input.surfaceScanResult
      const scanIsReal = !!scanResult &&
        scanResult.executionMode === 'REAL_SCAN' &&
        scanResult.isSimulated !== true

      if (scanResult) {
        if (scanIsReal) {
          console.log('✅ Real surface scan PRESENT:', {
            diskIndex:   scanResult.diskIndex,
            slowCount:   scanResult.slowCount,
            errorCount:  scanResult.errorCount,
            weakSectors: scanResult.weakSectors?.length,
            scanMode:    scanResult.scanMode
          })
        } else {
          console.warn('⚠️ SIMULATED surface scan detected — surface-scan scoring penalties SUPPRESSED.')
          console.warn('   Lifespan calculated from SMART data only. Run as admin for real hardware results.')
        }
      } else {
        console.warn('⚠️ No surface scan data — scoring from SMART only.')
      }

      // Extract confirmed weak / unreadable counts (real scans only)
      let confirmedWeak = 0
      let unreadable    = 0
      if (scanIsReal && scanResult) {
        confirmedWeak = scanResult.slowCount  || 0   // confirmed ≥150 ms sectors
        unreadable    = scanResult.errorCount || 0   // actual read failures
      }

      console.log('[Lifespan]')
      console.log(`Loaded telemetry:\nconfirmedWeak=${confirmedWeak}\nunreadable=${unreadable}\nscanIsReal=${scanIsReal}`)

      const score        = calculateReliabilityScore(input)
      const quality      = mapScoreToQuality(score)
      const thermal      = analyzeTemperature(input.temperature)
      const usageImpacts = analyzeUsage(input)
      
      let { risk, insights } = analyzeRisk(input, score)

      // ── Internal Consistency Override Check ────────────────────────────────
      if (score >= 85 && risk === 'CRITICAL') {
        console.warn(`[LifespanEngine] ⚠️ Inconsistency detected: Excellent reliability (${score}%) but risk is CRITICAL! Rebuilding analysis and clearing stale caches...`)
        
        pendingCriticalFlags.clear()
        previousRiskFactors.clear()
        cachedSurfacePenalties.clear()
        
        const rebuilt = analyzeRisk(input, score)
        risk = rebuilt.risk
        insights = rebuilt.insights

        const smartHealth = input.smartUnsupported ? null : calculateSmartHealth(input.attributes || [], input.type)
        const unreadableCount = scanIsReal && scanResult ? (scanResult.errorCount || 0) : 0
        const confirmedWeakCount = scanIsReal && scanResult ? (scanResult.slowCount || 0) : 0
        
        const criticalWarningAttr = (input.attributes || []).find(a => a.id === 1)
        const isCriticalWarningActive = input.type === 'SSD' && criticalWarningAttr && criticalWarningAttr.raw > 0
        
        const pendingAttr = (input.attributes || []).find(a => a.id === 197)
        const isPendingActive = pendingAttr && pendingAttr.raw > 0
        
        const uncorrectableAttr = (input.attributes || []).find(a => a.id === 198)
        const isUncorrectableActive = uncorrectableAttr && uncorrectableAttr.raw > 0
        
        const reallocatedAttr = (input.attributes || []).find(a => a.id === 5)
        const isMediaErrorActive = input.type === 'SSD' && reallocatedAttr && reallocatedAttr.raw > 0
        
        const isCriticalActive = isCriticalWarningActive || isPendingActive || isUncorrectableActive || isMediaErrorActive

        if (
          score >= 85 &&
          (smartHealth === null || smartHealth >= 90) &&
          unreadableCount === 0 &&
          confirmedWeakCount === 0 &&
          !isCriticalActive
        ) {
          console.warn(`[LifespanEngine] 🛡️ Consistency override triggered: forcing risk from ${risk} to LOW due to nominal metrics.`)
          risk = 'LOW'
        }
      }

      const lifespanRange  = estimateLifespan(score, quality, input)
      const probabilities  = estimateFailureProbabilities(score, risk, input)

      // Merge impact factors
      const impactFactors = [...usageImpacts]

      if (thermal.lifespanImpact !== 0) {
        impactFactors.push({
          factor: 'Thermal Exposure',
          impact: thermal.lifespanImpact,
          description: thermal.recommendation
        })
      }

      // Surface degradation impact — only from REAL confirmed hardware reads
      if (scanIsReal && scanResult) {
        if (unreadable > 0 || confirmedWeak > 0) {
          // Impact is proportional to confirmed physical degradation only.
          // Unreadable sectors carry heavier weight than weak sectors.
          const isQuick = scanResult.scanMode === 'quick'
          const scaleFactor = isQuick ? 0.2 : 1.0
          const baseImpact = Math.round(confirmedWeak * 0.05) + (unreadable * 20) + (confirmedWeak > 0 ? 5 : 0)
          
          const impact = -Math.min(
            Math.round(baseImpact * scaleFactor),
            60
          )
          
          impactFactors.push({
            factor: 'Surface Degradation',
            impact,
            description: `${confirmedWeak} confirmed weak sector${confirmedWeak !== 1 ? 's' : ''} (≥150 ms) and ${unreadable} unreadable sector${unreadable !== 1 ? 's' : ''} detected by hardware surface scan.${isQuick ? ' (Quick Scan scale factor applied)' : ''}`
          })
        }
      } else if (scanResult && !scanIsReal) {
        // Simulated scan — add an informational note, no scoring impact
        impactFactors.push({
          factor: 'Surface Scan (Simulated)',
          impact: 0,
          description: 'Surface scan ran in simulation mode (administrator access required for raw disk I/O). No surface-scan penalties applied to lifespan scoring.'
        })
      }

      const analysis: LifespanAnalysis = {
        reliabilityScore:       score,
        healthQuality:          quality,
        estimatedRemainingYears: lifespanRange,
        riskLevel:              risk,
        thermalStatus:          thermal,
        impactFactors,
        smartInsights:          insights,
        failureProbabilities:   probabilities,
        lastUpdated:            Date.now()
      }

      console.log(`[LifespanEngine] 📊 Final — score=${score}, risk=${risk}, lifespan=${lifespanRange}`)
      console.groupEnd()
      resolve(analysis)
    }, 50)
  })
}
