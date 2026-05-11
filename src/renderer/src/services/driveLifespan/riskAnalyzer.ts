import { LifespanEngineInput, RiskLevel, SmartInsight } from './types'
import { normalizeSmartValue } from './vendorProfiles'

export function analyzeRisk(input: LifespanEngineInput, score: number): { risk: RiskLevel, insights: SmartInsight[] } {
  const insights: SmartInsight[] = []
  const { attributes, temperature, model } = input

  // Intelligent Insight Generation
  const addInsight = (id: number, name: string, msg: string, severity: 'info' | 'warning' | 'critical') => {
    const attr = attributes.find(a => a.id === id)
    if (attr && normalizeSmartValue(model, id, attr.raw) > 0) {
      insights.push({ attributeId: id, name, message: msg, severity })
    }
  }

  addInsight(5, 'Reallocated Sectors', 'Reallocated sectors indicate damaged storage areas remapped by firmware.', 'warning')
  addInsight(197, 'Pending Sectors', 'Pending sectors may indicate unstable disk regions requiring inspection.', 'critical')
  addInsight(198, 'Uncorrectable Sectors', 'Uncorrectable errors represent permanent data loss risks in specific sectors.', 'critical')
  addInsight(199, 'CRC Error Count', 'UltraDMA CRC errors often indicate a faulty SATA cable or connection issues.', 'warning')
  addInsight(10, 'Spin Retry Count', 'Failed spin-up attempts indicate mechanical wear in the motor or bearings.', 'critical')

  // Risk Level Determination
  let risk: RiskLevel = 'LOW'
  
  if (score < 50 || insights.some(i => i.severity === 'critical')) {
    risk = 'CRITICAL'
  } else if (score < 75 || insights.some(i => i.severity === 'warning')) {
    risk = 'HIGH'
  } else if (score < 90 || (temperature && temperature > 55)) {
    risk = 'MEDIUM'
  }

  return { risk, insights }
}
