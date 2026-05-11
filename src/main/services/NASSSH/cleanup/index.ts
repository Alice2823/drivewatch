import { executePowerShell } from '../powershell'

/**
 * Ensures no orphaned or zombie ssh/powershell processes remain after 
 * execution or failure.
 */
export async function cleanupOrphanedProcesses(): Promise<void> {
  try {
    // Kill any hanging ssh.exe processes launched by this app that have timed out
    // (We look for ssh.exe processes without a window to avoid killing user terminals)
    const psCmd = `
      Get-Process ssh -ErrorAction SilentlyContinue | 
      Where-Object { $_.MainWindowHandle -eq 0 } | 
      Stop-Process -Force -ErrorAction SilentlyContinue
    `.trim()
    
    await executePowerShell(psCmd, 5)
  } catch {
    // Silent fail
  }
}
