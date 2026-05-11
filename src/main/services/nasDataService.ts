import { exec } from 'child_process'
import { promisify } from 'util'
import { authenticateAndFetchNAS } from './NASSSH'

const execAsync = promisify(exec)

// ============================================
// SSH Architecture Bridge
// ============================================
// We delegate all SSH authentication, command execution, 
// AskPass creation, parsing, and SMART retrieval 
// to the isolated, modular NASSSH subsystem.
export const fetchTrueNASData = authenticateAndFetchNAS

// ============================================
// SMB-only Fallback (no SSH)
// Fetches share storage info via Windows UNC paths
// ============================================

export async function fetchSMBShareStorage(host: string, shares: string[], username?: string, password?: string): Promise<{
  volumes: Array<{ name: string; total: number; used: number; free: number }>
  error?: string
}> {
  const volumes: Array<{ name: string; total: number; used: number; free: number }> = []
  const seen = new Set<string>()

  for (const share of shares) {
    if (seen.has(share)) continue
    seen.add(share)

    try {
      const uncPath = `\\\\${host}\\${share}`
      // Build credential args for net use
      const credArgs = username ? `/user:${username} ${password || ''}` : ''

      // PowerShell: connect to UNC share, query free space via .NET, then disconnect
      const psScript = `
        $ErrorActionPreference = 'SilentlyContinue'
        $unc = '${uncPath.replace(/'/g, "''")}'
        # Ensure connection with credentials
        $null = net use $unc ${credArgs} /persistent:no 2>&1
        try {
          $di = New-Object System.IO.DirectoryInfo($unc)
          $drive = [System.IO.DriveInfo]::GetDrives() | Where-Object { $_.Name -like '*${host}*' } | Select-Object -First 1
          # Use WMI to get share space
          $free = (New-Object -ComObject Scripting.FileSystemObject).GetFolder($unc).Drive.FreeSpace
          $total = (New-Object -ComObject Scripting.FileSystemObject).GetFolder($unc).Drive.TotalSize
          if ($total -gt 0) {
            @{ Total=[long]$total; Free=[long]$free; Used=[long]($total - $free) } | ConvertTo-Json
          } else { 'null' }
        } catch { 'null' }
        finally { $null = net use $unc /delete /y 2>&1 }
      `.trim()

      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`,
        { timeout: 15000 }
      )

      const trimmed = stdout.trim()
      if (trimmed && trimmed !== 'null') {
        try {
          const data = JSON.parse(trimmed)
          if (data.Total > 0) {
            volumes.push({
              name: share,
              total: data.Total || 0,
              used: data.Used || 0,
              free: data.Free || 0
            })
          }
        } catch { /* JSON parse failure */ }
      }
    } catch { /* individual share failure is non-critical */ }
  }

  // If FSO approach failed, try alternate: map temp drive letter
  if (volumes.length === 0 && shares.length > 0) {
    const letters = 'ZYXWV'
    for (let i = 0; i < Math.min(shares.length, letters.length); i++) {
      const share = shares[i]
      const letter = letters[i]
      try {
        const credArgs = username ? `/user:${username} ${password || ''}` : ''
        await execAsync(`net use ${letter}: \\\\${host}\\${share} ${credArgs} /persistent:no 2>nul`, { timeout: 8000 })
        try {
          const { stdout } = await execAsync(
            `powershell -NoProfile -Command "try { $d = Get-PSDrive ${letter} -ErrorAction Stop; @{Total=[long]($d.Used+$d.Free);Used=[long]$d.Used;Free=[long]$d.Free} | ConvertTo-Json } catch { 'null' }"`,
            { timeout: 8000 }
          )
          if (stdout.trim() !== 'null') {
            const data = JSON.parse(stdout.trim())
            if (data.Total > 0) {
              volumes.push({ name: share, total: data.Total || 0, used: data.Used || 0, free: data.Free || 0 })
            }
          }
        } finally {
          await execAsync(`net use ${letter}: /delete /y 2>nul`, { timeout: 3000 }).catch(() => {})
        }
      } catch { /* fallback share failure */ }
    }
  }

  return { volumes }
}
