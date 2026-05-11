import { spawn, execSync } from 'child_process'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChkdskResult {
  driveLetter: string
  clean: boolean           // true = no issues found
  badSectors: number       // KB of bad sectors
  errors: number           // count of error lines
  rawLines: string[]       // all output lines
  cancelled: boolean
  exitCode: number | null
  error?: string
  needsReboot?: boolean    // true if volume is locked and requires reboot
}

export interface FsHealthStatus {
  driveLetter: string
  isDirty: boolean
  needsRepair: boolean
  offlineRepairRequired: boolean
  message: string
  severity: 'low' | 'medium' | 'high' | 'critical'
}

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Checks the filesystem health status using chkntfs and fsutil.
 */
export async function checkDriveFsHealth(driveLetter: string): Promise<FsHealthStatus> {
  const letter = driveLetter.replace(/[:\\\/]/g, '').toUpperCase()
  const drive = `${letter}:`
  
  let isDirty = false
  let needsRepair = false
  let offlineRepairRequired = false
  let message = "Filesystem is healthy."
  let severity: FsHealthStatus['severity'] = 'low'

  try {
    // 1. Check Dirty Bit
    const dirtyOut = execSync(`fsutil dirty query ${drive}`, { windowsHide: true, encoding: 'utf8' })
    if (dirtyOut.toLowerCase().includes('is dirty')) {
      isDirty = true
      message = "Volume is marked as dirty. Filesystem inconsistencies detected."
      severity = 'medium'
    }

    // 2. Check NTFS Health (chkntfs)
    const chkOut = execSync(`chkntfs ${drive}`, { windowsHide: true, encoding: 'utf8' })
    if (chkOut.toLowerCase().includes('fixed offline')) {
      offlineRepairRequired = true
      message = "Windows has found problems that must be fixed offline."
      severity = 'high'
    } else if (chkOut.toLowerCase().includes('spotfix')) {
      needsRepair = true
      message = "Filesystem issues detected. Please run chkdsk /spotfix."
      severity = 'medium'
    } else if (isDirty) {
      needsRepair = true
    }

  } catch (e: any) {
    console.error(`[FsHealth] Error checking ${drive}: ${e.message}`)
  }

  return { driveLetter: drive, isDirty, needsRepair, offlineRepairRequired, message, severity }
}

// ── Parser ───────────────────────────────────────────────────────────────────

function parseChkdskOutput(lines: string[]): Pick<ChkdskResult, 'badSectors' | 'errors' | 'clean' | 'needsReboot'> {
  let badSectors = 0
  let errors = 0
  let clean = false
  let needsReboot = false

  for (const line of lines) {
    const lower = line.toLowerCase()

    if (line.match(/(\d[\d,]*)\s+KB in bad sectors/i)) {
      const kb = parseInt(line.match(/(\d[\d,]*)\s+KB in bad sectors/i)![1].replace(/,/g, ''), 10)
      badSectors = Math.max(badSectors, kb)
    }

    if (lower.includes('no problems found') || lower.includes('no further action is required')) {
      clean = true
    }

    if (lower.includes('cannot lock current drive') || lower.includes('cannot continue in read-only mode') || lower.includes('schedule this volume to be checked') || lower.includes('must be fixed offline')) {
      needsReboot = true
    }

    if (lower.includes('corrupt') || lower.includes('unrecoverable') || lower.includes('invalid') || lower.includes('error') || lower.includes('found problems')) {
      errors++
    }
  }

  // Final check: if it needs reboot, it's not 'clean' yet
  if (needsReboot) clean = false

  return { badSectors, errors, clean, needsReboot }
}

// ── CHKDSK Actions ────────────────────────────────────────────────────────────

export type ChkdskMode = 'scan' | 'spotfix' | 'fix'

/**
 * Runs chkdsk with specified flags.
 */
export async function runChkdskAction(
  driveLetter: string,
  mode: ChkdskMode = 'scan',
  onOutput?: (line: string) => void,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<ChkdskResult> {
  const letter = driveLetter.replace(/[:\\\/]/g, '').toUpperCase()
  const driveArg = `${letter}:`
  
  const args = [driveArg]
  if (mode === 'scan') args.push('/scan')
  else if (mode === 'spotfix') args.push('/spotfix')
  else if (mode === 'fix') args.push('/f')

  return new Promise<ChkdskResult>((resolve) => {
    const rawLines: string[] = []
    let cancelled = false

    const child = spawn('chkdsk', args, { 
      windowsHide: true,
      shell: true 
    })

    const pushLine = (line: string) => {
      rawLines.push(line)
      if (rawLines.length > 500) rawLines.shift()
      onOutput?.(line)
    }

    const abort = () => {
      cancelled = true
      try { child.kill() } catch {}
    }
    signal?.addEventListener('abort', abort)

    let buffer = ''
    child.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString()
      buffer += chunk
      
      // Handle both \n and \r for progress updates
      const parts = buffer.split(/[\r\n]+/)
      buffer = parts.pop() ?? ''
      
      for (const line of parts) {
        const trimmed = line.trim()
        if (!trimmed) continue
        pushLine(trimmed)

        // Improved progress regex to catch various formats
        const pctMatch = trimmed.match(/(\d+)\s*percent\s*complete/i) || trimmed.match(/(\d+)%/i)
        if (pctMatch) {
          const pct = parseInt(pctMatch[1])
          if (!isNaN(pct)) onProgress?.(pct)
        }
      }
    })

    child.stderr.on('data', (data: Buffer) => {
      const line = data.toString().replace(/\r/g, '').trim()
      if (line) pushLine(`[SYS] ${line}`)
    })

    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (buffer.trim()) pushLine(buffer.trim())
      const parsed = parseChkdskOutput(rawLines)
      
      resolve({
        driveLetter: driveArg,
        ...parsed,
        rawLines,
        cancelled,
        exitCode: code,
        error: cancelled ? 'Process cancelled' : (code !== 0 && !parsed.clean ? `Process exited with code ${code}` : undefined)
      })
    })

    child.on('error', (err) => {
      signal?.removeEventListener('abort', abort)
      console.error(`[Chkdsk] Spawn error: ${err.message}`)
      pushLine(`[ERROR] Failed to start scanner: ${err.message}`)
      resolve({ driveLetter: driveArg, clean: false, badSectors: 0, errors: 1, rawLines, cancelled: false, exitCode: null, error: err.message })
    })
  })
}

/**
 * Schedules a chkdsk repair for the next reboot.
 */
export async function scheduleRebootRepair(driveLetter: string): Promise<{ success: boolean; message: string }> {
  const letter = driveLetter.replace(/[:\\\/]/g, '').toUpperCase()
  const drive = `${letter}:`

  return new Promise((resolve) => {
    // We run chkdsk /f which usually triggers the "Would you like to schedule..." prompt
    const child = spawn('chkdsk', [drive, '/f'], { windowsHide: true })
    let output = ''

    child.stdout.on('data', (data: Buffer) => {
      const line = data.toString()
      output += line
      if (line.includes('(Y/N)')) {
        child.stdin.write('Y\n')
      }
    })

    child.on('close', (code) => {
      if (output.includes('scheduled to be checked') || output.includes('next time the system restarts')) {
        resolve({ success: true, message: "Repair successfully scheduled for next restart." })
      } else {
        resolve({ success: false, message: `Failed to schedule: ${output.split('\n').pop() || 'Unknown error'}` })
      }
    })

    child.on('error', (err) => resolve({ success: false, message: err.message }))
  })
}
