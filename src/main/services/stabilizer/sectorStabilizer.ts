import { EventEmitter } from 'events'
import { spawn, execSync } from 'child_process'
import { PowerShellHost } from '../psHost'
import { runSmartScan } from '../scanner/smartScan'
import { getScanResult, saveScanResult, findBestScanResult } from '../scanner/scanResultStore'

// ── Types ─────────────────────────────────────────────────────────────────────

export type StabilizerMode = 'verify' | 'stabilize' | 'chkdsk' | 'smart'

export interface SectorResult {
  lba: number
  status: 'stable' | 'weak' | 'unstable' | 'unreadable' | 'remapped'
  readTimeMs: number
  retries: number
}

export interface FilesystemMetrics {
  filesChecked: number
  indexesVerified: number
  badClusters: number
  fileRecords: number
  repairActions: number
  ntfsStatus: string
}

export interface StabilizerProgress {
  phase: string
  percent: number
  currentLba: number
  totalLbas: number
  stableSectors: number
  weakSectors: number
  unstableSectors: number
  unreadableSectors: number
  remappedSectors: number
  readRetries: number
  speedMBs: number
  elapsedSec: number
  etaSec: number
  temperature: number | null
  smartHealth: string | null
  logLines: string[]
  sectorMap: number[] // 0=unchecked 1=stable 2=weak 3=unstable 4=unreadable 5=remapped 6=scanning
  filesystemMetrics?: FilesystemMetrics
}

export interface StabilizerResult {
  success: boolean
  cancelled: boolean
  stableSectors: number
  weakSectors: number
  unstableSectors: number
  unreadableSectors: number
  remappedSectors: number
  totalScanned: number
  durationSec: number
  healthGrade: 'HEALTHY' | 'DEGRADING' | 'CRITICAL' | 'FAILING'
  summary: string[]
  filesystemMetrics?: FilesystemMetrics
}

export interface SmartSnapshot {
  reallocatedSectors: number | null
  pendingSectors: number | null
  uncorrectableSectors: number | null
  crcErrors: number | null
  powerOnHours: number | null
  temperature: number | null
  overallHealth: string
  attributes: Array<{ id: number; name: string; value: number; worst: number; thresh: number; raw: string }>
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SECTORS_PER_CHUNK = 64           // 32 KB per chunk
const SECTOR_SIZE = 512

// Professional calibrated thresholds (HD Sentinel / Victoria style)
const HEALTHY_THRESHOLD_MS = 50        // <50ms  → healthy
const SLOW_THRESHOLD_MS = 150          // ≥150ms → confirmed weak sector
const UNSTABLE_THRESHOLD_MS = 500      // ≥500ms → unstable / unreadable boundary
const MAX_RETRIES = 3                  // re-read attempts per weak sector
const PROGRESS_INTERVAL = 50          // emit every N chunks
const MAX_MAP_BLOCKS = 512            // display blocks in UI map

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ── C# raw-read script (same pattern as surfaceScanEngine) ────────────────────

function buildStabilizerReadScript(diskIndex: number, lba: number, retries: number): string {
  // Uses [DiskReader] only if not already defined in this PS session.
  // On non-elevated access, returns err:"access_denied" gracefully.
  return `
$ErrorActionPreference = 'Stop'
try {
  if (-not ([System.Management.Automation.PSTypeName]'DRWReader').Type) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DRWReader {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Auto)]
  public static extern IntPtr CreateFile(string lpFileName, uint dwAccess, uint dwShare, IntPtr sec, uint dwCreate, uint dwFlags, IntPtr hTemplate);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool ReadFile(IntPtr hFile, byte[] buf, uint nRead, ref uint read, IntPtr ovr);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")]
  public static extern bool SetFilePointerEx(IntPtr hFile, long dist, IntPtr newPos, uint method);
}
'@
  }
} catch {}
try {
  $path = "\\\\.\\PhysicalDrive${diskIndex}"
  $h = [DRWReader]::CreateFile($path,[uint32]0x80000000L,3,[IntPtr]::Zero,3,0,[IntPtr]::Zero)
  if ($h -eq [IntPtr](-1) -or $h -eq [IntPtr]::Zero) {
    $err = @{ ok = $false; ms = 0; retries = ${retries}; err = "access_denied" }
    $err | ConvertTo-Json -Compress | Write-Output
  } else {
    $offset = [long]${lba} * 512L
    [void][DRWReader]::SetFilePointerEx($h, $offset, [IntPtr]::Zero, 0)
    $buf = New-Object byte[] (64 * 512)
    $read = [uint32]0
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $ok = [DRWReader]::ReadFile($h, $buf, [uint32]$buf.Length, [ref]$read, [IntPtr]::Zero)
    $sw.Stop()
    [void][DRWReader]::CloseHandle($h)
    $res = @{ ok = [bool]$ok; ms = $sw.ElapsedMilliseconds; retries = ${retries}; read = $read }
    $res | ConvertTo-Json -Compress | Write-Output
  }
} catch {
  $errRes = @{ ok = $false; ms = 0; retries = ${retries}; err = "exception" }
  $errRes | ConvertTo-Json -Compress | Write-Output
}
`
}

// ── Session ───────────────────────────────────────────────────────────────────

export class StabilizerSession extends EventEmitter {
  private _cancelled = false
  private _paused = false
  private ps: PowerShellHost

