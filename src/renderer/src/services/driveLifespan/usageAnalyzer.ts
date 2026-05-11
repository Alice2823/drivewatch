import { LifespanEngineInput, LifespanImpact } from './types'

export function analyzeUsage(input: LifespanEngineInput): LifespanImpact[] {
  const impacts: LifespanImpact[] = []
  const { powerOnHours, type, attributes } = input

  // Power-on Hours Impact
  if (powerOnHours && powerOnHours > 20000) {
    const years = powerOnHours / 8760
    impacts.push({
      factor: 'High Power-on Hours',
      impact: -Math.min(Math.round(years * 2), 20),
      description: `Drive has been operational for ${Math.round(years)} years.`
    })
  }

  // SSD Specific Write Activity (if available via specific attributes)
  if (type === 'SSD') {
    const totalWrites = attributes.find(a => [241, 175].includes(a.id))
    if (totalWrites && totalWrites.raw > 100000) { // arbitrary high number for TBW estimation if units were known
       impacts.push({
         factor: 'Heavy Write Activity',
         impact: -8,
         description: 'High cumulative data writes detected.'
       })
    }
  }

  // Frequent Restarts
  const startStop = attributes.find(a => a.id === 4 || a.id === 12)
  if (startStop && startStop.raw > 10000) {
    impacts.push({
      factor: 'Frequent Power Cycles',
      impact: -4,
      description: 'High number of start/stop cycles detected.'
    })
  }

  return impacts
}
