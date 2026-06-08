import React, { useState, useEffect, useRef, useCallback } from 'react'
import { HardDrive, Play, Pause, Square, Zap, AlertTriangle, CheckCircle, Thermometer, Clock, Activity, ShieldCheck, RefreshCw } from 'lucide-react'
import { useScanTaskStore } from '../stores/useScanTaskStore'

type ScanMode = 'quick' | 'full' | 'smart'
type ScanExecutionMode = 'REAL_SCAN' | 'SIMULATION_MODE'
type ScanState = 'idle' | 'scanning' | 'paused' | 'done' | 'error'

interface ScanProgress {
  percent: number
  currentLba: number
  totalLbas: number
  readSpeedMBs: number
  etaSec: number
  errorCount: number
  slowCount: number
  blocks: number[]
  totalBlocks: number
  temperature: number | null
  healthPct: number | null
  executionMode: ScanExecutionMode
  realIo: boolean
  actualBytesRead: number
  lastReadBytes: number
  lastReadLatencyMs: number
  ioTelemetry: any | null
  realIoStatus?: 'DIRECT_IO' | 'BUFFERED_FALLBACK' | 'READING' | 'FAILED' | 'DISCONNECTED' | null
}

interface DriveInfo {
  diskIndex: number
  name: string
  type: string
  mounts: string[]
  serial: string
  size: number
  temperature: number | null
}

const BLOCK_COLORS = ['#1f2937', '#10b981', '#f59e0b', '#ef4444', '#06b6d4']
const BLOCK_LABELS = ['Unscanned', 'Healthy', 'Slow', 'Bad', 'Scanning']

// Module-level cache — survives component unmount/remount cycles
const _surfaceProgressCache: Record<number, ScanProgress> = {}
const _surfaceResultCache: Record<number, any> = {}
const _surfaceErrorCache: Record<number, string> = {}

function fmtBytes(b: number) {
  if (!b) return '0 B'
  const k = 1024
  const s = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(b) / Math.log(k))
  return `${(b / Math.pow(k, i)).toFixed(1)} ${s[i]}`
}

function fmtEta(sec: number) {
  if (!sec || sec < 1) return '--'
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

function decodeWin32Error(code: number): string {
  switch (code) {
    case 2: return 'ERROR_FILE_NOT_FOUND (2): The system cannot find the file specified.'
    case 3: return 'ERROR_PATH_NOT_FOUND (3): The system cannot find the path specified.'
    case 5: return 'ERROR_ACCESS_DENIED (5): Access is denied. Administrator privileges required.'
    case 21: return 'ERROR_NOT_READY (21): The device is not ready.'
    case 32: return 'ERROR_SHARING_VIOLATION (32): Sharing violation. The physical drive is locked by another process.'
    case 55: return 'ERROR_DEV_NOT_EXIST (55): The specified device is no longer available.'
    case 87: return 'ERROR_INVALID_PARAMETER (87): Invalid parameter. Alignment/buffer size mismatch under FILE_FLAG_NO_BUFFERING.'
    case 1117: return 'ERROR_IO_DEVICE (1117): The request could not be performed because of an I/O device error.'
    case 1167: return 'ERROR_DEVICE_NOT_CONNECTED (1167): The device is not connected.'
    default: return `Win32 Error (${code})`
  }
}

const SectorMap: React.FC<{ blocks: number[]; totalBlocks: number }> = ({ blocks, totalBlocks }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const numBlocks = Math.max(blocks.length, 1)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width
    const H = canvas.height
    const cols = Math.ceil(Math.sqrt(numBlocks * (W / H)))
    const rows = Math.ceil(numBlocks / cols)
    const bw = Math.max(1, Math.floor(W / cols))
    const bh = Math.max(1, Math.floor(H / rows))

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0a0a0c'
    ctx.fillRect(0, 0, W, H)

    for (let i = 0; i < numBlocks; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = col * bw
      const y = row * bh
      const status = blocks[i] ?? 0
      ctx.fillStyle = BLOCK_COLORS[status] ?? BLOCK_COLORS[0]
      ctx.fillRect(x + 1, y + 1, bw - 1, bh - 1)
    }
  }, [blocks, numBlocks])

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={220}
      style={{ width: '100%', height: 220, borderRadius: 12, imageRendering: 'pixelated' }}
    />
  )
}

