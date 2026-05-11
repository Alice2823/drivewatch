import { FailureProbability, HealthQuality } from './types'

export function estimateLifespan(score: number, quality: HealthQuality, hours: number | null): [number, number] {
  // Base lifespan estimation (non-absolute)
  // Average drive lasts 5-7 years
  const baseMin = 5
  const baseMax = 8
  
  const ageInYears = hours ? hours / 8760 : 0
  
  let remainingMin = Math.max(0, baseMin - ageInYears)
  let remainingMax = Math.max(0, baseMax - ageInYears)

  // Adjust by health score
  const healthFactor = score / 100
  remainingMin *= healthFactor
  remainingMax *= healthFactor

  // Precision check: if critical, range is very low
  if (quality === 'Critical') return [0, 0.5]
  if (quality === 'Warning') return [0.5, 2]

  return [Math.round(remainingMin * 10) / 10, Math.round(remainingMax * 10) / 10]
}

export function estimateFailureProbabilities(score: number, risk: string): FailureProbability[] {
  const baseProb = (100 - score) / 100
  
  return [
    {
      period: 'Next 30 Days',
      probability: Math.min(Math.round(baseProb * 10), 100)
    },
    {
      period: 'Next 6 Months',
      probability: Math.min(Math.round(baseProb * 25), 100)
    },
    {
      period: 'Next 1 Year',
      probability: Math.min(Math.round(baseProb * 60), 100)
    }
  ]
}
