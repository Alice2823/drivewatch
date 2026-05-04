import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Shield, Thermometer, HardDrive, AlertTriangle, CheckCircle2,
  Clock, Zap, ChevronDown, ChevronUp, RefreshCw, Terminal,
  Activity, AlertCircle, Info
} from 'lucide-react'
import logo from '../assets/logo.png'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriveInfo {
  diskIndex: number
  name: string
  type: string
  mounts: string[]
  serial: string
  size: number
  temperature: number | null
  isRemovable?: boolean
}

interface SmartAttr {
  id: number
  name: string
  value: number
  worst: number
  thresh: number
  raw: number
  failed: boolean
  critical: boolean
}

interface SmartResult {
  available: boolean
  fallback: boolean
  overallHealth: 'PASSED' | 'FAILED' | 'Unknown'
  temperature: number | null
  powerOnHours: number | null
  attributes: SmartAttr[]
  issues: string[]
  error?: string
}

interface ChkdskResult {
  driveLetter: string
  clean: boolean
  badSectors: number
  errors: number
  rawLines: string[]
  cancelled: boolean
  exitCode: number | null
  error?: string
}

interface HealthScore {
  score: number
  status: 'PASSED' | 'WARNING' | 'FAILED' | 'UNKNOWN'
  issues: string[]
  summary: string
  deductions: { reason: string; points: number }[]
}

interface DriveHealthState {
  drive: DriveInfo
  smart: SmartResult | null
  chkdsk: ChkdskResult | null
  score: HealthScore | null
  scanning: boolean
  chkdskProgress: number
  chkdskLog: string[]
  lastScanned: Date | null
  error: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatHours(hours: number | null): string {
  if (hours === null) return 'Not available'
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 365) return `${days}d`
  return `${Math.floor(days / 365)}y ${Math.floor((days % 365) / 30)}m`
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const k = 1024
  const sz = ['B','KB','MB','GB','TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sz[i]}`
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--color-success)'
  if (score >= 50) return 'var(--color-warning)'
  return 'var(--color-accent)'
}

function scoreBgClass(status: string): string {
  if (status === 'PASSED') return 'bg-success/10 border-success/30 text-success'
  if (status === 'WARNING') return 'bg-warning/10 border-warning/30 text-warning'
  if (status === 'UNKNOWN') return 'bg-surface border-border text-muted'
  return 'bg-accent/10 border-accent/30 text-accent'
}

// ── Arc SVG for health score ──────────────────────────────────────────────────

