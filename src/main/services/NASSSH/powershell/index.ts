import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/**
 * Executes a PowerShell command silently without terminal popups.
 */
export async function executePowerShell(psCommand: string, timeoutSec: number): Promise<string> {
  // Compress command into a single line to avoid multi-line parsing issues in cmd.exe
  const inlineCmd = psCommand.replace(/\n/g, '; ')
  
  try {
    const { stdout } = await execAsync(`powershell -WindowStyle Hidden -NoProfile -NonInteractive -Command "${inlineCmd}"`, {
      timeout: timeoutSec * 1000,
      windowsHide: true
    })
    return stdout.trim()
  } catch (err: any) {
    // smartctl and other tools often return non-zero exit codes (e.g. exit status 4 or 8) 
    // even when they successfully print the needed telemetry to stdout. 
    // We must return the stdout instead of rejecting the promise.
    if (err.stdout) {
      return err.stdout.trim()
    }
    throw err
  }
}
