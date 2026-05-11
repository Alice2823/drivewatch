import { LifespanEngineInput, HealthQuality } from './types'
import { normalizeSmartValue } from './vendorProfiles'

export function calculateReliabilityScore(input: LifespanEngineInput): number {
  let score = 100
  const { attributes, model, type } = input

  const getAttr = (id: number) => attributes.find(a => a.id === id)

  // 1. Critical Errors (Big hits)
  const reallocated = getAttr(5) // Reallocated Sectors
  if (reallocated) {
    const val = normalizeSmartValue(model, 5, reallocated.raw)
    if (val > 0) score -= Math.min(val * 5, 40)
  }

  const pending = getAttr(197) // Current Pending Sector
  if (pending) {
    const val = normalizeSmartValue(model, 197, pending.raw)
    if (val > 0) score -= Math.min(val * 10, 50)
  }

  const uncorrectable = getAttr(198) // Offline Uncorrectable
  if (uncorrectable) {
    const val = normalizeSmartValue(model, 198, uncorrectable.raw)
    if (val > 0) score -= Math.min(val * 15, 60)
  }

  // 2. SSD Wear (SSD only)
  if (type === 'SSD') {
    const wear = getAttr(231) || getAttr(202) || getAttr(177) // SSD Wear Level / Life Left
    if (wear) {
      // Many SSDs report health as Current Value (100 -> 0)
      if (wear.value < 90) score -= (100 - wear.value) * 0.5
    }
  }

  // 3. HDD Instability
  if (type === 'HDD') {
    const spinRetry = getAttr(10)
    if (spinRetry && spinRetry.raw > 0) score -= 10
  }

  // 4. Minor issues
  const crcErrors = getAttr(199)
  if (crcErrors && crcErrors.raw > 0) score -= 5

  const unsafeShutdowns = getAttr(192) || getAttr(174)
  if (unsafeShutdowns && unsafeShutdowns.raw > 100) score -= 2

  return Math.max(0, Math.min(100, Math.round(score)))
}

export function mapScoreToQuality(score: number): HealthQuality {
  if (score >= 90) return 'Excellent'
  if (score >= 75) return 'Good'
  if (score >= 50) return 'Aging'
  if (score >= 25) return 'Warning'
  return 'Critical'
}
