import fs from 'fs/promises'
import path from 'path'
import os from 'os'

/**
 * Creates a highly secure, temporary batch file to act as the SSH_ASKPASS executor.
 * Required for Windows OpenSSH since it ignores piped standard input for passwords.
 */
export async function createSecureAskpass(): Promise<{ tempDir: string; askpassPath: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-ssh-askpass-'))
  const askpassPath = path.join(tempDir, 'askpass.bat')
  
  // The batch file simply echoes the DW_SSH_PASS environment variable injected by PowerShell
  await fs.writeFile(askpassPath, '@echo off\necho %DW_SSH_PASS%\n', { mode: 0o700 })
  
  return { tempDir, askpassPath }
}

/**
 * Securely deletes the temporary askpass directory and its contents from the filesystem.
 */
export async function destroySecureAskpass(tempDir: string, askpassPath: string): Promise<void> {
  try {
    await fs.unlink(askpassPath).catch(() => {})
    await fs.rmdir(tempDir).catch(() => {})
  } catch {
    // Ignore cleanup errors to prevent unhandled rejections during teardown
  }
}
