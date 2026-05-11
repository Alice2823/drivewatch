import { SmartAttr } from '../../components/DriveHealthScanner'

export type HealthQuality = 'Excellent' | 'Good' | 'Aging' | 'Warning' | 'Critical'
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface LifespanImpact {
  factor: string
  impact: number // Percentage change, e.g., -12
  description: string
}

export interface SmartInsight {
  attributeId: number
  name: string
  message: string
  severity: 'info' | 'warning' | 'critical'
}

export interface ThermalStatus {
  zone: 'Excellent' | 'Warm' | 'Hot' | 'Critical'
  temperature: number
  recommendation: string
  lifespanImpact: number
}

export interface FailureProbability {
  period: string
  probability: number // 0-100
}

export interface LifespanAnalysis {
  reliabilityScore: number
  healthQuality: HealthQuality
  estimatedRemainingYears: [number, number] // [min, max]
  riskLevel: RiskLevel
  thermalStatus: ThermalStatus
  impactFactors: LifespanImpact[]
  smartInsights: SmartInsight[]
  failureProbabilities: FailureProbability[]
  lastUpdated: number
}

export interface LifespanEngineInput {
  attributes: SmartAttr[]
  temperature: number | null
  powerOnHours: number | null
  model: string
  type: 'SSD' | 'HDD'
}
