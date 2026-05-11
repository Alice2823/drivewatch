export interface NASRealDiskSMART {
  diskId: string
  diskName: string
  model: string
  serial: string
  temperature: number | null
  powerOnHours: number | null
  healthPercent: number
  reallocatedSectors: number
  ssdWearLevel: number | null
  isSSD: boolean
  capacity: number
  pool: string
  errors: string[]
}

/**
 * Parses raw smartctl -a output for physical disk mapping.
 */
export function parseSMARTOutput(output: string, diskId: string, pool: string): NASRealDiskSMART | null {
  if (!output || output.includes('not found') || output.includes('No such')) return null

  const getField = (pattern: RegExp): string => {
    const m = output.match(pattern)
    return m ? m[1].trim() : ''
  }
  const getAttrVal = (id: string): number => {
    // Use [^\n]* to strictly stay on the same line. 
    // Look for the raw value which is usually the last standalone number before any trailing parenthesis like (Min/Max).
    const m = output.match(new RegExp(`\\b${id}\\b[^\n]*?\\s(\\d+)(?:\\s*\\([^)]*\\))?\\s*$`, 'mi'))
    if (m) return parseInt(m[1])
    
    // Fallback: some smartctl outputs put a '-' before the raw value
    const m2 = output.match(new RegExp(`\\b${id}\\b[^\n]*?-\\s+(\\d+)`, 'i'))
    return m2 ? parseInt(m2[1]) : 0
  }

  const model = getField(/Device Model:\s*(.+)/i) || getField(/Model Number:\s*(.+)/i) || getField(/Product:\s*(.+)/i) || getField(/Model Family:\s*(.+)/i) || diskId
  const serial = getField(/Serial Number:\s*(.+)/i) || getField(/Serial number:\s*(.+)/i) || ''
  const isSSD = /SSD|Solid/i.test(output) || /Rotation Rate:\s*Solid State/i.test(output)
  const capacityStr = getField(/User Capacity:\s*(.+?)bytes/i)
  const capacity = capacityStr ? parseInt(capacityStr.replace(/[,.\s]/g, '')) || 0 : 0

  let temperature: number | null = null
  // Match standard NVMe/SAS text, OR grab attribute 194 (Temperature_Celsius) using getAttrVal which handles (Min/Max)
  const tempMatch = output.match(/Temperature.*?(\d+)\s*(Celsius|C)/i) || output.match(/Drive Temperature:\s*(\d+)\s*C/i)
  if (tempMatch) {
    temperature = parseInt(tempMatch[1])
  } else {
    const attrTemp = getAttrVal('194') || getAttrVal('Temperature_Celsius')
    if (attrTemp > 0) temperature = attrTemp
  }

  let powerOnHours: number | null = null
  const pohMatch = output.match(/Power On Hours:\s*(\d[\d,]*)/i) || output.match(/number of hours powered up[=:]\s*(\d+)/i)
  if (pohMatch) {
    powerOnHours = parseInt(pohMatch[1].replace(/,/g, ''))
  } else {
    const attrPoh = getAttrVal('9') || getAttrVal('Power_On_Hours')
    if (attrPoh > 0) powerOnHours = attrPoh
  }

  const reallocated = getAttrVal('Reallocated_Sector_Ct') || getAttrVal('5')

  let ssdWearLevel: number | null = null
  if (isSSD) {
    const nvmeWearMatch = output.match(/Percentage Used:\s*(\d+)/i)
    if (nvmeWearMatch) {
      ssdWearLevel = parseInt(nvmeWearMatch[1])
    } else {
      let wear = getAttrVal('Wear_Leveling_Count') || getAttrVal('Media_Wearout_Indicator') || getAttrVal('177') || getAttrVal('233') || null
      // The SMART table often stores the raw erase cycle count in the last column (which can be millions). 
      // If it's > 100, we know it's not a normalized percentage. Hide it instead of showing an absurd number.
      if (wear !== null && wear > 100) wear = null
      ssdWearLevel = wear
    }
  }

  const healthPassed = /PASSED|OK/i.test(getField(/SMART overall-health.*?:\s*(.+)/i))
  const healthPercent = healthPassed ? (reallocated > 50 ? 60 : reallocated > 10 ? 75 : 95) : 40

  return {
    diskId, diskName: model, model, serial, temperature, powerOnHours,
    healthPercent, reallocatedSectors: reallocated, ssdWearLevel,
    isSSD, capacity, pool, errors: []
  }
}