const ScoreArc: React.FC<{ score: number; status: string }> = ({ score, status }) => {
  const r = 54
  const cx = 64
  const cy = 64
  const circumference = 2 * Math.PI * r
  const arcLength = circumference * 0.75
  const dash = (score / 100) * arcLength
  const gap = arcLength - dash
  const rotation = 135
  const color = scoreColor(score)

  return (
    <svg width="128" height="128" viewBox="0 0 128 128">
      {/* Track */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="var(--color-surface)"
        strokeWidth="10"
        strokeDasharray={`${arcLength} ${circumference - arcLength}`}
        strokeLinecap="round"
        transform={`rotate(${rotation} ${cx} ${cy})`}
      />
      {/* Fill */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeDasharray={`${dash} ${gap + (circumference - arcLength)}`}
        strokeLinecap="round"
        transform={`rotate(${rotation} ${cx} ${cy})`}
        style={{ transition: 'stroke-dasharray 1s cubic-bezier(0.4,0,0.2,1), stroke 0.5s' }}
      />
      {/* Score text */}
      <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--color-foreground)"
        fontSize="24" fontWeight="800" fontFamily="Inter, sans-serif">
        {score}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" fill="var(--color-muted)"
        fontSize="11" fontWeight="700" fontFamily="Inter, sans-serif">
        / 100
      </text>
    </svg>
  )
}

// ── Metric Card ───────────────────────────────────────────────────────────────

const MetricCard: React.FC<{
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  accent?: string
}> = ({ icon, label, value, sub, accent = 'primary' }) => (
  <div className="glass-card p-5 flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <div className={`p-2 rounded-xl bg-${accent}/10 text-${accent} border border-${accent}/20`}>
        {icon}
      </div>
      <span className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{label}</span>
    </div>
    <div className="text-[22px] font-black text-foreground leading-none">{value}</div>
    {sub && <div className="text-[11px] text-muted">{sub}</div>}
  </div>
)

// ── Drive Selector Card ───────────────────────────────────────────────────────

const DriveCard: React.FC<{
  drive: DriveInfo
  selected: boolean
  scanning: boolean
  score: HealthScore | null
  onClick: () => void
}> = ({ drive, selected, scanning, score, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full text-left p-5 rounded-2xl border transition-all duration-200 cursor-pointer ${
      selected
        ? 'border-primary bg-primary/5 shadow-[0_0_20px_rgba(var(--color-primary-rgb),0.15)]'
        : 'border-border bg-card-solid hover:border-primary/50 hover:bg-surface/30'
    } ${scanning ? 'animate-pulse border-primary/50' : ''}`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className={`p-2.5 rounded-xl ${selected ? 'bg-primary/15 text-primary' : 'bg-surface text-muted'} border border-border`}>
          <HardDrive className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground leading-tight truncate max-w-[140px]" title={drive.name}>
            {drive.name}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted mt-0.5">{drive.type}</p>
          <p className="text-[11px] text-muted mt-1">{drive.mounts.join('  ')}</p>
        </div>
      </div>
      {score ? (
        <div className={`flex-shrink-0 px-2.5 py-1 rounded-full border text-[10px] font-extrabold uppercase tracking-wider ${scoreBgClass(score.status)}`}>
          {score.score}%
        </div>
      ) : (
        <div className="flex-shrink-0 px-2.5 py-1 rounded-full border border-border text-[10px] font-extrabold uppercase tracking-wider text-muted">
          --
        </div>
      )}
    </div>
    {drive.temperature !== null && (
      <div className="mt-3 flex items-center gap-1.5">
        <Thermometer className={`w-3 h-3 ${drive.temperature > 55 ? 'text-warning' : 'text-muted'}`} />
        <span className={`text-[11px] font-bold ${drive.temperature > 55 ? 'text-warning' : 'text-muted'}`}>
          {drive.temperature}°C
        </span>
      </div>
    )}
  </button>
)

// ── Main Component ────────────────────────────────────────────────────────────

export const DriveHealthScanner: React.FC = () => {
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [states, setStates] = useState<Record<number, DriveHealthState>>({})
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [showSmartTable, setShowSmartTable] = useState(false)
  const [showChkdskLog, setShowChkdskLog] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  // ── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    window.api.isAdmin().then(setIsAdmin).catch(() => setIsAdmin(false))
    fetchDrives()
  }, [])

  const fetchDrives = async () => {
    try {
      const data = await window.api.health.getDrives()
      setDrives(data)
      if (data.length > 0 && selectedIdx === null) {
        setSelectedIdx(data[0].diskIndex)
      }
      
      setStates(prev => {
        const next = { ...prev }
        for (const d of data) {
          if (!next[d.diskIndex]) {
            next[d.diskIndex] = {
              drive: d,
              smart: null,
              chkdsk: null,
              score: null,
              scanning: false,
              chkdskProgress: 0,
              chkdskLog: [],
              lastScanned: null,
              error: null
            }
          } else {
            next[d.diskIndex].drive = d // update temp etc
          }
        }
        return next
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // ── IPC Listeners ───────────────────────────────────────────────────────────

  useEffect(() => {
    const unSubOutput = window.api.health.onChkdskOutput((data) => {
      setStates(prev => {
        const d = Object.values(prev).find(s => s.drive.mounts.includes(data.driveLetter) || s.drive.mounts.includes(data.driveLetter.replace(':','')))
        if (!d) return prev
        const idx = d.drive.diskIndex
        return {
          ...prev,
          [idx]: {
            ...prev[idx],
            chkdskLog: [...prev[idx].chkdskLog.slice(-199), data.line]
          }
        }
      })
    })

    const unSubProgress = window.api.health.onChkdskProgress((data) => {
      setStates(prev => {
        const d = Object.values(prev).find(s => s.drive.mounts.includes(data.driveLetter) || s.drive.mounts.includes(data.driveLetter.replace(':','')))
        if (!d) return prev
        const idx = d.drive.diskIndex
        return { ...prev, [idx]: { ...prev[idx], chkdskProgress: data.progress } }
      })
    })

    return () => {
      unSubOutput()
      unSubProgress()
    }
  }, [])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [states[selectedIdx ?? -1]?.chkdskLog, showChkdskLog])

  // ── Actions ─────────────────────────────────────────────────────────────────

  const runScan = async (idx: number) => {
    const st = states[idx]
    if (!st || st.scanning) return

    setStates(prev => ({
      ...prev,
      [idx]: {
        ...prev[idx],
        scanning: true,
        chkdskProgress: 0,
        chkdskLog: [],
        error: null
      }
    }))

    try {
      // 1. SMART Scan
      const smart = await window.api.health.runSmart(idx)
      
      // 2. Chkdsk Scan
      let chkdsk: ChkdskResult | null = null
      const mainMount = st.drive.mounts[0]
      if (mainMount) {
        chkdsk = await window.api.health.runChkdsk(mainMount)
      }

      // 3. Calc Score
      const scorePayload = { smart, chkdsk, temperature: st.drive.temperature }
      const score = await window.api.health.getScore(scorePayload)

      setStates(prev => ({
        ...prev,
        [idx]: {
          ...prev[idx],
          smart,
          chkdsk,
          score,
          scanning: false,
          lastScanned: new Date()
        }
      }))
    } catch (err: any) {
      setStates(prev => ({
        ...prev,
        [idx]: {
          ...prev[idx],
          scanning: false,
          error: err.message
        }
      }))
    }
  }

  // ── Render Helpers ──────────────────────────────────────────────────────────

  const activeState = selectedIdx !== null ? states[selectedIdx] : null

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6 animate-fade-in">
        <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
        <p className="text-[14px] font-bold text-muted uppercase tracking-widest">Loading diagnostic modules...</p>
      </div>
    )
  }

  return (
    <div className="animate-fade-in flex flex-col gap-8">
      {isAdmin === false && (
        <div className="p-4 rounded-xl border border-warning/30 bg-warning/5 flex items-start gap-3">
          <Shield className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-warning">Administrator Required</p>
            <p className="text-xs text-muted mt-1">Drive scanning requires administrator privileges. Please restart as administrator.</p>
          </div>
        </div>
      )}

      {/* ── Drive Selection Row ── */}
      <div>
        <h3 className="text-[18px] font-black tracking-tight text-foreground mb-4">Select Drive</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {drives.map(d => (
            <DriveCard
              key={d.diskIndex}
              drive={d}
              selected={selectedIdx === d.diskIndex}
              scanning={states[d.diskIndex]?.scanning ?? false}
              score={states[d.diskIndex]?.score ?? null}
              onClick={() => setSelectedIdx(d.diskIndex)}
            />
          ))}
        </div>
      </div>

      {activeState && (
        <div className="flex flex-col gap-8">
          {/* ── Header / Controls ── */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-card p-6">
            <div>
              <h3 className="text-[24px] font-black text-foreground">Health Dashboard</h3>
              <p className="text-sm text-muted">
                {activeState.drive.name} • {activeState.drive.type} • {formatBytes(activeState.drive.size)}
              </p>
            </div>
            <div className="flex items-center gap-4">
              {activeState.lastScanned && (
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Last Scan</p>
                  <p className="text-sm font-medium text-foreground">{activeState.lastScanned.toLocaleTimeString()}</p>
                </div>
              )}
              <button
                onClick={() => runScan(activeState.drive.diskIndex)}
                disabled={activeState.scanning || isAdmin === false}
                className="btn-primary flex items-center gap-2 px-8 py-3"
              >
                {activeState.scanning ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Activity className="w-4 h-4" />
                    Scan Now
                  </>
                )}
              </button>
            </div>
          </div>

          {/* ── Score / Metrics Grid ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Main Score Card */}
            <div className="glass-card p-6 md:col-span-1 flex flex-col items-center justify-center relative overflow-hidden">
              <div className="absolute top-4 left-4 flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted">Health Score</span>
              </div>
              
              {activeState.score ? (
                <div className="mt-6 flex flex-col items-center">
                  <ScoreArc score={activeState.score.score} status={activeState.score.status} />
                  <div className={`mt-4 px-4 py-1.5 rounded-full border text-xs font-bold uppercase tracking-wider ${scoreBgClass(activeState.score.status)}`}>
                    {activeState.score.status}
                  </div>
                </div>
              ) : (
                <div className="mt-6 flex flex-col items-center opacity-50">
                  <ScoreArc score={0} status="UNKNOWN" />
                  <div className="mt-4 px-4 py-1.5 rounded-full border border-border text-xs font-bold uppercase tracking-wider text-muted">
                    Not Scanned
                  </div>
                </div>
              )}
            </div>

            {/* Metrics */}
            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <MetricCard
                icon={<Thermometer className="w-5 h-5" />}
                label="Temperature"
                value={activeState.drive.temperature ? `${activeState.drive.temperature}°C` : 'Not available'}
                accent={activeState.drive.temperature && activeState.drive.temperature > 55 ? 'warning' : 'primary'}
                sub={activeState.drive.temperature && activeState.drive.temperature > 55 ? 'Elevated temperature' : 'Normal range'}
              />
              <MetricCard
                icon={<Clock className="w-5 h-5" />}
                label="Power-On Time"
                value={formatHours(activeState.smart?.powerOnHours ?? null)}
                accent="primary"
              />
              <div className="glass-card p-5 flex flex-col gap-3">
                 <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                        <HardDrive className="w-5 h-5" />
                      </div>
                      <span className="text-[11px] font-extrabold uppercase tracking-widest text-muted">SMART Status</span>
                    </div>
                    {activeState.smart?.fallback && (
                      <span className="px-2 py-0.5 rounded-md bg-warning/10 border border-warning/20 text-warning text-[9px] font-bold uppercase">
                        {activeState.drive.isRemovable ? 'USB Restricted' : 'WMI Fallback'}
                      </span>
                    )}
                 </div>
                 {activeState.score ? (
                   <div className="flex flex-col mt-1">
                      <div className="flex items-center gap-2">
                        {activeState.score.status === 'PASSED' ? (
                          <CheckCircle2 className="w-6 h-6 text-success" />
                        ) : activeState.score.status === 'FAILED' ? (
                          <AlertTriangle className="w-6 h-6 text-accent" />
                        ) : activeState.score.status === 'WARNING' ? (
                          <AlertCircle className="w-6 h-6 text-warning" />
                        ) : (
                          <Info className="w-6 h-6 text-muted" />
                        )}
                        <span className="text-[20px] font-black text-foreground">{activeState.score.status}</span>
                      </div>
                      <span className="text-xs text-muted mt-1">
                        {activeState.score.status === 'UNKNOWN' && activeState.drive.isRemovable
                          ? 'SMART data pass-through is often blocked by USB enclosures.'
                          : activeState.score.summary}
                      </span>
                   </div>
                 ) : (
                   <div className="text-[20px] font-black text-muted mt-1">Not available</div>
                 )}
              </div>
              <MetricCard
                icon={<Activity className="w-5 h-5" />}
                label="Chkdsk Bad Sectors"
                value={activeState.chkdsk ? (activeState.chkdsk.badSectors === 0 ? '0 KB (Clean)' : `${activeState.chkdsk.badSectors} KB`) : 'Not available'}
                accent={activeState.chkdsk && activeState.chkdsk.badSectors > 0 ? 'accent' : 'primary'}
                sub={activeState.chkdsk && !activeState.chkdsk.clean ? `${activeState.chkdsk.errors} filesystem errors` : activeState.chkdsk?.clean ? 'No bad sectors found' : undefined}
              />
            </div>
          </div>

          {/* ── Issues ── */}
          {activeState.score && (activeState.score.issues ?? []).length > 0 && (
            <div className="p-4 rounded-xl border border-warning/30 bg-warning/5">
              <h4 className="text-xs font-bold uppercase tracking-widest text-warning mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Detected Issues
              </h4>
              <ul className="space-y-2">
                {(activeState.score.issues ?? []).map((issue, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                    <span className="text-warning mt-1">•</span>
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── SMART Attributes Table ── */}
          {activeState.smart && !activeState.smart.fallback && (activeState.smart.attributes ?? []).length > 0 && (
            <div className="glass-card overflow-hidden">
              <button
                className="w-full flex items-center justify-between p-4 hover:bg-surface/30 transition-colors"
                onClick={() => setShowSmartTable(!showSmartTable)}
              >
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-muted" />
                  <span className="text-sm font-bold text-foreground">SMART Attributes</span>
                </div>
                {showSmartTable ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showSmartTable && (
                <div className="p-4 border-t border-border overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead>
                      <tr className="border-b border-border/50 text-[10px] font-bold uppercase tracking-wider text-muted">
                        <th className="p-2">ID</th>
                        <th className="p-2">Attribute Name</th>
                        <th className="p-2">Current</th>
                        <th className="p-2">Worst</th>
                        <th className="p-2">Threshold</th>
                        <th className="p-2">Raw Value</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm text-foreground/80 font-medium">
                      {(activeState.smart.attributes ?? []).map(attr => (
                        <tr key={attr.id} className={`border-b border-border/20 last:border-0 ${attr.failed ? 'bg-accent/5' : ''}`}>
                          <td className="p-2 font-mono text-xs">{attr.id.toString().padStart(3, '0')}</td>
                          <td className={`p-2 ${attr.critical ? 'text-warning font-bold' : ''}`}>{attr.name}</td>
                          <td className="p-2">{attr.value}</td>
                          <td className="p-2">{attr.worst}</td>
                          <td className="p-2">{attr.thresh}</td>
                          <td className="p-2 font-mono text-xs">{attr.raw}</td>
                          <td className="p-2">
                            {attr.failed ? (
                              <span className="text-accent font-bold text-xs uppercase">Failed</span>
                            ) : (
                              <span className="text-success text-xs uppercase">OK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Chkdsk Log ── */}
          {((activeState.chkdskLog ?? []).length > 0 || activeState.chkdsk) && (
            <div className="glass-card overflow-hidden">
              <button
                className="w-full flex items-center justify-between p-4 hover:bg-surface/30 transition-colors"
                onClick={() => setShowChkdskLog(!showChkdskLog)}
              >
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-muted" />
                  <span className="text-sm font-bold text-foreground">
                    Chkdsk Output {activeState.scanning && activeState.chkdskProgress > 0 ? `(${activeState.chkdskProgress}%)` : ''}
                  </span>
                </div>
                {showChkdskLog ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              
              {showChkdskLog && (
                <div className="p-4 border-t border-border">
                  <div ref={logRef} className="scan-log bg-background h-[200px] overflow-y-auto font-mono text-[11px] p-3 rounded-lg border border-border/50">
                    {(activeState.chkdskLog ?? []).length === 0 && activeState.chkdsk && (
                      (activeState.chkdsk.rawLines ?? []).map((line, i) => (
                        <div key={i} className={line.toLowerCase().includes('error') ? 'text-accent' : 'text-foreground/70'}>
                          {line}
                        </div>
                      ))
                    )}
                    {(activeState.chkdskLog ?? []).length > 0 && (
                      (activeState.chkdskLog ?? []).map((line, i) => (
                        <div key={i} className={line.toLowerCase().includes('error') ? 'text-accent' : 'text-foreground/70'}>
                          {line}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              {activeState.scanning && (
                <div className="usage-bar-track h-1 rounded-none">
                  <div className="usage-bar-fill" style={{ width: `${activeState.chkdskProgress}%` }} />
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  )
}