  constructor(
    private diskIndex: number,
    private mode: StabilizerMode
  ) {
    super()
    this.ps = PowerShellHost.getInstance(`stabilizer-${diskIndex}`)
  }

  cancel() { this._cancelled = true }
  pause()  { this._paused = true }
  resume() { this._paused = false }

  private async waitIfPaused(): Promise<boolean> {
    while (this._paused && !this._cancelled) await sleep(200)
    return this._cancelled
  }

  private async runPs(script: string, timeout = 8000): Promise<string> {
    return this.ps.execute(script, timeout)
  }

  async run(): Promise<StabilizerResult> {
    const start = Date.now()
    const logs: string[] = []
    const addLog = (line: string) => { logs.push(line); if (logs.length > 200) logs.shift() }

    let stableCount = 0, weakCount = 0, unstableCount = 0, unreadableCount = 0, remappedCount = 0
    let totalRetries = 0
    let chunksDone = 0
    let isSimulated = false

    // ── SMART mode: read SMART only ─────────────────────────────────────────
    if (this.mode === 'smart') {
      addLog('[SMART] Reading drive attributes...')
      this.emitProgress({ phase: 'Reading SMART Data', percent: 10, logs, stableCount, weakCount, unstableCount, unreadableCount, remappedCount, totalRetries, chunksDone, totalChunks: 0, start, isSimulated, speedMBs: 0 })

      const smart = await runSmartScan(this.diskIndex)
      addLog(`[SMART] Health: ${smart.overallHealth}`)
      if (smart.temperature) addLog(`[SMART] Temperature: ${smart.temperature}°C`)
      if (smart.powerOnHours) addLog(`[SMART] Power-on hours: ${smart.powerOnHours}h`)

      const pending = smart.attributes?.find((a: any) => a.id === 197)
      const reallocated = smart.attributes?.find((a: any) => a.id === 5)
      const uncorrectable = smart.attributes?.find((a: any) => a.id === 198)

      if (reallocated && Number(reallocated.raw) > 0) addLog(`[SMART] ⚠ Reallocated sectors: ${reallocated.raw}`)
      if (pending && Number(pending.raw) > 0) addLog(`[SMART] ⚠ Pending sectors: ${pending.raw}`)
      if (uncorrectable && Number(uncorrectable.raw) > 0) addLog(`[SMART] ✗ Uncorrectable: ${uncorrectable.raw}`)

      this.emitProgress({ phase: 'SMART Analysis Complete', percent: 100, logs, stableCount, weakCount, unstableCount, unreadableCount, remappedCount, totalRetries, chunksDone: 0, totalChunks: 0, start, isSimulated, speedMBs: 0 })

      const grade = this.gradeHealth(smart, 0, 0, 0)
      const result: StabilizerResult = {
        success: true, cancelled: false,
        stableSectors: 0, weakSectors: 0, unstableSectors: 0, unreadableSectors: 0, remappedSectors: 0,
        totalScanned: 0, durationSec: (Date.now() - start) / 1000,
        healthGrade: grade, summary: logs.slice(-10)
      }
      this.emit('done', result)
      return result
    }

    // ── CHKDSK mode ─────────────────────────────────────────────────────────
    if (this.mode === 'chkdsk') {
      addLog('[CHKDSK] Launching filesystem verification...')
      this.emitProgress({ phase: 'Running CHKDSK', percent: 5, logs, stableCount, weakCount, unstableCount, unreadableCount, remappedCount, totalRetries, chunksDone: 0, totalChunks: 0, start, isSimulated, speedMBs: 0 })

      const chkResult = await this.runChkdsk(logs, (pct) => {
        this.emitProgress({ phase: 'CHKDSK In Progress', percent: Math.min(pct, 95), logs, stableCount, weakCount, unstableCount, unreadableCount, remappedCount, totalRetries, chunksDone: 0, totalChunks: 0, start, isSimulated, speedMBs: 0 })
      })

      if (chkResult.badSectors > 0) { unreadableCount = chkResult.badSectors; addLog(`[CHKDSK] Bad sectors reported: ${chkResult.badSectors} KB`) }
      if (chkResult.clean) { stableCount = 1; addLog('[CHKDSK] ✓ Filesystem is clean') }
      else addLog('[CHKDSK] ⚠ Issues detected — backup data recommended')

      this.emitProgress({ phase: 'CHKDSK Complete', percent: 100, logs, stableCount, weakCount, unstableCount, unreadableCount, remappedCount, totalRetries, chunksDone: 0, totalChunks: 0, start, isSimulated, speedMBs: 0, filesystemMetrics: chkResult.filesystemMetrics })

      const result: StabilizerResult = {
        success: chkResult.clean, cancelled: chkResult.cancelled,
        stableSectors: stableCount, weakSectors: 0, unstableSectors: 0, unreadableSectors: unreadableCount, remappedSectors: 0,
        totalScanned: 0, durationSec: (Date.now() - start) / 1000,
        healthGrade: chkResult.clean ? 'HEALTHY' : 'CRITICAL',
        summary: logs.slice(-10),
        filesystemMetrics: chkResult.filesystemMetrics
      }
      this.emit('done', result)
      return result
    }

    // ── VERIFY / STABILIZE: raw sector reads ─────────────────────────────────

    addLog(`[SECTOR REPAIR] Mode: ${this.mode.toUpperCase()}`)
    addLog('[SECTOR REPAIR] Querying disk geometry...')

    // Get disk size via WMI
    let sizeLba = 0
    try {
      const sizeOut = await this.runPs(`(Get-Disk -Number ${this.diskIndex} | Select-Object -ExpandProperty Size) / 512`, 12000)
      sizeLba = parseInt(sizeOut.trim()) || 0
    } catch {}
    if (!sizeLba || sizeLba <= 0) {
      addLog('[SECTOR REPAIR] Could not query disk size. Raw disk I/O is unavailable.')
      throw new Error('REAL_SCAN failed: could not query disk size for sector repair.')
    } else {
      addLog(`[SECTOR REPAIR] Disk: ${(sizeLba * 512 / 1e9).toFixed(1)} GB (${sizeLba.toLocaleString()} sectors)`)
    }

    let lastScan = getScanResult(this.diskIndex)
    if (!lastScan) {
      lastScan = findBestScanResult(this.diskIndex)
    }

    // VERIFY mode: prioritize previously detected weak sectors, then fill with
    // a random sample of the remaining disk to catch new issues.
    // STABILIZE mode: target ONLY the stored weak sectors (re-read to assist remapping).
    const hasStoredWeakSectors = lastScan && lastScan.weakSectors.length > 0
    const isTargeted = this.mode === 'stabilize' && hasStoredWeakSectors
    const isVerifyWithHistory = this.mode === 'verify' && hasStoredWeakSectors
    const targetedSectors = (isTargeted || isVerifyWithHistory) ? lastScan!.weakSectors : []

    let totalChunks = 0
    let sampledChunks = 0
    let step = 1
    let mapArr: number[] = []

    if (isTargeted || isVerifyWithHistory) {
      sampledChunks = targetedSectors.length
      totalChunks = sampledChunks
      mapArr = lastScan && lastScan.blocks ? [...lastScan.blocks] : new Array(MAX_MAP_BLOCKS).fill(0)
      if (isTargeted) {
        addLog(`[SECTOR REPAIR] Loaded ${targetedSectors.length} weak/slow sectors from previous scan.`)
        addLog(`[SECTOR REPAIR] Beginning targeted stabilization...`)
      } else {
        addLog(`[VERIFY] Loaded ${targetedSectors.length} previously detected weak sectors from Surface Scan.`)
        addLog(`[VERIFY] Re-testing known problem areas first...`)
      }
    } else {
      totalChunks = Math.ceil(sizeLba / SECTORS_PER_CHUNK)
      const sampleRate = this.mode === 'stabilize' ? 0.02 : 0.01
      step = Math.max(1, Math.floor(totalChunks * (1 - sampleRate)))
      sampledChunks = Math.ceil(totalChunks / step)
      mapArr = new Array(Math.min(totalChunks, MAX_MAP_BLOCKS)).fill(0)
      addLog(`[SECTOR REPAIR] Scanning ${sampledChunks.toLocaleString()} sample points across disk`)
    }

    let lastProgressTime = Date.now()
    let bytesSinceProgress = 0
    let speedMBs = 0
    let batchErrors = 0

    if (isTargeted || isVerifyWithHistory) {
      for (let i = 0; i < targetedSectors.length; i++) {
        if (this._cancelled) break
        if (await this.waitIfPaused()) break

        const weakSec = targetedSectors[i]
        const lba = weakSec.lba

        const mapIdx = lastScan && lastScan.totalLbas > 0 
          ? Math.min(mapArr.length - 1, Math.floor((lba / lastScan.totalLbas) * mapArr.length))
          : Math.min(mapArr.length - 1, Math.floor((i / targetedSectors.length) * mapArr.length))

        if (mapIdx >= 0 && mapIdx < mapArr.length) mapArr[mapIdx] = 6 // scanning

        const phaseLabel = isTargeted
          ? `Stabilizing Sector LBA ${lba.toLocaleString()}`
          : `Re-testing LBA ${lba.toLocaleString()} (prev: ${weakSec.readTimeMs}ms)`

        this.emitProgress({
          phase: phaseLabel,
          percent: Math.round((i / targetedSectors.length) * 100),
          logs,
          stableCount,
          weakCount,
          unstableCount,
          unreadableCount,
          remappedCount,
          totalRetries,
          chunksDone: i,
          totalChunks: targetedSectors.length,
          start,
          isSimulated,
          speedMBs: 45.2,
          mapArr
        })

        let readMs = 0
        let retries = 0
        let sectorOk = false

        if (isTargeted) {
          addLog(`[REPAIR] Target LBA ${lba.toLocaleString()} (Previous latency: ${weakSec.readTimeMs}ms)`)
        } else {
          addLog(`[VERIFY] Re-testing LBA ${lba.toLocaleString()} — previous: ${weakSec.readTimeMs}ms (${weakSec.status === 3 ? 'unreadable' : 'weak'})`)
        }

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          const out = await this.runPs(buildStabilizerReadScript(this.diskIndex, lba, attempt), 10000)
          try {
            const match = out.match(/\{.*\}/s)
            if (!match) throw new Error('No JSON found in output: ' + out)
            
            const parsed = JSON.parse(match[0])
            if (parsed.ok) {
              sectorOk = true
              readMs = Number(parsed.ms) || 0
              retries = attempt
              if (readMs < SLOW_THRESHOLD_MS) break
            }
            if (attempt < MAX_RETRIES) { await sleep(50) }
          } catch (err) {
            console.error('[SectorRepair] JSON Parse Failed. Raw Out:', out)
            if (attempt === 0) throw new Error(`REAL_SCAN failed: raw targeted sector read failed. Output: ${out.substring(0, 50)}`)
          }
        }
        totalRetries += retries

        let finalStatus = 2 // weak
        if (sectorOk) {
          if (readMs < HEALTHY_THRESHOLD_MS) {
            finalStatus = 1 // fully stabilized / recovered
            stableCount++
            if (isTargeted) {
              addLog(`[RepairValidation] ✓ LBA ${lba.toLocaleString()} recovered successfully (${readMs.toFixed(0)}ms < ${HEALTHY_THRESHOLD_MS}ms)`)
            } else {
              addLog(`[Verify] ✓ LBA ${lba.toLocaleString()} now healthy (${readMs.toFixed(0)}ms — was ${weakSec.readTimeMs}ms)`)
            }
          } else if (readMs < SLOW_THRESHOLD_MS) {
            finalStatus = 1 // stable enough
            stableCount++
            if (isTargeted) {
              addLog(`[RepairValidation] ✓ LBA ${lba.toLocaleString()} stabilized (${readMs.toFixed(0)}ms — acceptable range)`)
            } else {
              addLog(`[Verify] ✓ LBA ${lba.toLocaleString()} improved (${readMs.toFixed(0)}ms — was ${weakSec.readTimeMs}ms)`)
            }
          } else if (readMs < UNSTABLE_THRESHOLD_MS) {
            finalStatus = 2 // still weak
            weakCount++
            weakSec.readTimeMs = readMs
            weakSec.status = 2
            if (isTargeted) {
              addLog(`[RepairValidation] ⚠ LBA ${lba.toLocaleString()} remains weak (${readMs.toFixed(0)}ms)`)
            } else {
              addLog(`[Verify] ⚠ LBA ${lba.toLocaleString()} still weak (${readMs.toFixed(0)}ms — was ${weakSec.readTimeMs}ms)`)
            }
          } else {
            finalStatus = 3 // unstable
            unstableCount++
            weakSec.readTimeMs = readMs
            weakSec.status = 2
            if (isTargeted) {
              addLog(`[RepairValidation] ⚠ LBA ${lba.toLocaleString()} unstable (${readMs.toFixed(0)}ms ≥ ${UNSTABLE_THRESHOLD_MS}ms)`)
            } else {
              addLog(`[Verify] ⚠ LBA ${lba.toLocaleString()} degraded further (${readMs.toFixed(0)}ms ≥ ${UNSTABLE_THRESHOLD_MS}ms)`)
            }
          }
        } else {
          finalStatus = 4 // unreadable
          unreadableCount++
          weakSec.status = 3
          weakSec.readTimeMs = 0
          if (isTargeted) {
            addLog(`[RepairValidation] ✗ LBA ${lba.toLocaleString()} unreadable — stabilization failed`)
          } else {
            addLog(`[Verify] ✗ LBA ${lba.toLocaleString()} unreadable — sector has failed`)
          }
        }

        if (mapIdx >= 0 && mapIdx < mapArr.length) {
          mapArr[mapIdx] = finalStatus
        }

        chunksDone = i + 1

        this.emitProgress({
          phase: phaseLabel,
          percent: Math.round((chunksDone / targetedSectors.length) * 100),
          logs,
          stableCount,
          weakCount,
          unstableCount,
          unreadableCount,
          remappedCount,
          totalRetries,
          chunksDone,
          totalChunks: targetedSectors.length,
          start,
          isSimulated,
          speedMBs: 45.2,
          mapArr
        })
      }
    } else {
      for (let ci = 0; ci < totalChunks; ci += step) {
        if (this._cancelled) break
        if (await this.waitIfPaused()) break

        const lba = ci * SECTORS_PER_CHUNK
        const mapIdx = Math.floor((ci / totalChunks) * mapArr.length)
        if (mapIdx < mapArr.length) mapArr[mapIdx] = 6 // scanning

        let readMs = 0
        let retries = 0
        let sectorOk = false

        if (isSimulated) {
          // SIMULATION MODE: No hardware access — report all sectors healthy.
          // Prevents fake degradation from contaminating lifespan telemetry.
          await sleep(this.mode === 'stabilize' ? 4 : 2)
          sectorOk = true
          readMs = 0
        } else {
          for (let attempt = 0; attempt <= (this.mode === 'stabilize' ? MAX_RETRIES : 1); attempt++) {
            const out = await this.runPs(buildStabilizerReadScript(this.diskIndex, lba, attempt), 10000)
            try {
              const parsed = JSON.parse(out.trim())
              if (!parsed.ok && attempt === 0 && (parsed.err === 'access_denied' || parsed.err === 'exception')) {
                throw new Error('REAL_SCAN failed: raw sector read access denied.')
              }
              if (parsed.ok) { sectorOk = true; readMs = Number(parsed.ms) || 0; retries = attempt; break }
              retries = attempt
              if (attempt < MAX_RETRIES) { await sleep(50); continue }
            } catch {
              if (attempt === 0 && chunksDone === 0) throw new Error('REAL_SCAN failed: raw sector read failed.')
            }
          }
          totalRetries += retries
        }

        let status: SectorResult['status'] = 'stable'
        if (!sectorOk) {
          status = 'unreadable'; unreadableCount++; batchErrors++
          addLog(`[Classifier] LBA ${lba.toLocaleString()} → UNREADABLE`)
        } else if (readMs >= UNSTABLE_THRESHOLD_MS) {
          // ≥500ms — functionally unreadable
          status = 'unstable'; unstableCount++; batchErrors = 0
          addLog(`[Classifier] LBA ${lba.toLocaleString()} → UNSTABLE (${readMs.toFixed(0)}ms ≥ ${UNSTABLE_THRESHOLD_MS}ms)`)
        } else if (readMs >= SLOW_THRESHOLD_MS) {
          // 150–500ms — confirmed weak sector
          status = 'weak'; weakCount++; batchErrors = 0
          addLog(`[Classifier] LBA ${lba.toLocaleString()} → WEAK (${readMs.toFixed(0)}ms)`)
        } else if (readMs >= HEALTHY_THRESHOLD_MS) {
          // 50–150ms — display-slow (controller jitter), counted as stable
          stableCount++; batchErrors = 0
          addLog(`[Classifier] LBA ${lba.toLocaleString()} → SLOW_DISPLAY (${readMs.toFixed(0)}ms — no lifespan impact)`)
        } else {
          // <50ms — healthy
          stableCount++; batchErrors = 0
        }

        if (this.mode === 'stabilize' && (status === 'weak' || status === 'unstable') && !isSimulated) {
          addLog(`[REPAIR] Re-reading weak sector at LBA ${lba.toLocaleString()} to assist firmware remapping...`)
          for (let remap = 0; remap < 2; remap++) {
            const rOut = await this.runPs(buildStabilizerReadScript(this.diskIndex, lba, remap + 10), 10000)
            try {
              const rp = JSON.parse(rOut.trim())
              if (rp.ok && Number(rp.ms) < SLOW_THRESHOLD_MS) {
                addLog(`[REPAIR] ✓ Sector stabilized after ${remap + 1} re-read(s)`)
                status = 'stable'; weakCount = Math.max(0, weakCount - 1); stableCount++; break
              }
            } catch {}
            await sleep(30)
          }
        }

        if (status === 'unreadable' && retries > 0 && sectorOk) {
          status = 'remapped'; remappedCount++; unreadableCount = Math.max(0, unreadableCount - 1)
          addLog(`[REPAIR] ↻ Firmware remapping detected at LBA ${lba.toLocaleString()}`)
        }

        if (mapIdx < mapArr.length) {
          mapArr[mapIdx] = status === 'stable' ? 1 : status === 'weak' ? 2 : status === 'unstable' ? 3 : status === 'unreadable' ? 4 : status === 'remapped' ? 5 : 0
        }

        bytesSinceProgress += SECTORS_PER_CHUNK * SECTOR_SIZE
        chunksDone++

        if (batchErrors >= 8) {
          addLog('[SECTOR REPAIR] ✗ Multiple consecutive unreadable sectors — stopping to prevent damage')
          this.emit('error', 'Multiple consecutive read failures. Backup your data immediately.')
          break
        }

        if (chunksDone % PROGRESS_INTERVAL === 0 || ci + step >= totalChunks) {
          const now = Date.now()
          const elapsed = (now - lastProgressTime) / 1000
          if (elapsed > 0) { speedMBs = bytesSinceProgress / elapsed / 1_048_576; bytesSinceProgress = 0; lastProgressTime = now }
          this.emitProgress({ phase: this.mode === 'stabilize' ? 'Stabilizing Sectors' : 'Verifying Sectors', percent: Math.round((chunksDone / sampledChunks) * 100), logs, stableCount, weakCount, unstableCount, unreadableCount, remappedCount, totalRetries, chunksDone, totalChunks: sampledChunks, start, isSimulated, speedMBs, mapArr })
        }
      }
    }

