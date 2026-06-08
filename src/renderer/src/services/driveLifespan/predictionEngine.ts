import { FailureProbability, HealthQuality, LifespanEngineInput } from './types'

export function estimateLifespan(
  score: number,
  quality: HealthQuality,
  input: LifespanEngineInput
): [number, number] {
  const { powerOnHours, type, surfaceScanResult } = input
  const scanIsReal = !!surfaceScanResult &&
    surfaceScanResult.executionMode === 'REAL_SCAN' &&
    surfaceScanResult.isSimulated !== true

  console.log(`[PredictionEngine] 🔮 Estimating remaining lifespan for score=${score}%, quality=${quality}, driveType=${type}`)

  // Average new drive baseline lifespan
  const baseMin = type === 'SSD' ? 6 : 5
  const baseMax = type === 'SSD' ? 10 : 8
  
  const ageInYears = powerOnHours ? powerOnHours / 8760 : 0
  
  let remainingMin = Math.max(0.1, baseMin - ageInYears)
  let remainingMax = Math.max(0.2, baseMax - ageInYears)

  // Adjust by score
  const healthFactor = score / 100
  remainingMin *= healthFactor
  remainingMax *= healthFactor

  // ── Real-World Surface Scan Penalties ──
  if (scanIsReal && surfaceScanResult) {
    const { slowCount = 0, errorCount = 0 } = surfaceScanResult

    if (errorCount > 0) {
      // Confirmed bad sectors indicate active drive failure (weeks to months warning)
      console.log(`[PredictionEngine] ⚠️Imminent Failure Imposed: errorCount=${errorCount} > 0. Restricting lifespan to 0.0-0.2 years (months)`)
      return [0.0, 0.2] // ~0 to 2 months
    }
    
    if (slowCount >= 300) {
      // Extensive surface decay indicates imminent failure (3 to 8 months warning)
      console.log(`[PredictionEngine] ⚠️Imminent Failure Imposed: slowCount=${slowCount} >= 300. Restricting lifespan to 0.2-0.7 years (months)`)
      return [0.2, 0.7]
    }
    
    if (slowCount >= 50) {
      // Moderate surface decay (6 to 18 months)
      remainingMin = Math.min(remainingMin, 0.5)
      remainingMax = Math.min(remainingMax, 1.5)
      console.log(`[PredictionEngine] ⚠️ Restricting lifespan due to moderate slow sectors: ${slowCount} >= 50. Cap: 0.5-1.5 years`)
    } else if (slowCount >= 10) {
      // Light surface decay (1.5 to 3 years)
      remainingMin = Math.min(remainingMin, 1.5)
      remainingMax = Math.min(remainingMax, 3.0)
      console.log(`[PredictionEngine] ⚠️ Restricting lifespan due to light slow sectors: ${slowCount} >= 10. Cap: 1.5-3.0 years`)
    }
  }

  // Fallback clamps based on overall Health Quality
  if (quality === 'Critical') {
    console.log(`[PredictionEngine] ⚠️ Health quality is CRITICAL. Restricting lifespan to 0.0-0.2 years.`)
    return [0.0, 0.2]
  }
  if (quality === 'Warning') {
    console.log(`[PredictionEngine] ⚠️ Health quality is WARNING. Restricting lifespan to 0.3-1.2 years.`)
    return [0.3, 1.2]
  }
  if (quality === 'Aging') {
    console.log(`[PredictionEngine] ⚠️ Health quality is AGING. Restricting lifespan to 1.0-2.5 years.`)
    return [1.0, 2.5]
  }

  const finalMin = Math.round(remainingMin * 10) / 10
  const finalMax = Math.round(remainingMax * 10) / 10
  console.log(`[PredictionEngine] 🏆 Predicted Lifespan Range: ${finalMin} – ${finalMax} years`)
  return [finalMin, finalMax]
}

export function estimateFailureProbabilities(
  score: number,
  risk: string,
  input: LifespanEngineInput
): FailureProbability[] {
  const { surfaceScanResult } = input
  const scanIsReal = !!surfaceScanResult &&
    surfaceScanResult.executionMode === 'REAL_SCAN' &&
    surfaceScanResult.isSimulated !== true
  
  let p30Days = 1
  let p6Months = 3
  let p1Year = 5

  if (risk === 'CRITICAL') {
    // Media degradation or multiple critical SMART warnings (extremely high near-term failure risk)
    p30Days = 75
    p6Months = 92
    p1Year = 98

    if (scanIsReal && surfaceScanResult && surfaceScanResult.errorCount > 0) {
      p30Days = 85
      p6Months = 96
      p1Year = 99
    }
  } else if (risk === 'HIGH') {
    p30Days = 35
    p6Months = 65
    p1Year = 88
  } else if (risk === 'MEDIUM') {
    p30Days = 8
    p6Months = 22
    p1Year = 48
  } else {
    // LOW Risk
    const wearFactor = (100 - score) / 100
    p30Days = Math.max(1, Math.round(wearFactor * 3))
    p6Months = Math.max(2, Math.round(wearFactor * 8))
    p1Year = Math.max(5, Math.round(wearFactor * 15))
  }

  console.log(`[PredictionEngine] 📊 Estimated failure curve for risk="${risk}": 30d=${p30Days}%, 6mo=${p6Months}%, 1yr=${p1Year}%`)

  return [
    {
      period: 'Next 30 Days',
      probability: Math.min(p30Days, 100)
    },
    {
      period: 'Next 6 Months',
      probability: Math.min(p6Months, 100)
    },
    {
      period: 'Next 1 Year',
      probability: Math.min(p1Year, 100)
    }
  ]
}
