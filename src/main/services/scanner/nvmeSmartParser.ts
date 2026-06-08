/**
 * ═══════════════════════════════════════════════════════════════
 * DriveWatch — NVMe SMART Parser
 * ═══════════════════════════════════════════════════════════════
 */

export interface NvmeSmartData {
  criticalWarning: number | undefined
  temperature: number | undefined
  availableSpare: number | undefined
  percentageUsed: number | undefined
  mediaErrors: number | undefined
  dataUnitsRead: number | undefined
  dataUnitsWritten: number | undefined
  powerCycles: number | undefined
  powerOnHours: number | undefined
  unsafeShutdowns: number | undefined
}

export function parseNvmeSmart(data: any): NvmeSmartData | null {
  const nvme = data?.nvme_smart_health_information_log
  if (!nvme) return null

  const criticalWarning = nvme.critical_warning
  const mediaErrors = nvme.media_errors
  const availableSpare = nvme.available_spare
  const percentageUsed = nvme.percentage_used

  // Required diagnostic log
  console.log(`[NVME]`)
  console.log(`criticalWarning=${criticalWarning !== undefined ? criticalWarning : 'undefined'}`)
  console.log(`mediaErrors=${mediaErrors !== undefined ? mediaErrors : 'undefined'}`)
  console.log(`availableSpare=${availableSpare !== undefined ? availableSpare : 'undefined'}`)
  console.log(`percentageUsed=${percentageUsed !== undefined ? percentageUsed : 'undefined'}`)

  return {
    criticalWarning,
    temperature: nvme.temperature,
    availableSpare,
    percentageUsed,
    mediaErrors,
    dataUnitsRead: nvme.data_units_read,
    dataUnitsWritten: nvme.data_units_written,
    powerCycles: nvme.power_cycles,
    powerOnHours: nvme.power_on_hours,
    unsafeShutdowns: nvme.unsafe_shutdowns
  }
}