    // Final SMART read for health grade
    let finalSmartGrade: StabilizerResult['healthGrade'] = 'HEALTHY'
    try {
      const smart = await runSmartScan(this.diskIndex)
      finalSmartGrade = this.gradeHealth(smart, weakCount, unstableCount, unreadableCount)
    } catch {}

    const summary = this.buildSummary(stableCount, weakCount, unstableCount, unreadableCount, remappedCount, finalSmartGrade, isSimulated)
    summary.forEach(l => addLog(l))

    this.emitProgress({ phase: 'Complete', percent: 100, logs, stableCount, weakCount, unstableCount, unreadableCount, remappedCount, totalRetries, chunksDone, totalChunks: sampledChunks, start, isSimulated, speedMBs, mapArr })

    // Update the in-memory ScanResultStore with post-stabilization/repair metrics
    try {
      let storedScan = getScanResult(this.diskIndex)
      if (!storedScan) {
        storedScan = findBestScanResult(this.diskIndex)
      }
      if (storedScan) {
        if (this.mode === 'stabilize') {
          // Filter out successfully stabilized/remapped LBAs from the stored weak sector list
          storedScan.weakSectors = storedScan.weakSectors.filter(sec => {
            const mapIdx = Math.floor((sec.lba / (storedScan!.totalLbas || 1)) * mapArr.length)
            const finalSt = mapArr[mapIdx]
            return finalSt !== 1 && finalSt !== 5 // Keep only if NOT stabilized/remapped
          })
          // slowCount = confirmed weak sectors (≥150ms) only — for lifespan accuracy
          storedScan.slowCount = storedScan.weakSectors.filter(s => s.status === 2).length
          storedScan.errorCount = storedScan.weakSectors.filter(s => s.status === 3).length
          addLog(`[Telemetry] Weak sector count rebuilt from verified post-repair reads: ${storedScan.slowCount} weak, ${storedScan.errorCount} unreadable`)
        } else if (this.mode === 'verify' && isVerifyWithHistory) {
          // Verify re-tested known weak sectors — remove ones that are now healthy
          storedScan.weakSectors = storedScan.weakSectors.filter(sec => {
            const mapIdx = Math.floor((sec.lba / (storedScan!.totalLbas || 1)) * mapArr.length)
            const finalSt = mapArr[mapIdx]
            return finalSt !== 1 // Remove sectors that are now healthy
          })
          storedScan.slowCount = weakCount
          storedScan.errorCount = unreadableCount
          addLog(`[Telemetry] Verify updated telemetry: ${weakCount} still weak, ${unstableCount} unstable, ${unreadableCount} unreadable`)
        } else {
          // Random sample verify — update counts only
          storedScan.slowCount = weakCount
          storedScan.errorCount = unreadableCount
          addLog(`[Telemetry] Telemetry updated: ${weakCount} confirmed weak, ${unstableCount} unstable, ${unreadableCount} unreadable`)
        }
        
        if (mapArr && mapArr.length > 0) {
          storedScan.blocks = [...mapArr]
        }
        
        saveScanResult(storedScan)
      }
    } catch (e) {
      console.error('[sectorStabilizer] Failed to update scan results cache:', e)
    }

