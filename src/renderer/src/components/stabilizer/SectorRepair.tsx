import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  ShieldCheck, AlertTriangle, CheckCircle, XCircle, RefreshCw,
  Play, Pause, Square, Terminal, HardDrive, Activity, Zap,
  AlertCircle, Info, ThumbsUp, Thermometer, Clock, RotateCcw
} from 'lucide-react'
import { useScanTaskStore } from '../../stores/useScanTaskStore'

// ── Types ──────────────────────────────────────────────────────────────────────

type StabMode = 'verify' | 'stabilize' | 'chkdsk' | 'smart'
type ScanState = 'idle' | 'running' | 'paused' | 'done' | 'error'

interface FilesystemMetrics {
  filesChecked: number
  indexesVerified: number
  badClusters: number
  fileRecords: number
  repairActions: number
  ntfsStatus: string
}

interface StabProgress {
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
  sectorMap: number[]
  filesystemMetrics?: FilesystemMetrics
}

interface StabResult {
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(sec: number): string {
  if (sec <= 0) return '--'
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

const BLOCK_COLORS = ['#1e293b', '#10b981', '#f59e0b', '#f97316', '#ef4444', '#3b82f6', '#06b6d4']
//                    unchecked  stable     weak       unstable   unreadable  remapped   scanning

const gradeColor = (g: string) => {
  if (g === 'HEALTHY')   return { text: 'text-success',  bg: 'bg-success/10  border-success/30' }
  if (g === 'DEGRADING') return { text: 'text-warning',  bg: 'bg-warning/10  border-warning/30' }
  if (g === 'CRITICAL')  return { text: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/30' }
  return { text: 'text-danger', bg: 'bg-danger/10 border-danger/30' }
}

const modeInfo = {
  verify:    { label: '⚡ Verify',    desc: 'Re-tests previously detected weak sectors from Surface Scan. Falls back to random sampling if no scan history exists.' },
  stabilize: { label: '🔬 Sector Stabilization', desc: 'Re-reads weak sectors repeatedly to assist firmware remapping. Requires a prior Surface Scan.' },
  chkdsk:    { label: '🛡 CHKDSK',    desc: 'Runs Windows CHKDSK /scan to verify filesystem integrity.' },
  smart:     { label: '📊 SMART',     desc: 'Reads SMART attributes: reallocated sectors, pending, temperature, health.' },
}

// Module-level cache — survives component unmount/remount cycles
const _stabProgressCache: Record<number, StabProgress> = {}
const _stabResultCache: Record<number, StabResult> = {}
const _stabErrorCache: Record<number, string> = {}

// ── Sector Map Canvas ─────────────────────────────────────────────────────────

const SectorMap: React.FC<{ map: number[]; totalBlocks: number }> = React.memo(({ map, totalBlocks }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = canvasRef.current
    if (!c || map.length === 0) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const W = c.width, H = c.height
    const cols = Math.ceil(Math.sqrt(map.length * (W / H)))
    const rows = Math.ceil(map.length / cols)
    const bw = W / cols, bh = H / rows
    ctx.clearRect(0, 0, W, H)
    for (let i = 0; i < map.length; i++) {
      const col = i % cols, row = Math.floor(i / cols)
      ctx.fillStyle = BLOCK_COLORS[map[i]] ?? BLOCK_COLORS[0]
      ctx.fillRect(col * bw + 0.5, row * bh + 0.5, bw - 1, bh - 1)
    }
  }, [map])

  if (map.length === 0) return null
  return <canvas ref={canvasRef} width={900} height={120} className="w-full rounded-xl" />
})
SectorMap.displayName = 'SectorMap'

// ── Stat tile ─────────────────────────────────────────────────────────────────

const Stat: React.FC<{ label: string; value: React.ReactNode; accent?: string; sub?: string }> = ({ label, value, accent = 'text-foreground', sub }) => (
  <div className="glass-card p-4 flex flex-col gap-1">
    <span className="text-[9px] font-black uppercase tracking-widest text-muted">{label}</span>
    <span className={`text-xl font-black ${accent}`}>{value}</span>
    {sub && <span className="text-[10px] text-muted">{sub}</span>}
  </div>
)

// ── Log line colour ────────────────────────────────────────────────────────────

function logColor(line: string): string {
  if (/✓|stable|healthy|clean/i.test(line))  return 'text-success'
  if (/⚠|weak|degrading|pending/i.test(line)) return 'text-warning'
  if (/✗|unreadable|critical|failing|error/i.test(line)) return 'text-danger'
  if (/↻|remap/i.test(line))                  return 'text-blue-400'
  if (/\[RESULT\]/i.test(line))               return 'text-primary font-bold'
  return 'text-foreground/70'
}

// ── Main component ─────────────────────────────────────────────────────────────

interface SectorRepairProps {
  onNavigateToTab?: (tab: any) => void
}

export const SectorRepair: React.FC<SectorRepairProps> = ({ onNavigateToTab }) => {
  const [drives, setDrives] = useState<any[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [mode, setMode] = useState<StabMode>('verify')
  const [scanState, setScanState] = useState<ScanState>('idle')
  const [progress, setProgress] = useState<StabProgress | null>(null)
  const [result, setResult] = useState<StabResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [confirmZeroFill, setConfirmZeroFill] = useState(false)
  const [lastScanResult, setLastScanResult] = useState<any | null>(null)
  const unsubRefs = useRef<(() => void)[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  // Global task store — used to detect active scans and restore state on remount
  const { activeTasks, getActiveTaskForDisk } = useScanTaskStore()
  const anyActive = activeTasks.length > 0
  const activeTask = selectedIdx !== null ? getActiveTaskForDisk(selectedIdx, 'stabilizer') : undefined
  const anotherScanRunning = anyActive && !activeTask

  useEffect(() => {
    window.api.health.getDrives().then((d: any[]) => {
      setDrives(d)
      if (d.length > 0) setSelectedIdx(d[0].diskIndex)
    }).catch(() => {})
  }, [])

  // Restore cached state when selectedIdx changes (handles remount after navigation)
  useEffect(() => {
    if (selectedIdx !== null) {
      if (_stabProgressCache[selectedIdx]) setProgress(_stabProgressCache[selectedIdx])
      if (_stabResultCache[selectedIdx]) {
        setResult(_stabResultCache[selectedIdx])
        setScanState('done')
      }
      if (_stabErrorCache[selectedIdx]) {
        setErrorMsg(_stabErrorCache[selectedIdx])
        setScanState('error')
      }
      // If task is running/paused in store, restore scan state
      if (activeTask) {
        setScanState(activeTask.status === 'paused' ? 'paused' : 'running')
      }
    }
  }, [selectedIdx]) // intentionally omit activeTask to avoid re-running on every store update

  // Load last surface scan results when active disk changes
  useEffect(() => {
    if (selectedIdx !== null) {
      window.api.surfaceScan.getLastResult(selectedIdx).then((res: any) => {
        setLastScanResult(res)
      }).catch((e) => {
        console.error('[SectorRepair] Failed to query scan results:', e)
      })
    }
  }, [selectedIdx])

  // Elapsed timer
  useEffect(() => {
    let t: any = null
    if (scanState === 'running') {
      t = setInterval(() => setElapsedSec(p => p + 1), 1000)
    } else if (scanState === 'idle') {
      setElapsedSec(0)
    }
    return () => clearInterval(t)
  }, [scanState])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [progress?.logLines])

  const setupListeners = useCallback(() => {
    unsubRefs.current.forEach(fn => fn())
    unsubRefs.current = [
      window.api.stabilizer.onProgress((p: StabProgress) => {
        if (selectedIdx !== null) _stabProgressCache[selectedIdx] = p
        setProgress(p)
      }),
      window.api.stabilizer.onDone((r: StabResult) => {
        if (selectedIdx !== null) {
          _stabResultCache[selectedIdx] = r
          delete _stabProgressCache[selectedIdx]
        }
        setResult(r)
        setScanState('done')
      }),
      window.api.stabilizer.onError((msg: string) => {
        if (selectedIdx !== null) _stabErrorCache[selectedIdx] = msg
        setErrorMsg(msg)
        setScanState('error')
      })
    ]
  }, [selectedIdx])

  // On mount, always re-attach listeners (scan may be running from before navigation)
  useEffect(() => {
    setupListeners()
    return () => {
      // On unmount, only unsubscribe IPC listeners — do NOT stop the scan
      unsubRefs.current.forEach(fn => fn())
    }
  }, [setupListeners])

  const drive = drives.find(d => d.diskIndex === selectedIdx)

  const startScan = useCallback(() => {
    if (selectedIdx === null) return
    // Clear caches for this disk when starting a new scan
    delete _stabProgressCache[selectedIdx]
    delete _stabResultCache[selectedIdx]
    delete _stabErrorCache[selectedIdx]
    setResult(null); setErrorMsg(null); setElapsedSec(0)
    
    // Immediately set a state-rich starting progress block to avoid black/empty center panel
    setProgress({
      phase: mode === 'stabilize' ? 'Initializing Sector Stabilization Engine...' : 'Initializing Sector Diagnostic Verify...',
      percent: 0,
      currentLba: 0,
      totalLbas: drive?.sizeLba ?? 937697985,
      stableSectors: 0,
      weakSectors: 0,
      unstableSectors: 0,
      unreadableSectors: 0,
      remappedSectors: 0,
      readRetries: 0,
      speedMBs: 0,
      elapsedSec: 0,
      etaSec: 0,
      temperature: drive?.temperature ?? null,
      smartHealth: 'Good',
      logLines: [`Initializing Sector Repair Engine (Mode: ${mode.toUpperCase()})...`],
      sectorMap: []
    })

    setupListeners()
    window.api.stabilizer.start(selectedIdx, mode)
    setScanState('running')
  }, [selectedIdx, mode, setupListeners, drive])

  const pauseScan = () => {
    if (selectedIdx === null) return
    window.api.stabilizer.pause(selectedIdx)
    setScanState('paused')
  }
  const resumeScan = () => {
    if (selectedIdx === null) return
    window.api.stabilizer.resume(selectedIdx)
    setScanState('running')
  }
  const stopScan = () => {
    if (selectedIdx === null) return
    window.api.stabilizer.stop(selectedIdx)
    if (selectedIdx !== null) {
      delete _stabProgressCache[selectedIdx]
      delete _stabResultCache[selectedIdx]
      delete _stabErrorCache[selectedIdx]
    }
    setScanState('idle'); setProgress(null); setElapsedSec(0)
  }

  const isActive = scanState === 'running' || scanState === 'paused'
  const grade = result?.healthGrade ?? null
  const gc = grade ? gradeColor(grade) : null
  const hasWeakSectors = lastScanResult && lastScanResult.weakSectors && lastScanResult.weakSectors.length > 0
  const isStartDisabled = selectedIdx === null || (mode === 'stabilize' && !hasWeakSectors) || anotherScanRunning

  return (
    <div className="flex flex-col gap-6 animate-fade-in">

      {/* ── Honest disclaimer ─────────────────────────────────────────── */}
      <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-start gap-3">
        <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <p className="text-xs text-foreground/70 leading-relaxed">
          <span className="font-bold text-primary">Sector Repair</span> performs genuine industry-standard diagnostics and sector stabilization.
          It can detect weak sectors, assist firmware remapping via repeated reads, and report SMART health accurately.
          It <span className="font-bold text-foreground">cannot</span> physically repair damaged platters or guarantee data recovery.
          Always back up important data before running any stabilization scan.
        </p>
      </div>

      {/* Scan lock banner — shown when another scan type is running */}
      {anotherScanRunning && (
        <div className="p-4 rounded-xl border border-warning/30 bg-warning/5 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
          <p className="text-xs text-warning font-bold">
            Another scan is already running. Only one scan can run at a time.
          </p>
        </div>
      )}

      {/* ── Drive selector ────────────────────────────────────────────── */}
      <div className="glass-card p-5 flex flex-col gap-4">
        <span className="text-[10px] font-black uppercase tracking-widest text-muted">Select Drive</span>
        <div className="flex flex-wrap gap-3">
          {drives.map(d => (
            <button
              key={d.diskIndex}
              onClick={() => setSelectedIdx(d.diskIndex)}
              disabled={isActive}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                selectedIdx === d.diskIndex
                  ? 'bg-primary/15 border-primary/40 text-foreground'
                  : 'bg-surface/30 border-white/5 text-muted hover:border-white/20 hover:text-foreground'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <HardDrive className="w-4 h-4 shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-black uppercase tracking-wider truncate">{d.mounts?.[0] ?? `Disk ${d.diskIndex}`}</span>
                <span className="text-[10px] text-muted truncate">{d.name ?? 'Local Drive'} · {d.type ?? 'HDD'}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Mode selector + action ────────────────────────────────────── */}
      <div className="glass-card p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-muted">Repair Mode</span>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(modeInfo) as StabMode[]).map(m => (
              <button
                key={m}
                disabled={isActive}
                onClick={() => setMode(m)}
                className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider border transition-all ${
                  mode === m
                    ? 'bg-primary/20 border-primary/50 text-primary'
                    : 'bg-surface/30 border-white/5 text-muted hover:border-white/20'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {modeInfo[m].label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted max-w-md">{modeInfo[mode].desc}</p>

          {(mode === 'verify' || mode === 'stabilize') && !hasWeakSectors && (
            <div className="mt-3 p-4 rounded-xl border border-warning/20 bg-warning/5 flex items-start gap-3 animate-fade-in max-w-lg">
              <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="font-black text-warning text-xs uppercase tracking-wider">
                  {mode === 'stabilize' ? 'No Surface Scan Results Found' : 'No Prior Scan History'}
                </p>
                <p className="text-xs text-foreground/70 mt-1 leading-relaxed">
                  {mode === 'stabilize'
                    ? 'Sector Stabilization targets specific weak sectors identified by a surface scan. Please run a '
                    : 'Verify will use random sampling since no prior scan history exists. For targeted verification, run a '}
                  <span
                    className="text-primary font-bold hover:underline cursor-pointer"
                    onClick={() => onNavigateToTab?.('surface')}
                  >
                    Sector Surface Scan
                  </span>{' '}
                  first to identify unstable blocks.
                </p>
              </div>
            </div>
          )}

          {(mode === 'verify' || mode === 'stabilize') && hasWeakSectors && (
            <div className="mt-3 p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-start gap-3 animate-fade-in max-w-lg">
              <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1.5">
                <p className="font-black text-primary text-xs uppercase tracking-wider">
                  Surface Scan Telemetry Loaded — {lastScanResult.weakSectors.length} Sectors Targeted
                </p>
                <div className="flex flex-wrap gap-3 text-[10px] font-bold">
                  <span className="text-warning">
                    ⚠ {lastScanResult.weakSectors.filter((s: any) => s.status === 2).length} weak (slow reads)
                  </span>
                  {lastScanResult.weakSectors.filter((s: any) => s.status === 3).length > 0 && (
                    <span className="text-danger">
                      ✗ {lastScanResult.weakSectors.filter((s: any) => s.status === 3).length} unreadable
                    </span>
                  )}
                  <span className="text-muted">
                    Scanned {new Date(lastScanResult.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-[10px] text-foreground/60 leading-relaxed">
                  {mode === 'verify'
                    ? 'Verify will re-test these exact LBAs and compare current latency against previous readings.'
                    : 'Stabilization will re-read each weak sector up to 3× to assist firmware remapping.'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {!isActive ? (
            <button
              onClick={startScan}
              disabled={isStartDisabled}
              className="btn-primary flex items-center gap-2 px-8 py-3 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play className="w-4 h-4" /> Start Sector Repair
            </button>
          ) : (
            <>
              {scanState === 'running' ? (
                <button onClick={pauseScan} className="btn-primary flex items-center gap-2 px-6 py-3">
                  <Pause className="w-4 h-4" /> Pause
                </button>
              ) : (
                <button onClick={resumeScan} className="btn-primary flex items-center gap-2 px-6 py-3">
                  <Play className="w-4 h-4" /> Resume
                </button>
              )}
              <button onClick={stopScan} className="btn-danger flex items-center gap-2 px-6 py-3">
                <Square className="w-4 h-4" /> Stop
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Progress ─────────────────────────────────────────────────── */}
      {progress && (
        <div className="flex flex-col gap-5">
          {/* Progress bar */}
          <div className="glass-card p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {scanState === 'running' && <RefreshCw className="w-4 h-4 text-primary animate-spin" />}
                {scanState === 'paused'  && <Pause className="w-4 h-4 text-warning" />}
                {scanState === 'done'    && <CheckCircle className="w-4 h-4 text-success" />}
                {scanState === 'error'   && <AlertTriangle className="w-4 h-4 text-danger" />}
                <span className="text-sm font-black uppercase tracking-wider text-foreground">{progress.phase}</span>
              </div>
              <span className="text-[22px] font-black text-primary">
                {scanState === 'done' ? 100 : progress.percent}%
              </span>
            </div>
            <div className="usage-bar-track">
              <div className="usage-bar-fill" style={{ width: `${scanState === 'done' ? 100 : progress.percent}%` }} />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted font-bold">
              <span>LBA {progress.currentLba.toLocaleString()} / {progress.totalLbas.toLocaleString()}</span>
              <span>ETA: {fmtTime(progress.etaSec)}</span>
            </div>
          </div>

          {/* Stats grid — CHKDSK shows filesystem metrics; other modes show physical sector metrics */}
          {mode === 'chkdsk' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Stat
                label="Files Checked"
                value={progress.filesystemMetrics?.filesChecked ?? '—'}
                accent="text-primary"
              />
              <Stat
                label="Indexes Verified"
                value={progress.filesystemMetrics?.indexesVerified ?? '—'}
                accent="text-primary"
              />
              <Stat
                label="Bad Clusters"
                value={progress.filesystemMetrics?.badClusters ?? '—'}
                accent={(progress.filesystemMetrics?.badClusters ?? 0) > 0 ? 'text-danger' : 'text-muted'}
              />
              <Stat
                label="File Records"
                value={progress.filesystemMetrics?.fileRecords ?? '—'}
                accent="text-foreground"
              />
              <Stat
                label="Repair Actions"
                value={progress.filesystemMetrics?.repairActions ?? '—'}
                accent={(progress.filesystemMetrics?.repairActions ?? 0) > 0 ? 'text-warning' : 'text-muted'}
              />
              <Stat
                label="NTFS Status"
                value={progress.filesystemMetrics?.ntfsStatus ?? '—'}
                accent={
                  progress.filesystemMetrics?.ntfsStatus === 'Clean' || progress.filesystemMetrics?.ntfsStatus === 'Verified'
                    ? 'text-success'
                    : progress.filesystemMetrics?.ntfsStatus === 'Repaired'
                    ? 'text-warning'
                    : progress.filesystemMetrics?.ntfsStatus === 'Dirty' || progress.filesystemMetrics?.ntfsStatus === 'Errors Found'
                    ? 'text-danger'
                    : 'text-muted'
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              <Stat label="Stabilized Sectors" value={progress.stableSectors}     accent="text-success" />
              <Stat label="Weak"        value={progress.weakSectors}        accent={progress.weakSectors > 0 ? 'text-warning' : 'text-muted'} />
              <Stat label="Unstable"    value={progress.unstableSectors}    accent={progress.unstableSectors > 0 ? 'text-orange-400' : 'text-muted'} />
              <Stat label="Unreadable"  value={progress.unreadableSectors}  accent={progress.unreadableSectors > 0 ? 'text-danger' : 'text-muted'} />
              <Stat label="Remapped"    value={progress.remappedSectors}    accent={progress.remappedSectors > 0 ? 'text-blue-400' : 'text-muted'} />
              <Stat label="Retries"     value={progress.readRetries}        accent="text-muted" />
              <Stat label="Speed"       value={`${progress.speedMBs} MB/s`} accent="text-primary" />
              <Stat label="Duration"    value={scanState === 'done' && result ? fmtTime(result.durationSec) : (elapsedSec < 1 ? '< 1s' : fmtTime(elapsedSec))} />
            </div>
          )}

          {/* Sector Map */}
          {progress.sectorMap.length > 0 && (
            <div className="glass-card p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  <span className="text-[11px] font-black uppercase tracking-widest text-foreground">Sector Map</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {[
                    ['Stabilized', BLOCK_COLORS[1]], ['Weak', BLOCK_COLORS[2]],
                    ['Unstable', BLOCK_COLORS[3]], ['Unreadable', BLOCK_COLORS[4]],
                    ['Remapped', BLOCK_COLORS[5]], ['Scanning', BLOCK_COLORS[6]]
                  ].map(([label, color]) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ background: color as string }} />
                      <span className="text-[10px] font-bold text-muted">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <SectorMap map={progress.sectorMap} totalBlocks={progress.sectorMap.length} />
            </div>
          )}

          {/* Live log */}
          <div className="glass-card p-5 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-muted">
              <Terminal className="w-3.5 h-3.5" />
              <span className="text-[10px] font-black uppercase tracking-widest">Diagnostic Log</span>
            </div>
            <div ref={logRef} className="h-[180px] bg-black/50 rounded-xl border border-white/5 p-3 font-mono text-[11px] overflow-y-auto custom-scrollbar">
              {progress.logLines.map((line, i) => (
                <div key={i} className={`py-0.5 ${logColor(line)}`}>
                  <span className="text-primary/40 mr-2">›</span>{line}
                </div>
              ))}
              {progress.logLines.length === 0 && <span className="text-muted italic opacity-50">Initializing...</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── Result banner ─────────────────────────────────────────────── */}
      {result && scanState === 'done' && gc && (
        <div className={`p-5 rounded-xl border flex items-start gap-4 ${gc.bg}`}>
          {result.healthGrade === 'HEALTHY'
            ? <ThumbsUp className={`w-6 h-6 shrink-0 mt-0.5 ${gc.text}`} />
            : result.healthGrade === 'FAILING' || result.healthGrade === 'CRITICAL'
              ? <XCircle className={`w-6 h-6 shrink-0 mt-0.5 ${gc.text}`} />
              : <AlertCircle className={`w-6 h-6 shrink-0 mt-0.5 ${gc.text}`} />}
          <div className="flex-1">
            <p className={`font-black text-sm ${gc.text}`}>
              {result.cancelled ? 'Repair Cycle Cancelled' : `Repair Cycle Complete — Health Grade: ${result.healthGrade}`}
            </p>
            {mode === 'chkdsk' && result.filesystemMetrics ? (
              <p className="text-xs text-muted mt-1">
                {result.filesystemMetrics.filesChecked > 0 && `${result.filesystemMetrics.filesChecked.toLocaleString()} files checked · `}
                {result.filesystemMetrics.indexesVerified > 0 && `${result.filesystemMetrics.indexesVerified.toLocaleString()} indexes verified · `}
                {result.filesystemMetrics.badClusters > 0
                  ? `${result.filesystemMetrics.badClusters.toLocaleString()} KB bad clusters · `
                  : 'No bad clusters · '}
                NTFS: {result.filesystemMetrics.ntfsStatus}
                {result.filesystemMetrics.repairActions > 0 && ` · ${result.filesystemMetrics.repairActions} repair action(s)`}
              </p>
            ) : (
              <p className="text-xs text-muted mt-1">
                {result.totalScanned.toLocaleString()} sample points · {result.durationSec.toFixed(1)}s · {result.unreadableSectors} unreadable · {result.weakSectors} weak · {result.remappedSectors} remapped
              </p>
            )}
            {result.summary.filter(l => l.includes('[RESULT]')).map((l, i) => (
              <p key={i} className={`text-xs mt-0.5 ${logColor(l)}`}>{l.replace('[RESULT] ', '')}</p>
            ))}
            {(result.healthGrade === 'CRITICAL' || result.healthGrade === 'FAILING') && (
              <div className="mt-3 p-3 rounded-lg bg-danger/5 border border-danger/20">
                <p className="text-xs font-bold text-danger">⚠ Back up your data immediately. This tool cannot physically repair damaged sectors.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────── */}
      {errorMsg && (
        <div className="p-5 rounded-xl border border-danger/30 bg-danger/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-danger text-sm">Repair Scan Error</p>
            <p className="text-xs text-muted mt-1">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* ── Advanced: Zero-Fill Mode ──────────────────────────────────── */}
      <div className="glass-card p-5 flex flex-col gap-4">
        <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center justify-between text-left w-full">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-warning" />
            <span className="text-[11px] font-black uppercase tracking-widest text-warning">Advanced Options</span>
          </div>
          <span className="text-[10px] text-muted">{showAdvanced ? '▲ Hide' : '▼ Show'}</span>
        </button>

        {showAdvanced && (
          <div className="flex flex-col gap-4 border-t border-white/5 pt-4">
            <div className="p-4 rounded-xl border border-danger/30 bg-danger/5 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
                <div>
                  <p className="font-black text-danger text-sm">Zero-Fill / Full Overwrite Mode</p>
                  <p className="text-xs text-foreground/70 mt-1 leading-relaxed">
                    Writes zeros to all sectors, triggering the drive's firmware to remap unstable sectors.
                    <span className="font-bold text-danger"> This permanently erases ALL data on the drive.</span>
                    This process cannot physically repair damaged platters. It may help remap unstable sectors.
                    Requires Administrator rights. Use only on non-system drives with no important data.
                  </p>
                </div>
              </div>

              {!confirmZeroFill ? (
                <button
                  onClick={() => setConfirmZeroFill(true)}
                  className="self-start px-5 py-2 bg-danger/10 border border-danger/30 text-danger text-xs font-black rounded-xl hover:bg-danger/20 transition-all uppercase tracking-wider"
                >
                  I Understand — Show Zero-Fill Options
                </button>
              ) : (
                <div className="flex flex-col gap-3 p-4 bg-black/40 rounded-xl border border-danger/20">
                  <p className="text-xs font-bold text-danger uppercase tracking-wider">⚠ Final Confirmation Required</p>
                  <p className="text-xs text-foreground/60">
                    Drive: <span className="text-foreground font-bold">{drive?.name ?? 'Selected Drive'}</span> — all data will be permanently destroyed.
                  </p>
                  <p className="text-[10px] text-muted italic">
                    This feature requires external tools (e.g. diskpart clean, dd, or manufacturer utilities) and must be run outside Windows on a bootable environment.
                    DriveWatch opens the appropriate documentation.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => window.electron.shell.openExternal('https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/diskpart')}
                      className="px-4 py-2 bg-danger/20 border border-danger/40 text-danger text-xs font-black rounded-xl hover:bg-danger/30 transition-all"
                    >
                      Open Diskpart Docs
                    </button>
                    <button
                      onClick={() => setConfirmZeroFill(false)}
                      className="px-4 py-2 bg-surface/30 border border-white/10 text-muted text-xs font-black rounded-xl hover:text-foreground transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Idle placeholder ──────────────────────────────────────────── */}
      {!progress && !result && !errorMsg && (
        <div className="glass-card p-16 flex flex-col items-center justify-center gap-5 border-dashed border-white/5 opacity-60">
          <div className="p-5 rounded-3xl bg-primary/10 text-primary border border-primary/20">
            <ShieldCheck className="w-12 h-12" />
          </div>
          <div className="text-center">
            <p className="text-sm font-black uppercase tracking-widest text-foreground">
              {drive ? `Ready to Analyze: ${drive.name}` : 'Select a Drive Above'}
            </p>
            <p className="text-xs text-muted mt-2">
              Choose a repair/diagnostic mode and click Start to begin genuine sector stabilization
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
