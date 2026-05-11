import { createSecureAskpass, destroySecureAskpass } from '../askpass'
import { executePowerShell } from '../powershell'

/**
 * Executes a command over SSH securely without terminal prompts.
 * Uses SSH_ASKPASS and a temporary batch file to bypass Windows's 
 * OpenSSH limitation where stdin cannot be used for passwords.
 */
export async function executeSSH(
  host: string, 
  username: string, 
  password: string, 
  command: string, 
  port = 22, 
  timeoutSec = 15
): Promise<string> {
  const { tempDir, askpassPath } = await createSecureAskpass()
  
  try {
    const psCmd = `
      $env:DISPLAY = 'dummy:0'
      $env:SSH_ASKPASS = '${askpassPath}'
      $env:DW_SSH_PASS = '${password.replace(/'/g, "''")}'
      $env:SSH_ASKPASS_REQUIRE = 'force'
      ssh -o StrictHostKeyChecking=no -o ConnectTimeout=${timeoutSec} -o BatchMode=no -p ${port} ${username}@${host} '${command.replace(/'/g, "''")}' 2>&1
    `.trim()

    return await executePowerShell(psCmd, timeoutSec)
  } catch (err: any) {
    throw new Error(`SSH Command Execution Failed: ${err.message}`)
  } finally {
    // Crucial: always scrub credentials regardless of execution outcome
    await destroySecureAskpass(tempDir, askpassPath)
  }
}