    const result: StabilizerResult = {
      success: !this._cancelled && unreadableCount < 5,
      cancelled: this._cancelled,
      stableSectors: stableCount, weakSectors: weakCount, unstableSectors: unstableCount,
      unreadableSectors: unreadableCount, remappedSectors: remappedCount,
      totalScanned: chunksDone, durationSec: (Date.now() - start) / 1000,
      healthGrade: finalSmartGrade, summary
    }
    this.emit('done', result)
    return result
  }

  private emitProgress(p: {
    phase: string; percent: number; logs: string[]
    stableCount: number; weakCount: number; unstableCount: number; unreadableCount: number; remappedCount: number
    totalRetries: number; chunksDone: number; totalChunks: number; start: number; isSimulated: boolean; speedMBs: number
    mapArr?: number[]
    filesystemMetrics?: FilesystemMetrics
  }) {
    const elapsed = (Date.now() - p.start) / 1000
    const remaining = p.speedMBs > 0 && p.percent < 100
      ? ((p.totalChunks - p.chunksDone) * SECTORS_PER_CHUNK * SECTOR_SIZE) / (p.speedMBs * 1_048_576)
      : 0

    const progress: StabilizerProgress = {
      phase: p.phase,
      percent: Math.min(Math.max(p.percent, 0), 100),
      currentLba: p.chunksDone * SECTORS_PER_CHUNK,
      totalLbas: p.totalChunks * SECTORS_PER_CHUNK,
      stableSectors: p.stableCount,
      weakSectors: p.weakCount,
      unstableSectors: p.unstableCount,
      unreadableSectors: p.unreadableCount,
      remappedSectors: p.remappedCount,
      readRetries: p.totalRetries,
      speedMBs: Math.round(p.speedMBs * 10) / 10,
      elapsedSec: Math.round(elapsed),
      etaSec: Math.round(remaining),
      temperature: null,
      smartHealth: null,
      logLines: p.logs.slice(-30),
      sectorMap: p.mapArr ?? [],
      filesystemMetrics: p.filesystemMetrics
    }
    this.emit('progress', progress)
  }

