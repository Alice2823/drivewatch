import { LifespanAnalysis, LifespanEngineInput } from './types'
import { calculateReliabilityScore, mapScoreToQuality } from './healthScoring'
import { analyzeTemperature } from './temperatureAnalyzer'
import { analyzeUsage } from './usageAnalyzer'
import { analyzeRisk } from './riskAnalyzer'
import { estimateLifespan, estimateFailureProbabilities } from './predictionEngine'

export async function analyzeDriveLifespan(input: LifespanEngineInput): Promise<LifespanAnalysis> {
  // Simulate async work to not block main thread
  return new Promise((resolve) => {
    setTimeout(() => {
      const score = calculateReliabilityScore(input)
      const quality = mapScoreToQuality(score)
      const thermal = analyzeTemperature(input.temperature)
      const usageImpacts = analyzeUsage(input)
      const { risk, insights } = analyzeRisk(input, score)
      const lifespanRange = estimateLifespan(score, quality, input.powerOnHours)
      const probabilities = estimateFailureProbabilities(score, risk)

      // Merge impacts
      const impactFactors = [...usageImpacts]
      if (thermal.lifespanImpact !== 0) {
        impactFactors.push({
          factor: 'Thermal Exposure',
          impact: thermal.lifespanImpact,
          description: thermal.recommendation
        })
      }

      const analysis: LifespanAnalysis = {
        reliabilityScore: score,
        healthQuality: quality,
        estimatedRemainingYears: lifespanRange,
        riskLevel: risk,
        thermalStatus: thermal,
        impactFactors,
        smartInsights: insights,
        failureProbabilities: probabilities,
        lastUpdated: Date.now()
      }

      resolve(analysis)
    }, 50) // Small delay to ensure it feels asynchronous
  })
}
