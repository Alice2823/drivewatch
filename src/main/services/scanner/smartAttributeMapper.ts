/**
 * ═══════════════════════════════════════════════════════════════
 * DriveWatch — SMART Attribute Mapper
 * ═══════════════════════════════════════════════════════════════
 */

import { NvmeSmartData } from './nvmeSmartParser'

export interface MappedSmartAttr {
  id: number
  name: string
  value: number
  worst: number
  thresh: number
  raw: number | string
  failed: boolean
  critical: boolean
}

export function mapNvmeToSmartAttributes(nvme: NvmeSmartData): MappedSmartAttr[] {
  const attributes: MappedSmartAttr[] = []

  const addAttr = (id: number, name: string, value: number, raw: number | string, critical = false) => {
    attributes.push({
      id,
      name,
      value,
      worst: value,
      thresh: 0,
      raw,
      failed: false,
      critical
    })
  }

  if (nvme.criticalWarning !== undefined) {
    addAttr(1, 'Critical_Warning', 100, nvme.criticalWarning, nvme.criticalWarning > 0)
  }
  if (nvme.temperature !== undefined) {
    // Temperature in Celsius
    addAttr(194, 'Temperature_Celsius', 100, nvme.temperature)
  }
  if (nvme.availableSpare !== undefined) {
    addAttr(3, 'Available_Spare_%', nvme.availableSpare, nvme.availableSpare)
  }
  if (nvme.percentageUsed !== undefined) {
    addAttr(4, 'Percentage_Used_%', 100 - nvme.percentageUsed, nvme.percentageUsed)
    // Add a standard SSD life left attribute using ID 231 to align with health scoring
    const lifeLeft = Math.max(0, 100 - nvme.percentageUsed)
    addAttr(231, 'SSD_Life_Left_%', lifeLeft, nvme.percentageUsed)
  }
  if (nvme.mediaErrors !== undefined) {
    // Map media errors to ID 5 to align with standard bad sector telemetry
    addAttr(5, 'Media_Errors', 100, nvme.mediaErrors, nvme.mediaErrors > 0)
  }
  if (nvme.dataUnitsRead !== undefined) {
    addAttr(6, 'Data_Units_Read', 100, nvme.dataUnitsRead.toString())
  }
  if (nvme.dataUnitsWritten !== undefined) {
    addAttr(7, 'Data_Units_Written', 100, nvme.dataUnitsWritten.toString())
  }
  if (nvme.powerCycles !== undefined) {
    addAttr(12, 'Power_Cycles', 100, nvme.powerCycles)
  }
  if (nvme.powerOnHours !== undefined) {
    addAttr(9, 'Power_On_Hours', 100, nvme.powerOnHours)
  }
  if (nvme.unsafeShutdowns !== undefined) {
    // Map unsafe shutdowns to ID 192 (safe) instead of ID 10 (which conflicts with Spin Retry Count)
    addAttr(192, 'Unsafe_Shutdowns', 100, nvme.unsafeShutdowns)
  }

  return attributes
}