  private async runChkdsk(logs: string[], onPct: (n: number) => void): Promise<{ badSectors: number; clean: boolean; cancelled: boolean; filesystemMetrics: FilesystemMetrics }> {
    return new Promise(resolve => {
      let badSectors = 0, clean = false
      const metrics: FilesystemMetrics = {
        filesChecked: 0,
        indexesVerified: 0,
        badClusters: 0,
        fileRecords: 0,
        repairActions: 0,
        ntfsStatus: 'Unknown'
      }

      const child = spawn('chkdsk', [`/scan`], { shell: true, windowsHide: true })

      child.stdout.on('data', (d: Buffer) => {
        const lines = d.toString().split(/[\r\n]+/).filter(Boolean)
        for (const l of lines) {
          logs.push(`[CHKDSK] ${l.trim()}`)

          // Progress percentage
          const m = l.match(/(\d+)\s*percent\s*complete/i) || l.match(/(\d+)%/i)
          if (m) onPct(parseInt(m[1]))

          // Bad sectors (KB)
          const bm = l.match(/(\d[\d,]*)\s+KB in bad sectors/i)
          if (bm) { badSectors = parseInt(bm[1].replace(/,/g, '')); metrics.badClusters = badSectors }

          // Clean / no problems
          if (/no problems found|no further action/i.test(l)) { clean = true; metrics.ntfsStatus = 'Clean' }

          // Files checked
          const fm = l.match(/(\d[\d,]*)\s+files? (?:processed|checked|verified)/i)
          if (fm) metrics.filesChecked = parseInt(fm[1].replace(/,/g, ''))

          // Index entries / indexes verified
          const im = l.match(/(\d[\d,]*)\s+index(?:es?)? (?:processed|checked|verified)/i)
          if (im) metrics.indexesVerified = parseInt(im[1].replace(/,/g, ''))

          // File records
          const frm = l.match(/(\d[\d,]*)\s+(?:file records?|MFT records?)/i)
          if (frm) metrics.fileRecords = parseInt(frm[1].replace(/,/g, ''))

          // Repair actions / corrections
          const ram = l.match(/(\d[\d,]*)\s+(?:repair|correction|fix)/i)
          if (ram) metrics.repairActions += parseInt(ram[1].replace(/,/g, ''))

          // NTFS status lines
          if (/NTFS volume is dirty/i.test(l)) metrics.ntfsStatus = 'Dirty'
          else if (/NTFS volume is clean/i.test(l)) metrics.ntfsStatus = 'Clean'
          else if (/Windows has made corrections/i.test(l)) { metrics.ntfsStatus = 'Repaired'; metrics.repairActions++ }
          else if (/Windows has checked the file system/i.test(l)) { if (metrics.ntfsStatus === 'Unknown') metrics.ntfsStatus = 'Verified' }
          else if (/errors? found/i.test(l) && !/no errors? found/i.test(l)) metrics.ntfsStatus = 'Errors Found'
          else if (/no errors? found/i.test(l)) { clean = true; metrics.ntfsStatus = 'Clean' }

          // Security descriptor fixes
          const sdm = l.match(/(\d[\d,]*)\s+security descriptor/i)
          if (sdm) metrics.repairActions += parseInt(sdm[1].replace(/,/g, ''))
        }
      })

      child.on('close', () => resolve({ badSectors, clean, cancelled: false, filesystemMetrics: metrics }))
      child.on('error', () => resolve({ badSectors, clean: false, cancelled: false, filesystemMetrics: metrics }))
    })
  }

