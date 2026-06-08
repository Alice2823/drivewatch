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

  // ── Real SMART Health Scoring Engine ──────────────────────────────────────
  // Weighted risk model using logarithmic severity for sector counts
  const pending = getAttrVal('Current_Pending_Sector') || getAttrVal('197')
  const uncorrectable = getAttrVal('Offline_Uncorrectable') || getAttrVal('198')
  const crcErrors = getAttrVal('UDMA_CRC_Error_Count') || getAttrVal('199')
  const seekErrors = getAttrVal('Seek_Error_Rate') || getAttrVal('7')
  const readErrors = getAttrVal('Raw_Read_Error_Rate') || getAttrVal('1')
  const programFail = getAttrVal('Program_Fail_Cnt_Total') || getAttrVal('181')
  const eraseFail = getAttrVal('Erase_Fail_Count_Total') || getAttrVal('182')
  const unsafeShutdowns = getAttrVal('Unsafe_Shutdown_Count') || getAttrVal('192')

  let healthScore = 100
  const deductions: string[] = []

  // CRITICAL: SMART overall health FAILED → force 0-10%
  if (!healthPassed) {
    healthScore = Math.min(healthScore, 8)
    deductions.push('SMART FAILED: -92')
  }

  // CRITICAL: Reallocated sectors (logarithmic severity)
  if (reallocated > 0) {
    // 1-5: minor (-5 to -15), 6-50: moderate (-20 to -40), 51-1000: severe (-50 to -70), >1000: catastrophic (-80 to -95)
    let deduction: number
    if (reallocated <= 5) deduction = reallocated * 3
    else if (reallocated <= 50) deduction = 15 + Math.log10(reallocated) * 15
    else if (reallocated <= 1000) deduction = 40 + Math.log10(reallocated) * 10
    else deduction = 60 + Math.min(35, Math.log10(reallocated) * 5)
    healthScore -= Math.round(deduction)
    deductions.push(`Reallocated(${reallocated}): -${Math.round(deduction)}`)
  }

  // CRITICAL: Pending sectors
  if (pending > 0) {
    const deduction = pending <= 5 ? pending * 5 : 25 + Math.min(40, Math.log10(pending) * 15)
    healthScore -= Math.round(deduction)
    deductions.push(`Pending(${pending}): -${Math.round(deduction)}`)
  }

  // CRITICAL: Uncorrectable sectors
  if (uncorrectable > 0) {
    const deduction = uncorrectable <= 3 ? uncorrectable * 8 : 24 + Math.min(50, Math.log10(uncorrectable) * 18)
    healthScore -= Math.round(deduction)
    deductions.push(`Uncorrectable(${uncorrectable}): -${Math.round(deduction)}`)
  }

  // HIGH: CRC errors (interface/cable issues)
  if (crcErrors > 0) {
    const deduction = Math.min(20, crcErrors <= 10 ? crcErrors * 2 : 10 + Math.log10(crcErrors) * 5)
    healthScore -= Math.round(deduction)
    deductions.push(`CRC(${crcErrors}): -${Math.round(deduction)}`)
  }

  // HIGH: SSD wear
  if (isSSD && ssdWearLevel !== null) {
    // ssdWearLevel: percentage used (0=new, 100=end of life)
    if (ssdWearLevel >= 90) { healthScore -= 40; deductions.push(`SSD Wear ${ssdWearLevel}%: -40`) }
    else if (ssdWearLevel >= 70) { healthScore -= 20; deductions.push(`SSD Wear ${ssdWearLevel}%: -20`) }
    else if (ssdWearLevel >= 50) { healthScore -= 10; deductions.push(`SSD Wear ${ssdWearLevel}%: -10`) }
  }

  // HIGH: Program/Erase failures (SSD)
  if (programFail > 0) {
    const deduction = Math.min(30, programFail * 5)
    healthScore -= deduction
    deductions.push(`ProgFail(${programFail}): -${deduction}`)
  }
  if (eraseFail > 0) {
    const deduction = Math.min(30, eraseFail * 5)
    healthScore -= deduction
    deductions.push(`EraseFail(${eraseFail}): -${deduction}`)
  }

  // MEDIUM: Temperature (persistent overheating)
  if (temperature !== null) {
    if (temperature >= 65) { healthScore -= 15; deductions.push(`Temp ${temperature}°C: -15`) }
    else if (temperature >= 55) { healthScore -= 8; deductions.push(`Temp ${temperature}°C: -8`) }
    else if (temperature >= 50) { healthScore -= 3; deductions.push(`Temp ${temperature}°C: -3`) }
  }

  // MEDIUM: Power-on hours (age)
  if (powerOnHours !== null) {
    if (powerOnHours >= 60000) { healthScore -= 10; deductions.push(`Age ${Math.round(powerOnHours/8760)}yr: -10`) }
    else if (powerOnHours >= 40000) { healthScore -= 5; deductions.push(`Age ${Math.round(powerOnHours/8760)}yr: -5`) }
    else if (powerOnHours >= 25000) { healthScore -= 2; deductions.push(`Age ${Math.round(powerOnHours/8760)}yr: -2`) }
  }

  // LOW: Unsafe shutdowns (NVMe/SSD)
  if (unsafeShutdowns > 100) {
    const deduction = Math.min(10, Math.floor(unsafeShutdowns / 100))
    healthScore -= deduction
    deductions.push(`UnsafeShutdowns(${unsafeShutdowns}): -${deduction}`)
  }

  // Clamp to 0-100
  const healthPercent = Math.max(0, Math.min(100, healthScore))

  console.log(`[SMART Health] ${model}: ${healthPercent}% [${deductions.join(', ')}]`)

  return {
    diskId, diskName: model, model, serial, temperature, powerOnHours,
    healthPercent, reallocatedSectors: reallocated, ssdWearLevel,
    isSSD, capacity, pool, errors: deductions
  }
}