const Stat: React.FC<{ label: string; value: React.ReactNode; accent?: string }> = ({ label, value, accent = 'text-foreground' }) => (
  <div className="flex flex-col gap-1 p-4 rounded-2xl bg-surface/30 border border-white/5">
    <span className="text-[10px] font-black uppercase tracking-widest text-muted">{label}</span>
    <span className={`text-[22px] font-black leading-none ${accent}`}>{value}</span>
  </div>
)

export const DiskSurfaceScanner: React.FC<{
  onNavigateToTab?: (tab: 'dashboard' | 'scanner' | 'health' | 'cleanup' | 'lifespan' | 'recovery' | 'nas' | 'diagnostics' | 'surface' | 'stabilizer') => void
}> = ({ onNavigateToTab }) => {
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [mode, setMode] = useState<ScanMode>('quick')
  const [executionMode, setExecutionMode] = useState<ScanExecutionMode>('REAL_SCAN')
  const [scanState, setScanState] = useState<ScanState>('idle')
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [showWarning, setShowWarning] = useState(false)
  const [elapsedTime, setElapsedTime] = useState<number>(0)
  const unsubRefs = useRef<(() => void)[]>([])

  // Global task store — used to detect active scans and restore state on remount
  const { activeTasks, getActiveTaskForDisk } = useScanTaskStore()
  const anyActive = activeTasks.length > 0
  const activeTask = selectedIdx !== null ? getActiveTaskForDisk(selectedIdx, 'surface') : undefined

  useEffect(() => {
    window.api.isAdmin().then(setIsAdmin).catch(() => setIsAdmin(false))
    window.api.health.getDrives().then(d => {
      setDrives(d)
      if (d.length > 0) setSelectedIdx(d[0].diskIndex)
    }).catch(() => {})
  }, [])

  // Restore cached state when selectedIdx changes (handles remount after navigation)
  useEffect(() => {
    if (selectedIdx !== null) {
      if (_surfaceProgressCache[selectedIdx]) setProgress(_surfaceProgressCache[selectedIdx])
      if (_surfaceResultCache[selectedIdx]) {
        setResult(_surfaceResultCache[selectedIdx])
        setScanState('done')
      }
      if (_surfaceErrorCache[selectedIdx]) {
        setError(_surfaceErrorCache[selectedIdx])
        setScanState('error')
      }
      // If task is running/paused in store, restore scan state
      if (activeTask) {
        setScanState(activeTask.status === 'paused' ? 'paused' : 'scanning')
      }
    }
  }, [selectedIdx]) // intentionally omit activeTask to avoid re-running on every store update

  useEffect(() => {
    let timer: any = null
    if (scanState === 'scanning') {
      timer = setInterval(() => {
        setElapsedTime(prev => prev + 1)
      }, 1000)
    } else if (scanState === 'idle') {
      setElapsedTime(0)
    }
    return () => clearInterval(timer)
  }, [scanState])

  const setupListeners = useCallback(() => {
    unsubRefs.current.forEach(fn => fn())
    unsubRefs.current = [
      window.api.surfaceScan.onProgress(p => {
        if (selectedIdx !== null) _surfaceProgressCache[selectedIdx] = p
        setProgress(p)
      }),
      window.api.surfaceScan.onDone(r => {
        if (selectedIdx !== null) {
          _surfaceResultCache[selectedIdx] = r
          delete _surfaceProgressCache[selectedIdx]
        }
        setResult(r)
        setScanState('done')
      }),
      window.api.surfaceScan.onError(msg => {
        if (selectedIdx !== null) _surfaceErrorCache[selectedIdx] = msg
        setError(msg)
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

  const startScan = useCallback(() => {
    if (selectedIdx === null) return
    // Clear caches for this disk when starting a new scan
    delete _surfaceProgressCache[selectedIdx]
    delete _surfaceResultCache[selectedIdx]
    delete _surfaceErrorCache[selectedIdx]
    setResult(null)
    setError(null)
    setProgress(null)
    setElapsedTime(0)
    setupListeners()
    const drive = drives.find(d => d.diskIndex === selectedIdx)
    console.log(`[DiskSurfaceScanner] Starting ${mode} scan: diskIndex=${selectedIdx}, executionMode=${executionMode}, model="${drive?.name ?? ''}", serial="${drive?.serial ?? ''}"`)
    window.api.surfaceScan.start(
      selectedIdx,
      mode,
      drive?.name ?? '',
      drive?.serial ?? '',
      `\\\\.\\PhysicalDrive${selectedIdx}`,
      executionMode
    )
    setScanState('scanning')
  }, [selectedIdx, mode, executionMode, setupListeners, drives])

  const pauseScan = () => {
    if (selectedIdx === null) return
    window.api.surfaceScan.pause(selectedIdx)
    setScanState('paused')
  }

  const resumeScan = () => {
    if (selectedIdx === null) return
    window.api.surfaceScan.resume(selectedIdx)
    setScanState('scanning')
  }

  const stopScan = () => {
    if (selectedIdx === null) return
    window.api.surfaceScan.stop(selectedIdx)
    if (selectedIdx !== null) {
      delete _surfaceProgressCache[selectedIdx]
      delete _surfaceResultCache[selectedIdx]
      delete _surfaceErrorCache[selectedIdx]
    }
    setScanState('idle')
    setProgress(null)
    setElapsedTime(0)
  }

  const handleStart = () => {
    if (mode === 'full' && !showWarning) {
      setShowWarning(true)
      return
    }
    setShowWarning(false)
    startScan()
  }

  const drive = drives.find(d => d.diskIndex === selectedIdx)
  const isActive = scanState === 'scanning' || scanState === 'paused'
  const temp = progress?.temperature ?? drive?.temperature ?? null
  const healthPct = progress?.healthPct ?? null
  const simulationActive = executionMode === 'SIMULATION_MODE' || progress?.executionMode === 'SIMULATION_MODE' || result?.executionMode === 'SIMULATION_MODE'
  
  const hasSlowSectors = !!((progress && progress.slowCount > 0) || (result && result.slowCount > 0))
  const hasBadSectors = !!((progress && progress.errorCount > 0) || (result && result.errorCount > 0))
  const hasSmartWarnings = healthPct !== null && healthPct < 100
  // Another scan type is running (not this disk's surface scan)
  const anotherScanRunning = anyActive && !activeTask

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {isAdmin === false && executionMode === 'REAL_SCAN' && (
        <div className="p-4 rounded-xl border border-warning/30 bg-warning/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-warning">Administrator Required</p>
            <p className="text-xs text-muted mt-1">Raw disk access requires administrator privileges. Please restart DriveWatch as administrator.</p>
          </div>
        </div>
      )}

      {/* Scan lock banner — shown when another scan type is running */}
      {anotherScanRunning && (
        <div className="p-4 rounded-xl border border-warning/30 bg-warning/5 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
          <p className="text-xs text-warning font-bold">
            Another scan is already running. Only one scan can run at a time.
          </p>
        </div>
      )}

      {/* Drive selector */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        {drives.map(d => (
          <button
            key={d.diskIndex}
            onClick={() => { if (!isActive) setSelectedIdx(d.diskIndex) }}
            className={`flex items-center gap-3 px-5 py-3 rounded-2xl border transition-all shrink-0 ${
              selectedIdx === d.diskIndex
                ? 'bg-primary/10 border-primary/40 text-white'
                : 'bg-surface/20 border-white/5 text-muted hover:border-white/20 hover:bg-surface/40'
            } ${isActive && selectedIdx !== d.diskIndex ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <HardDrive className="w-4 h-4" />
            <div className="text-left">
              <div className="text-xs font-black">{d.mounts?.[0] || 'Disk'} {d.diskIndex}</div>
              <div className="text-[10px] text-muted">{d.type} • {fmtBytes(d.size)}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Mode + Controls */}
      <div className="glass-card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted">Scan Mode</span>
            <div className="flex gap-2">
            {(['quick', 'full', 'smart'] as ScanMode[]).map(m => (
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
                {m === 'quick' ? 'Quick' : m === 'full' ? 'Full' : 'SMART'}
              </button>
            ))}
            </div>
            <p className="text-[11px] text-muted">
              {mode === 'quick' ? 'Samples ~1% of sectors. Progress advances only after physical reads.' :
               mode === 'full'  ? 'Reads every sector with raw physical IO validation.' :
                                  'SMART attributes only. No surface IO is performed.'}
            </p>
          </div>


        </div>

        <div className="flex items-center gap-3">
          {!isActive ? (
            <button
              onClick={handleStart}
              disabled={selectedIdx === null || anotherScanRunning}
              className="btn-primary flex items-center gap-2 px-8 py-3 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play className="w-4 h-4" /> Start Scan
            </button>
          ) : (
            <>
              {scanState === 'scanning' ? (
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

      {/* Full scan warning */}
      {showWarning && (
        <div className="p-5 rounded-xl border border-warning/40 bg-warning/5 flex items-start gap-4 animate-fade-in">
          <AlertTriangle className="w-6 h-6 text-warning shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold text-warning mb-1">Full Surface Scan Warning</p>
            <p className="text-xs text-muted leading-relaxed">A full scan reads every sector and may take 30–180 minutes on large drives. This is read-only and will not modify data. System drive scans may be slower.</p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button
              onClick={() => { setShowWarning(false); startScan() }}
              className="px-5 py-2 bg-warning/20 border border-warning/50 text-warning text-xs font-black rounded-xl hover:bg-warning/30 transition-all"
            >
              Confirm &amp; Start
            </button>
            <button
              onClick={() => setShowWarning(false)}
              className="px-5 py-2 bg-surface/30 border border-white/10 text-muted text-xs font-black rounded-xl hover:text-foreground transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Progress + Stats */}
      {progress && (
        <div className="flex flex-col gap-5">
          {/* Progress bar */}
          <div className="glass-card p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {scanState === 'scanning' && <RefreshCw className="w-4 h-4 text-primary animate-spin" />}
                {scanState === 'paused' && <Pause className="w-4 h-4 text-warning" />}
                {scanState === 'done' && <CheckCircle className="w-4 h-4 text-success" />}
                {scanState === 'error' && <AlertTriangle className="w-4 h-4 text-danger" />}
                <span className="text-sm font-black uppercase tracking-wider text-foreground">
                  {scanState === 'scanning' ? 'Scanning...' : scanState === 'paused' ? 'Paused' : scanState === 'done' ? 'Scan Complete' : 'Scan Error'}
                </span>
              </div>
              <span className="text-[22px] font-black text-primary">{scanState === 'done' ? 100 : progress.percent}%</span>
            </div>
            <div className="usage-bar-track">
              <div className="usage-bar-fill" style={{ width: `${scanState === 'done' ? 100 : progress.percent}%` }} />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted font-bold">
              <span>LBA {progress.currentLba.toLocaleString()} / {progress.totalLbas.toLocaleString()}</span>
              <span>ETA: {fmtEta(progress.etaSec)}</span>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat label="Speed" value={`${progress.readSpeedMBs} MB/s`} accent="text-primary" />
            <Stat label="Errors" value={progress.errorCount} accent={progress.errorCount > 0 ? 'text-danger' : 'text-success'} />
            <Stat label="Slow Sectors" value={progress.slowCount} accent={progress.slowCount > 0 ? 'text-warning' : 'text-muted'} />
            <Stat label="Temperature" value={temp !== null ? `${temp}°C` : '—'} accent={temp !== null && temp > 55 ? 'text-warning' : 'text-foreground'} />
            <Stat label="SMART Health" value={healthPct !== null ? `${healthPct}%` : 'Unavailable'} accent={healthPct !== null && healthPct < 70 ? 'text-warning' : healthPct !== null ? 'text-success' : 'text-muted'} />
            <Stat label="Duration" value={scanState === 'done' && result ? (result.durationSec < 1 ? '< 1s' : fmtEta(Math.round(result.durationSec))) : (elapsedTime < 1 ? '< 1s' : fmtEta(elapsedTime))} />
          </div>
        </div>
      )}

      {/* REAL I/O Status & Diagnostics Panel */}
      {executionMode === 'REAL_SCAN' && (progress || result || error) && (
        <div className="glass-card p-6 border border-primary/20 bg-gradient-to-br from-[#0c1524]/90 via-[#080d1a]/95 to-[#060a12]/98 rounded-2xl flex flex-col gap-5 shadow-2xl relative overflow-hidden animate-fade-in">
          {/* Subtle accent glow */}
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-black uppercase tracking-wider text-white">REAL I/O Status &amp; Diagnostics</h4>
                <p className="text-[11px] text-muted">Deep Windows raw physical storage validation telemetry</p>
              </div>
            </div>
            
            {/* Status Badges */}
            <div className="flex items-center gap-2">
              {(() => {
                const status = progress?.realIoStatus || (error ? 'FAILED' : result ? 'DIRECT_IO' : null)
                switch (status) {
                  case 'DIRECT_IO':
                    return (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/25">
                        <ShieldCheck className="w-3.5 h-3.5" /> Direct Raw IO Active
                      </span>
                    )
                  case 'BUFFERED_FALLBACK':
                    return (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider bg-warning/15 text-warning border border-warning/30">
                        <AlertTriangle className="w-3.5 h-3.5 animate-pulse" /> BUFFERED RAW IO ACTIVE
                      </span>
                    )
                  case 'READING':
                    return (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider bg-success/10 text-success border border-success/25 animate-pulse">
                        <span className="w-2 h-2 rounded-full bg-success animate-ping mr-1" />
                        <Activity className="w-3.5 h-3.5" /> Reading Disk
                      </span>
                    )
                  case 'FAILED':
                    return (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider bg-danger/10 text-danger border border-danger/25">
                        <AlertTriangle className="w-3.5 h-3.5" /> Critical I/O Failure
                      </span>
                    )
                  case 'DISCONNECTED':
                    return (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider bg-warning/10 text-warning border border-warning/25">
                        <AlertTriangle className="w-3.5 h-3.5" /> Drive Disconnected
                      </span>
                    )
                  default:
                    return (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider bg-surface/40 text-muted border border-white/5">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Initializing Worker
                      </span>
                    )
                }
              })()}
            </div>
          </div>

          {/* Telemetry Detail Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Device Path & Handle */}
            <div className="flex flex-col gap-1.5 p-3.5 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted">Windows Device Target</span>
              <span className="text-xs font-mono font-bold text-foreground truncate select-all" title={progress?.ioTelemetry?.device || drive?.mounts?.[0] || 'PhysicalDrive'}>
                {progress?.ioTelemetry?.device || drive?.mounts?.[0] || 'PhysicalDrive'}
              </span>
              <div className="flex items-center gap-1.5 mt-1">
                <div className={`w-1.5 h-1.5 rounded-full ${progress?.ioTelemetry?.handleValid !== false ? 'bg-success' : 'bg-danger'}`} />
                <span className="text-[10px] font-bold text-muted">
                  {progress?.ioTelemetry?.handleValid !== false ? 'Win32 Handle Active' : 'Handle Closed / Invalid'}
                </span>
              </div>
            </div>

            {/* Direct I/O vs Buffered */}
            <div className="flex flex-col gap-1.5 p-3.5 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted">Buffering Enforcement</span>
              {(() => {
                const isNoBuffering = progress?.ioTelemetry ? progress.ioTelemetry.noBuffering : true
                return (
                  <>
                    <span className={`text-xs font-black uppercase tracking-wide ${isNoBuffering ? 'text-primary' : 'text-warning'}`}>
                      {isNoBuffering ? 'Direct (NO_BUFFERING)' : 'Buffered Fallback'}
                    </span>
                    <span className="text-[9px] text-muted leading-tight mt-0.5">
                      {isNoBuffering ? 'Bypasses Windows cache. Sector-aligned (512B/4096B) buffers active.' : 'Self-healed fallback. Cache enabled for robust raw compatibility.'}
                    </span>
                  </>
                )
              })()}
            </div>

            {/* Logical Offset & Sector */}
            <div className="flex flex-col gap-1.5 p-3.5 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted">Read Location</span>
              <div className="flex justify-between items-center text-xs font-mono font-bold text-foreground">
                <span>Sector {progress?.ioTelemetry?.sector?.toLocaleString() ?? '—'}</span>
              </div>
              <span className="text-[9px] font-mono text-muted tracking-wider leading-none">
                Offset {progress?.ioTelemetry?.offset ? `0x${progress.ioTelemetry.offset.toString(16).toUpperCase()}` : '—'}
              </span>
            </div>

            {/* Last Read Latency & IO Success */}
            <div className="flex flex-col gap-1.5 p-3.5 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted">Latency &amp; Throughput</span>
              <div className="flex justify-between items-center">
                <span className="text-xs font-black text-foreground">
                  {progress?.ioTelemetry?.readLatency ? `${progress.ioTelemetry.readLatency.toFixed(2)} ms` : '—'}
                </span>
                {progress?.ioTelemetry?.throughputMBs ? (
                  <span className="text-[10px] font-mono font-bold text-success">
                    {progress.ioTelemetry.throughputMBs.toFixed(1)} MB/s
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <div className={`w-1.5 h-1.5 rounded-full ${progress?.ioTelemetry?.readSuccess !== false ? 'bg-success' : 'bg-danger'}`} />
                <span className="text-[10px] font-bold text-muted">
                  {progress?.ioTelemetry?.readSuccess !== false ? 'I/O Integrity Valid' : 'Physical IO Failed'}
                </span>
              </div>
            </div>
          </div>

          {/* Win32 Error Decode Banner */}
          {(() => {
            const errCode = progress?.ioTelemetry?.win32Error || (error && error.includes('Win32') ? parseInt(error.match(/Win32 (\d+)/)?.[1] || '0') : 0)
            if (errCode > 0) {
              return (
                <div className="p-3.5 rounded-xl bg-danger/10 border border-danger/20 flex gap-2.5 items-start animate-pulse mt-1">
                  <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-danger leading-none">Decoded Win32 Storage Error</span>
                    <p className="text-xs text-muted leading-relaxed font-semibold mt-1">
                      {decodeWin32Error(errCode)}
                    </p>
                  </div>
                </div>
              )
            }
            return null
          })()}
        </div>
      )}

      {/* Sector Map */}
      {progress && progress.totalBlocks > 0 && (
        <div className="glass-card p-6 flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-black uppercase tracking-wider text-foreground">Sector Map</h4>
                <p className="text-[11px] text-muted">{progress.totalBlocks.toLocaleString()} display blocks representing {progress.totalLbas.toLocaleString()} LBAs</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {BLOCK_COLORS.map((c, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
                  <span className="text-[10px] font-bold text-muted">{BLOCK_LABELS[i]}</span>
                </div>
              ))}
            </div>
          </div>
          <SectorMap blocks={progress.blocks} totalBlocks={progress.totalBlocks} />
        </div>
      )}

      {/* Result */}
      {result && scanState === 'done' && (
        <div className={`p-5 rounded-xl border flex items-start gap-4 ${
          result.success ? 'border-success/30 bg-success/5' : 'border-danger/30 bg-danger/5'
        }`}>
          {result.success ? (
            <CheckCircle className="w-6 h-6 text-success shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-6 h-6 text-danger shrink-0 mt-0.5" />
          )}
          <div>
            <p className={`font-black ${result.success ? 'text-success' : 'text-danger'}`}>
              {result.cancelled ? 'Scan Cancelled' : result.executionMode === 'SIMULATION_MODE' ? 'Simulation Completed' : result.success ? 'Scan Completed - Drive Healthy' : 'Issues Detected'}
            </p>
            <p className="text-xs text-muted mt-1">
              {result.totalChunks.toLocaleString()} chunks scanned in {result.durationSec.toFixed(1)}s
              {result.executionMode === 'REAL_SCAN' ? ` - ${fmtBytes(result.actualBytesRead || 0)} physically read` : ' - simulation excluded from scoring'}
              {result.errorCount > 0 ? ` • ${result.errorCount} read error(s)` : ' • No read errors'}
              {result.slowCount > 0 ? ` • ${result.slowCount} slow sector(s)` : ''}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-5 rounded-xl border border-danger/30 bg-danger/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-danger text-sm">Scan Error</p>
            <p className="text-xs text-muted mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Recommended Actions Block */}
      {(hasSlowSectors || hasBadSectors || hasSmartWarnings) && (
        <div className="glass-card p-5 border border-primary/20 bg-primary/5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Zap className="w-5 h-5 text-primary animate-pulse" />
            </div>
            <div className="flex flex-col">
              <h4 className="text-sm font-black uppercase tracking-wider text-foreground">Recommended Diagnostic Action</h4>
              <p className="text-[11px] text-muted">
                {hasBadSectors ? 'Unreadable bad sectors were detected. Prompt action is advised to safeguard drive integrity.' :
                 hasSlowSectors ? 'Weak/slow sectors were detected. Sector stabilization is recommended to maintain performance.' :
                 'SMART health attributes show warnings. Health analysis is recommended.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {hasSlowSectors && (
              <button
                onClick={() => onNavigateToTab?.('stabilizer')}
                className="px-4 py-2.5 bg-warning/20 border border-warning/40 text-warning hover:bg-warning/30 text-xs font-black rounded-xl transition-all uppercase tracking-wider flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Stabilize Weak Sectors
              </button>
            )}
            {hasBadSectors && (
              <button
                onClick={() => onNavigateToTab?.('stabilizer')}
                className="px-4 py-2.5 bg-danger/20 border border-danger/40 text-danger hover:bg-danger/30 text-xs font-black rounded-xl transition-all uppercase tracking-wider flex items-center gap-2"
              >
                <AlertTriangle className="w-3.5 h-3.5" /> Attempt Sector Repair
              </button>
            )}
            {hasSmartWarnings && (
              <button
                onClick={() => onNavigateToTab?.('diagnostics')}
                className="px-4 py-2.5 bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 text-xs font-black rounded-xl transition-all uppercase tracking-wider flex items-center gap-2"
              >
                <ShieldCheck className="w-3.5 h-3.5" /> Analyze Drive Health
              </button>
            )}
          </div>
        </div>
      )}

      {/* Idle placeholder */}
      {!progress && !result && !error && (
        <div className="glass-card p-16 flex flex-col items-center justify-center gap-5 border-dashed border-white/5 opacity-70">
          <div className="p-5 rounded-3xl bg-primary/10 text-primary border border-primary/20">
            <HardDrive className="w-12 h-12" />
          </div>
          <div className="text-center">
            <p className="text-sm font-black uppercase tracking-widest text-foreground">
              {drive ? `${drive.name}` : 'Select a drive above'}
            </p>
            <p className="text-xs text-muted mt-2">
              {drive ? 'Choose a scan mode, then click Start Scan to begin surface analysis' : 'No drive selected'}
            </p>
          </div>
          {drive && (
            <div className="flex items-center gap-6 text-[11px] text-muted">
              <span><span className="text-foreground font-bold">{fmtBytes(drive.size)}</span> capacity</span>
              <span><span className="text-foreground font-bold">{drive.type}</span></span>
              {drive.temperature && <span><span className="text-foreground font-bold">{drive.temperature}°C</span> temp</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
