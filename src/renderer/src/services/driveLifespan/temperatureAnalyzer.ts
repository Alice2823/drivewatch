import { ThermalStatus } from './types'

export function analyzeTemperature(temp: number | null): ThermalStatus {
  const currentTemp = temp || 30 // Fallback to safe default if null

  if (currentTemp < 45) {
    return {
      zone: 'Excellent',
      temperature: currentTemp,
      recommendation: 'Optimal operating temperature. No action required.',
      lifespanImpact: 0
    }
  } else if (currentTemp < 55) {
    return {
      zone: 'Warm',
      temperature: currentTemp,
      recommendation: 'Temperature is within safe limits, but slightly elevated. Ensure proper airflow.',
      lifespanImpact: -5
    }
  } else if (currentTemp < 65) {
    return {
      zone: 'Hot',
      temperature: currentTemp,
      recommendation: 'High operating temperature detected. Improved cooling is strongly recommended.',
      lifespanImpact: -15
    }
  } else {
    return {
      zone: 'Critical',
      temperature: currentTemp,
      recommendation: 'Critical thermal levels! Immediate cooling or shutdown required to prevent data loss.',
      lifespanImpact: -30
    }
  }
}
