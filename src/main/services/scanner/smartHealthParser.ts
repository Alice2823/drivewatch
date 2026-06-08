/**
 * ═══════════════════════════════════════════════════════════════
 * DriveWatch — SMART Health Parser
 * ═══════════════════════════════════════════════════════════════
 */

export function parseSmartOverallHealth(data: any): 'PASSED' | 'FAILED' | 'Unknown' {
  if (data?.smart_status?.passed === true) {
    return 'PASSED'
  }
  if (data?.smart_status?.passed === false) {
    return 'FAILED'
  }
  return 'Unknown'
}