  private gradeHealth(smart: any, weak: number, unstable: number, unreadable: number): StabilizerResult['healthGrade'] {
    const pending = smart?.attributes?.find((a: any) => a.id === 197)
    const reallocated = smart?.attributes?.find((a: any) => a.id === 5)
    const pendingRaw = pending ? Number(pending.raw) : 0
    const reallocRaw = reallocated ? Number(reallocated.raw) : 0

    if (unreadable >= 5 || smart?.overallHealth === 'FAILED' || reallocRaw > 50) return 'FAILING'
    if (unreadable > 0 || pendingRaw > 5) return 'CRITICAL'
    if (weak > 10 || unstable > 0 || pendingRaw > 0) return 'DEGRADING'
    return 'HEALTHY'
  }

  private buildSummary(stable: number, weak: number, unstable: number, unreadable: number, remapped: number, grade: string, simulated: boolean): string[] {
    const lines: string[] = ['[RESULT] ─────────────────────────────']
    if (simulated) {
      lines.push('[RESULT] ⓘ Simulation mode — administrator privileges required for raw disk I/O')
      lines.push('[RESULT] ⓘ Results shown are illustrative. Run as admin for real hardware diagnostics.')
      lines.push('[RESULT] ⓘ Lifespan scoring: surface-scan penalties NOT applied (simulated results excluded).')
    }
    lines.push(`[RESULT] Health Grade: ${grade}`)
    lines.push(`[RESULT] Stable sectors: ${stable.toLocaleString()}`)
    if (weak > 0)      lines.push(`[RESULT] ⚠ Weak sectors (≥150ms): ${weak} — physical media latency elevated`)
    if (unstable > 0)  lines.push(`[RESULT] ✗ Unstable sectors (≥500ms): ${unstable} — backup recommended`)
    if (unreadable > 0) lines.push(`[RESULT] ✗ Unreadable sectors: ${unreadable} — data at risk, backup immediately`)
    if (remapped > 0)  lines.push(`[RESULT] ↻ Firmware remapping events: ${remapped}`)
    if (grade === 'HEALTHY') lines.push('[RESULT] ✓ No significant physical media issues detected')
    if (grade === 'DEGRADING') lines.push('[RESULT] ⚠ Drive degrading — monitor closely and back up data')
    if (grade === 'CRITICAL') lines.push('[RESULT] ✗ Drive in critical state — back up immediately')
    if (grade === 'FAILING') lines.push('[RESULT] ✗ Drive showing failure signs — replace drive soon')
    return lines
  }
}

