import { spawn } from 'child_process'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChkdskResult {
  driveLetter: string
  clean: boolean           // true = no issues found
  badSectors: number       // KB of bad sectors (from chkdsk output)
  errors: number           // count of error lines
  rawLines: string[]       // all output lines (capped at 300)
  cancelled: boolean
  exitCode: number | null
  error?: string
}

// ── Parser ───────────────────────────────────────────────────────────────────

function parseChkdskOutput(lines: string[]): Pick<ChkdskResult, 'badSectors' | 'errors' | 'clean'> {
  let badSectors = 0
  let errors = 0
  let clean = false

  for (const line of lines) {
    const lower = line.toLowerCase()

    // "0 KB in bad sectors" or "4096 KB in bad sectors"
    const badSectorMatch = line.match(/(\d[\d,]*)\s+KB in bad sectors/i)
    if (badSectorMatch) {
      const kb = parseInt(badSectorMatch[1].replace(/,/g, ''), 10)
      badSectors = Math.max(badSectors, kb)
    }

    if (lower.includes('no problems found') || lower.includes('no further action is required')) {
      clean = true
    }

    if (
      lower.includes('corrupt') ||
      lower.includes('unrecoverable') ||
      lower.includes('invalid') ||
      lower.includes('cannot open')
    ) {
      errors++
    }
  }

  // If no bad sectors and no explicit errors → treat as clean
  if (badSectors === 0 && errors === 0) clean = true

  return { badSectors, errors, clean }
}

// ── One-shot chkdsk /scan ─────────────────────────────────────────────────────

/**
 * Runs `chkdsk <letter>: /scan` and returns a structured result.
 * Streams progress/output events back to the renderer via `progressCallback`
 * and `outputCallback` so the UI can show a live log.
 *
 * @param driveLetter   "C:" or "C" — we normalise internally
 * @param onOutput      Called for each output line
 * @param onProgress    Called with 0-100 progress
 * @param signal        AbortSignal to cancel the scan
 */
export async function runChkdskScan(
  driveLetter: string,
  onOutput?: (line: string) => void,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<ChkdskResult> {
  const letter = driveLetter.replace(':', '').toUpperCase()
  const driveArg = `${letter}:`

  return new Promise<ChkdskResult>((resolve) => {
    const rawLines: string[] = []
    let cancelled = false

    const child = spawn('chkdsk', [driveArg, '/scan'], {
      windowsHide: true
    })

    const pushLine = (line: string) => {
      rawLines.push(line)
      if (rawLines.length > 300) rawLines.shift() // cap memory
      onOutput?.(line)
    }

    // Handle cancellation
    const abort = () => {
      cancelled = true
      try { child.kill() } catch { /* ignore */ }
    }
    signal?.addEventListener('abort', abort)

    let buffer = ''
    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.replace(/\r/g, '').trim()
        if (!line) continue
        pushLine(line)

        const pctMatch = line.match(/(\d+)\s*percent\s*complete/i)
        if (pctMatch) {
          onProgress?.(parseInt(pctMatch[1]))
        }
      }
    })

    child.stderr.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n')
      for (const raw of lines) {
        const line = raw.replace(/\r/g, '').trim()
        if (line) pushLine(`[ERR] ${line}`)
      }
    })

    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort)

      if (buffer.trim()) pushLine(buffer.trim())

      const { badSectors, errors, clean } = parseChkdskOutput(rawLines)

      resolve({
        driveLetter: driveArg,
        clean,
        badSectors,
        errors,
        rawLines,
        cancelled,
        exitCode: code,
        error: cancelled ? 'Scan cancelled by user' : undefined
      })
    })

    child.on('error', (err) => {
      signal?.removeEventListener('abort', abort)
      resolve({
        driveLetter: driveArg,
        clean: false,
        badSectors: 0,
        errors: 0,
        rawLines,
        cancelled: false,
        exitCode: null,
        error: err.message
      })
    })
  })
}
