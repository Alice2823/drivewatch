import { PowerShellHost } from '../psHost'

// ── Types ────────────────────────────────────────────────────────────────────

export interface QuickHealthResult {
  diskIndex: number
  instanceName: string
  predictFailure: boolean
  reason: string
}

// ── WMI Failure Predict Status ───────────────────────────────────────────────

/**
 * Uses MSStorageDriver_FailurePredictStatus WMI class to check if any drive
 * is reporting an imminent failure. This is the fastest possible check and
 * works without smartctl.
 */
export async function runQuickHealthCheck(): Promise<QuickHealthResult[]> {
  const psHost = PowerShellHost.getInstance()

  const script = `
try {
  $results = @()
  $statuses = Get-WmiObject -Namespace root\\wmi -Class MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue
  if ($statuses) {
    foreach ($s in @($statuses)) {
      $idx = -1
      if ($s.InstanceName -match 'Disk(\\d+)') { $idx = [int]$Matches[1] }
      elseif ($s.InstanceName -match '_(\\d+)$') { $idx = [int]$Matches[1] }

      $results += [PSCustomObject]@{
        DiskIndex     = $idx
        InstanceName  = $s.InstanceName
        PredictFailure = [bool]$s.PredictFailure
        Reason        = if ($s.PredictFailure) { 'Drive reporting imminent failure via WMI' } else { 'No failure predicted' }
      }
    }
  }
  if ($results.Count -eq 0) {
    # Fallback: try Get-PhysicalDisk health
    $disks = Get-PhysicalDisk -ErrorAction SilentlyContinue
    if ($disks) {
      foreach ($d in @($disks)) {
        $results += [PSCustomObject]@{
          DiskIndex     = [int]$d.DeviceId
          InstanceName  = $d.FriendlyName
          PredictFailure = ($d.HealthStatus -ne 'Healthy')
          Reason        = "Health status: $($d.HealthStatus)"
        }
      }
    }
  }
  if ($results.Count -gt 0) { $results | ConvertTo-Json -Compress -Depth 2 } else { '[]' }
} catch {
  Write-Output "[]"
}
`

  try {
    const out = await psHost.execute(script, 15000)
    if (!out || out.trim() === '[]') return []

    let parsed = JSON.parse(out)
    if (!Array.isArray(parsed)) parsed = [parsed]

    return parsed.map((item: any) => ({
      diskIndex: parseInt(item.DiskIndex ?? '-1'),
      instanceName: item.InstanceName ?? 'Unknown',
      predictFailure: Boolean(item.PredictFailure),
      reason: item.Reason ?? ''
    }))
  } catch (err: any) {
    console.error('[QuickHealthCheck] Parse error:', err.message)
    return []
  }
}