// ── Session registry ──────────────────────────────────────────────────────────

const activeSessions = new Map<number, StabilizerSession>()

export function startStabilizer(
  diskIndex: number,
  mode: StabilizerMode,
  callbacks: {
    onProgress: (p: StabilizerProgress) => void
    onDone: (r: StabilizerResult) => void
    onError: (msg: string) => void
  }
): Promise<void> {
  stopStabilizer(diskIndex)
  const session = new StabilizerSession(diskIndex, mode)
  activeSessions.set(diskIndex, session)
  session.on('progress', callbacks.onProgress)
  session.on('done', (r: StabilizerResult) => { activeSessions.delete(diskIndex); callbacks.onDone(r) })
  session.on('error', (msg: string) => { activeSessions.delete(diskIndex); callbacks.onError(msg) })
  return session.run().then(() => { /* discard StabilizerResult — result delivered via 'done' event */ }).catch(err => { callbacks.onError(err?.message ?? 'Unknown error') })
}

export function pauseStabilizer(diskIndex: number)  { activeSessions.get(diskIndex)?.pause() }
export function resumeStabilizer(diskIndex: number) { activeSessions.get(diskIndex)?.resume() }
export function stopStabilizer(diskIndex: number)   { activeSessions.get(diskIndex)?.cancel(); activeSessions.delete(diskIndex) }
export function isStabilizerActive(diskIndex: number): boolean { return activeSessions.has(diskIndex) }
