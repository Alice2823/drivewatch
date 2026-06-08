import React, { useState, useCallback, useEffect } from 'react'
import {
  Shield, RefreshCw, Download, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle, XCircle, Info, Cpu, HardDrive,
  Zap, Activity, ExternalLink, Clock, FileText, Check,
  Usb, Database, ChevronRight
} from 'lucide-react'

// ── Drive classification helpers ──────────────────────────────────────────────
type DriveCategory = 'nvme' | 'sata-ssd' | 'hdd' | 'usb' | 'removable' | 'unknown'
type DriveLocation = 'internal' | 'external' | 'removable'

interface ClassifiedDrive {
  diskIndex: number
  name: string
  type: string
  size: number
  mounts: string[]
  isRemovable: boolean
  serial?: string
  temperature: number | null
  health: string
  category: DriveCategory
  location: DriveLocation
  protocolBadge: string
  locationBadge: string
  smartSupported: boolean
}

function classifyDrive(disk: any): ClassifiedDrive {
  const typeLower = (disk.type || '').toLowerCase()
  const nameLower = (disk.name || '').toLowerCase()
  const isRemovable = disk.isRemovable === true

  let category: DriveCategory = 'unknown'
  let location: DriveLocation = 'internal'
  let protocolBadge = 'UNKNOWN'
  let smartSupported = true

  if (typeLower.includes('nvme') || nameLower.includes('nvme') || nameLower.includes('nvm express')) {
    category = 'nvme'; protocolBadge = 'NVMe'; location = 'internal'
  } else if (typeLower.includes('usb') || typeLower === 'usb') {
    category = 'usb'; protocolBadge = 'USB'; location = 'external'; smartSupported = false
  } else if (typeLower.includes('sata ssd') || (typeLower.includes('sata') && typeLower.includes('ssd'))) {
    category = 'sata-ssd'; protocolBadge = 'SATA'; location = 'internal'
  } else if (typeLower.includes('sata')) {
    category = 'hdd'; protocolBadge = 'SATA'; location = 'internal'
  } else if (typeLower.includes('hdd') || nameLower.includes('hdd')) {
    category = 'hdd'; protocolBadge = 'HDD'; location = 'internal'
  } else if (typeLower.includes('ssd')) {
    category = 'sata-ssd'; protocolBadge = 'SSD'; location = 'internal'
  }

  if (isRemovable) {
    location = 'removable'
    if (category === 'unknown') { category = 'removable'; protocolBadge = 'USB' }
    smartSupported = false
  }

  const locationBadge = location === 'internal' ? 'INTERNAL'
    : location === 'external' ? 'EXTERNAL' : 'REMOVABLE'

  return {
    diskIndex: disk.diskIndex,
    name: disk.name || 'Unknown Drive',
    type: disk.type || 'Unknown',
    size: disk.size || 0,
    mounts: disk.mounts || [],
    isRemovable,
    serial: disk.serial,
    temperature: disk.temperature ?? null,
    health: disk.health || 'Unknown',
    category,
    location,
    protocolBadge,
    locationBadge,
    smartSupported,
  }
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—'
  const gb = bytes / (1024 ** 3)
  if (gb >= 1000) return `${(gb / 1024).toFixed(1)} TB`
  return `${gb.toFixed(0)} GB`
}

// ── Per-drive report cache type ───────────────────────────────────────────────
interface DriveReport {
  diskIndex: number
  scannedAt: Date | null
  scanState: 'idle' | 'scanning' | 'done' | 'error'
  smartAvailable: boolean
  score: number | null
  status: 'healthy' | 'warning' | 'critical' | 'unavailable'
  firmware: any[]
  controllers: any[]
  trimStatus: any[]
  drivers: any[]
  eventLogs: any[]
  recommendations: any[]
  issueCount: Record<string, number>
  scanDurationMs: number
  timestamp: string
  error?: string
}

// ── Types ─────────────────────────────────────────────────────────────────────
type FilterTab = 'all' | 'internal' | 'external' | 'nvme' | 'usb'

const SEV_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  info:     { bg: 'bg-primary/10',      text: 'text-primary',    border: 'border-primary/20',      dot: 'bg-primary' },
  low:      { bg: 'bg-blue-500/10',     text: 'text-blue-400',   border: 'border-blue-500/20',     dot: 'bg-blue-400' },
  medium:   { bg: 'bg-warning/10',      text: 'text-warning',    border: 'border-warning/20',      dot: 'bg-warning' },
  high:     { bg: 'bg-orange-500/10',   text: 'text-orange-400', border: 'border-orange-500/20',   dot: 'bg-orange-400' },
  critical: { bg: 'bg-red-500/10',      text: 'text-red-400',    border: 'border-red-500/20',      dot: 'bg-red-400' },
}

const SEV_ICON: Record<string, React.ReactNode> = {
  info:     <Info className="w-4 h-4" />,
  low:      <Info className="w-4 h-4" />,
  medium:   <AlertTriangle className="w-4 h-4" />,
  high:     <AlertTriangle className="w-4 h-4" />,
  critical: <XCircle className="w-4 h-4" />,
}

const PROTOCOL_STYLES: Record<string, string> = {
  NVMe:     'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  SATA:     'bg-blue-500/15 text-blue-400 border-blue-500/30',
  USB:      'bg-orange-500/15 text-orange-400 border-orange-500/30',
  HDD:      'bg-slate-500/15 text-slate-400 border-slate-500/30',
  SSD:      'bg-violet-500/15 text-violet-400 border-violet-500/30',
  UNKNOWN:  'bg-white/5 text-muted border-white/10',
}

const LOCATION_STYLES: Record<string, string> = {
  INTERNAL:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  EXTERNAL:  'bg-amber-500/10 text-amber-400 border-amber-500/20',
  REMOVABLE: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
}

// ── Severity Badge ────────────────────────────────────────────────────────────
function SeverityBadge({ severity }: { severity: string }) {
  const c = SEV_COLORS[severity] || SEV_COLORS.info
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${c.bg} ${c.text} border ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {severity}
    </span>
  )
}

function ProtocolBadge({ label }: { label: string }) {
  const cls = PROTOCOL_STYLES[label] || PROTOCOL_STYLES.UNKNOWN
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${cls}`}>
      {label}
    </span>
  )
}

function LocationBadge({ label }: { label: string }) {
  const cls = LOCATION_STYLES[label] || 'bg-white/5 text-muted border-white/10'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${cls}`}>
      {label}
    </span>
  )
}

// ── Score Ring ─────────────────────────────────────────────────────────────────
function ScoreRing({ score, status, size = 'lg' }: { score: number; status: string; size?: 'sm' | 'lg' }) {
  const r = size === 'sm' ? 36 : 54
  const viewBox = size === 'sm' ? '0 0 80 80' : '0 0 120 120'
  const cx = size === 'sm' ? 40 : 60
  const cy = size === 'sm' ? 40 : 60
  const sw = size === 'sm' ? 6 : 8
  const circumference = 2 * Math.PI * r
  const safeScore = Math.max(0, Math.min(100, score ?? 0))
  const MIN_VISIBLE_ARC = circumference * 0.02
  const targetOffset = safeScore === 0
    ? circumference - MIN_VISIBLE_ARC
    : circumference - (safeScore / 100) * circumference
  const color = status === 'healthy' ? '#10b981'
    : status === 'warning' ? '#f59e0b'
    : status === 'unavailable' ? '#52525b'   // neutral grey for no-SMART drives
    : '#ef4444'

  const [animatedOffset, setAnimatedOffset] = React.useState(circumference + 0.001)
  React.useEffect(() => {
    const id = setTimeout(() => setAnimatedOffset(targetOffset), 50)
    return () => clearTimeout(id)
  }, [targetOffset])

  const wh = size === 'sm' ? 'w-20 h-20' : 'w-36 h-36'
  const textSize = size === 'sm' ? 'text-xl' : 'text-3xl'

  return (
    <div className={`relative ${wh} flex items-center justify-center`}>
      <svg className="w-full h-full -rotate-90" viewBox={viewBox}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={sw} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={circumference} strokeDashoffset={animatedOffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1), stroke 0.5s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`${textSize} font-black text-foreground`}>{safeScore}</span>
        {size === 'lg' && <span className="text-[10px] font-bold text-muted uppercase tracking-widest">/ 100</span>}
      </div>
    </div>
  )
}

// ── Drive Selector Card ───────────────────────────────────────────────────────
function DriveCard({
  drive, selected, score, status, onClick
}: {
  drive: ClassifiedDrive
  selected: boolean
  score: number | null
  status: string
  onClick: () => void
}) {
  const hasIssues = status === 'warning' || status === 'critical'
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 group relative overflow-hidden
        ${selected
          ? 'bg-primary/10 border-primary/40 shadow-[0_0_20px_rgba(6,182,212,0.12)]'
          : 'bg-surface/30 border-white/5 hover:bg-surface/50 hover:border-white/15'
        }`}
    >
      {selected && (
        <div className="absolute left-0 top-[15%] bottom-[15%] w-[3px] bg-primary rounded-r-full" />
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2 rounded-xl shrink-0 ${selected ? 'bg-primary/20 text-primary' : 'bg-white/5 text-muted group-hover:text-foreground'}`}>
            {drive.category === 'nvme' ? <Zap className="w-4 h-4" /> :
             drive.category === 'usb' || drive.category === 'removable' ? <Usb className="w-4 h-4" /> :
             <HardDrive className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-foreground truncate leading-tight">{drive.name}</p>
            <p className="text-[10px] text-muted mt-0.5">{formatBytes(drive.size)}{drive.mounts.length > 0 ? ` • ${drive.mounts[0]}` : ''}</p>
          </div>
        </div>
        {score !== null ? (
          <ScoreRing score={score} status={status} size="sm" />
        ) : (
          // Fallback: show 0 ring if score somehow still null
          <ScoreRing score={0} status="unavailable" size="sm" />
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-3 flex-wrap">
        <ProtocolBadge label={drive.protocolBadge} />
        <LocationBadge label={drive.locationBadge} />
        {!drive.smartSupported && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-white/[0.04] text-muted/50 border border-white/[0.06]">
            No SMART
          </span>
        )}
        {hasIssues && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border bg-warning/10 text-warning border-warning/20">
            <AlertTriangle className="w-2.5 h-2.5" /> Issues
          </span>
        )}
      </div>
    </button>
  )
}

// ── Collapsible Section ───────────────────────────────────────────────────────
function Section({ title, icon, count, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; count?: number; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="glass-card overflow-hidden animate-fade-in">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">{icon}</div>
          <h3 className="text-sm font-black uppercase tracking-widest text-foreground">{title}</h3>
          {count !== undefined && count > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-warning/15 text-warning text-[10px] font-black border border-warning/20">
              {count} issue{count > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-white/5">{children}</div>}
    </div>
  )
}

// ── Score computation (pure, from filtered data) ──────────────────────────────
function computeScore(
  fw: any[], ctrl: any[], trim: any[], drv: any[], evts: any[]
): { score: number; status: 'healthy' | 'warning' | 'critical' } {
  const WEIGHTS: Record<string, number> = { info: 0, low: 3, medium: 10, high: 20, critical: 40 }
  const CAPS: Record<string, number> = { firmware: 25, drivers: 20, controllers: 15, trim: 10, events: 30 }
  const deductions: Record<string, number> = { firmware: 0, drivers: 0, controllers: 0, trim: 0, events: 0 }

  const add = (cat: string, sev: string) => {
    const w = WEIGHTS[sev] || 0; if (!w) return
    const cap = CAPS[cat] ?? 25; if (deductions[cat] >= cap) return
    const eff = deductions[cat] === 0 ? w : w * 0.3
    deductions[cat] = Math.min(cap, deductions[cat] + eff)
  }

  for (const x of fw)   add('firmware',    x.severity)
  for (const x of drv)  add('drivers',     x.severity)
  for (const x of ctrl) add('controllers', x.severity)
  for (const x of trim) add('trim',        x.severity)
  for (const x of evts) add('events',      x.severity)

  const total = Object.values(deductions).reduce((a, b) => a + b, 0)
  const score = Math.max(0, Math.min(100, Math.round(100 - total)))
  const status: 'healthy' | 'warning' | 'critical' = score < 60 ? 'critical' : score < 85 ? 'warning' : 'healthy'
  return { score, status }
}

// ── Filter tabs ───────────────────────────────────────────────────────────────
const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all',      label: 'All' },
  { id: 'internal', label: 'Internal' },
  { id: 'external', label: 'External' },
  { id: 'nvme',     label: 'NVMe' },
  { id: 'usb',      label: 'USB' },
]

function matchesFilter(drive: ClassifiedDrive, tab: FilterTab, score: number | null, status: string): boolean {
  if (tab === 'all') return true
  if (tab === 'internal') return drive.location === 'internal'
  if (tab === 'external') return drive.location === 'external' || drive.location === 'removable'
  if (tab === 'nvme') return drive.category === 'nvme'
  if (tab === 'usb') return drive.category === 'usb' || drive.category === 'removable'
  return true
}

// ── Main Component ────────────────────────────────────────────────────────────
export const StorageHealthCenter: React.FC = React.memo(() => {
  // Per-drive isolated report cache: keyed by "disk_N" or "all"
  const [driveReports, setDriveReports] = useState<Record<string, DriveReport>>({})
  // Which disk index is currently being scanned (null = global/initial scan)
  const [scanningDiskIndex, setScanningDiskIndex] = useState<number | null>(null)
  const [globalScanState, setGlobalScanState] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)

  const [exporting, setExporting] = useState(false)
  const [exportJson, setExportJson] = useState(false)
  const [exportSuccess, setExportSuccess] = useState<{ path: string; type: 'pdf' | 'json' } | null>(null)

  const [drives, setDrives] = useState<ClassifiedDrive[]>([])
  const [selectedDiskIndex, setSelectedDiskIndex] = useState<number | null>(null)
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Load drives on mount
  useEffect(() => {
    window.api.getDiskData().then((disks: any[]) => {
      if (Array.isArray(disks)) {
        setDrives(disks.map(classifyDrive))
      }
    }).catch(() => {})
  }, [])

  // Distribute a raw global scan result into per-drive slots
  const distributeReport = useCallback((rawReport: any, allDrives: ClassifiedDrive[]) => {
    setDriveReports(prev => {
      const next = { ...prev }

      // Store the full global result under "all"
      const globalIssueCount = countIssues(
        rawReport.firmware || [],
        rawReport.drivers || [],
        rawReport.controllers || [],
        rawReport.trimStatus || [],
        rawReport.eventLogs || []
      )
      const globalScoreResult = computeScore(
        rawReport.firmware || [],
        rawReport.controllers || [],
        rawReport.trimStatus || [],
        rawReport.drivers || [],
        rawReport.eventLogs || []
      )
      next['all'] = {
        diskIndex: -1,
        scannedAt: new Date(),
        scanState: rawReport.error ? 'error' : 'done',
        smartAvailable: true,
        score: globalScoreResult.score,
        status: globalScoreResult.status,
        firmware: rawReport.firmware || [],
        controllers: rawReport.controllers || [],
        trimStatus: rawReport.trimStatus || [],
        drivers: rawReport.drivers || [],
        eventLogs: rawReport.eventLogs || [],
        recommendations: rawReport.recommendations || [],
        issueCount: globalIssueCount,
        scanDurationMs: rawReport.scanDurationMs || 0,
        timestamp: rawReport.timestamp || new Date().toISOString(),
        error: rawReport.error,
      }

      // Distribute to per-drive slots
      for (const drive of allDrives) {
        const key = `disk_${drive.diskIndex}`

        // USB/removable drives: no SMART, but compute real score from drivers + events
        if (!drive.smartSupported) {
          const drv  = rawReport.drivers   || []
          const evts = rawReport.eventLogs || []
          // Score based only on system-wide drivers and events (no SMART/firmware/trim)
          const scoreResult = computeScore([], [], [], drv, evts)
          const issueCount  = countIssues([], drv, [], [], evts)
          next[key] = {
            diskIndex: drive.diskIndex,
            scannedAt: new Date(),
            scanState: 'done',
            smartAvailable: false,
            score: scoreResult.score,
            status: scoreResult.status,
            firmware: [],
            controllers: [],
            trimStatus: [],
            drivers: drv,
            eventLogs: evts,
            recommendations: [],
            issueCount,
            scanDurationMs: rawReport.scanDurationMs || 0,
            timestamp: rawReport.timestamp || new Date().toISOString(),
          }
          continue
        }

        const fw   = (rawReport.firmware    || []).filter((f: any) => f.diskIndex === drive.diskIndex)
        const ctrl = (rawReport.controllers || []).filter((c: any) => c.diskIndex === drive.diskIndex)
        const trim = (rawReport.trimStatus  || []).filter((t: any) => t.diskIndex === drive.diskIndex)
        const drv  = rawReport.drivers   || []
        const evts = rawReport.eventLogs || []

        const scoreResult = computeScore(fw, ctrl, trim, drv, evts)
        const issueCount  = countIssues(fw, drv, ctrl, trim, evts)

        // Filter recommendations to this drive
        const driveName   = drive.name
        const driveSerial = drive.serial
        const recs = (rawReport.recommendations || []).filter((r: any) =>
          !r.affectedDisk ||
          r.affectedDisk === driveName ||
          r.affectedDisk === driveSerial
        )

        next[key] = {
          diskIndex: drive.diskIndex,
          scannedAt: new Date(),
          scanState: rawReport.error ? 'error' : 'done',
          smartAvailable: true,
          score: scoreResult.score,
          status: scoreResult.status,
          firmware: fw,
          controllers: ctrl,
          trimStatus: trim,
          drivers: drv,
          eventLogs: evts,
          recommendations: recs,
          issueCount,
          scanDurationMs: rawReport.scanDurationMs || 0,
          timestamp: rawReport.timestamp || new Date().toISOString(),
          error: rawReport.error,
        }
      }

      return next
    })
  }, [])

  // Helper: count issues across all categories
  function countIssues(
    fw: any[], drv: any[], ctrl: any[], trim: any[], evts: any[]
  ): Record<string, number> {
    const counts: Record<string, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 }
    for (const x of [...fw, ...drv, ...ctrl, ...trim, ...evts]) {
      const s = x.severity as string
      if (s in counts) counts[s]++
    }
    return counts
  }

  // Run a global scan and distribute results
  const runScan = useCallback(async (force = false) => {
    // Mark the selected drive (or global) as scanning
    const scanKey = selectedDiskIndex !== null ? `disk_${selectedDiskIndex}` : 'all'
    setScanningDiskIndex(selectedDiskIndex)
    setGlobalScanState('scanning')
    setProgress(0)

    // Optimistically mark the target slot as scanning
    setDriveReports(prev => {
      const next = { ...prev }
      if (next[scanKey]) {
        next[scanKey] = { ...next[scanKey], scanState: 'scanning' }
      }
      return next
    })

    const interval = setInterval(() => setProgress(p => Math.min(p + Math.random() * 15, 90)), 400)
    try {
      const result = await window.api.diagnostics.scan(force)
      // We need the current drives list — capture via closure from state
      setDrives(currentDrives => {
        distributeReport(result, currentDrives)
        return currentDrives
      })
      setProgress(100)
      setGlobalScanState(result.error ? 'error' : 'done')
    } catch {
      setGlobalScanState('error')
      setDriveReports(prev => {
        const next = { ...prev }
        if (next[scanKey]) {
          next[scanKey] = { ...next[scanKey], scanState: 'error' }
        }
        return next
      })
    } finally {
      clearInterval(interval)
      setScanningDiskIndex(null)
      setTimeout(() => setProgress(0), 600)
    }
  }, [selectedDiskIndex, distributeReport])

  // Initial scan on mount
  useEffect(() => { runScan(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleExport = useCallback(async (type: 'pdf' | 'json' = 'pdf') => {
    if (type === 'pdf') setExporting(true)
    else setExportJson(true)
    setExportSuccess(null)
    try {
      const result = type === 'pdf'
        ? await window.api.diagnostics.exportReport()
        : await window.api.diagnostics.exportJson()
      if (result.success) {
        setExportSuccess({ path: result.filePath!, type })
        setTimeout(() => setExportSuccess(null), 10000)
      } else {
        alert(`Export failed: ${result.error}`)
      }
    } finally {
      setExporting(false)
      setExportJson(false)
    }
  }, [])

  const openFile  = (p: string) => window.electron.shell.openPath(p)
  const openFolder = (p: string) => window.electron.shell.showItemInFolder(p)

  // ── Derive active report for the right panel ──────────────────────────────
  const activeReport: DriveReport | null = React.useMemo(() => {
    if (selectedDiskIndex === null) return driveReports['all'] ?? null
    return driveReports[`disk_${selectedDiskIndex}`] ?? null
  }, [selectedDiskIndex, driveReports])

  // ── Per-drive scores for sidebar cards ───────────────────────────────────
  const driveScores = React.useMemo(() => {
    const map: Record<number, { score: number | null; status: string }> = {}
    for (const d of drives) {
      const r = driveReports[`disk_${d.diskIndex}`]
      if (r) {
        map[d.diskIndex] = { score: r.score, status: r.status }
      } else {
        map[d.diskIndex] = { score: null, status: 'healthy' }
      }
    }
    return map
  }, [drives, driveReports])

  // Global score for the "All Drives" sidebar entry
  const globalScore = React.useMemo(() => {
    const r = driveReports['all']
    if (!r) return { score: 100, status: 'healthy' }
    return { score: r.score ?? 100, status: r.status === 'unavailable' ? 'healthy' : r.status }
  }, [driveReports])

  // Filtered drives for sidebar
  const filteredDrives = React.useMemo(() =>
    drives.filter(d => {
      const ds = driveScores[d.diskIndex] || { score: null, status: 'healthy' }
      return matchesFilter(d, filterTab, ds.score, ds.status)
    }),
    [drives, filterTab, driveScores]
  )

  const selectedDrive = selectedDiskIndex !== null
    ? drives.find(d => d.diskIndex === selectedDiskIndex) ?? null
    : null

  // Is the selected drive currently scanning?
  const isSelectedScanning = scanningDiskIndex === selectedDiskIndex && globalScanState === 'scanning'
  const isInitialScan = globalScanState === 'scanning' && !driveReports['all']

  // ── Full-screen scanning state (initial scan only) ────────────────────────
  if (isInitialScan) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-8 animate-fade-in">
        <div className="relative flex items-center justify-center">
          <div className="absolute w-24 h-24 rounded-full border-[3px] border-primary/10" />
          <div className="absolute w-24 h-24 rounded-full border-[3px] border-t-primary border-r-transparent border-b-transparent border-l-transparent animate-spin duration-1000 shadow-[0_0_20px_rgba(14,165,233,0.3)]" />
          <div className="absolute w-24 h-24 rounded-full border-[1px] border-white/5 animate-ping duration-[3000ms]" />
          <div className="relative z-10 w-16 h-16 rounded-3xl bg-primary/10 flex items-center justify-center border border-primary/20 backdrop-blur-sm">
            <Shield className="w-8 h-8 text-primary animate-pulse" />
          </div>
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-lg font-black text-foreground uppercase tracking-[0.2em] animate-pulse">
            Diagnostic <span className="text-primary">Scan</span> In Progress
          </h2>
          <p className="text-xs text-muted font-medium tracking-wide max-w-[300px] mx-auto leading-relaxed">
            Analysing firmware, drivers, controllers and storage health...
          </p>
        </div>
        <div className="relative w-72">
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden border border-white/[0.02]">
            <div className="h-full bg-gradient-to-r from-primary/50 to-primary rounded-full transition-all duration-500 ease-out shadow-[0_0_15px_rgba(14,165,233,0.4)]"
              style={{ width: `${progress}%` }} />
          </div>
          <div className="absolute -bottom-6 left-0 right-0 flex justify-between px-1">
            <span className="text-[10px] font-black text-primary uppercase tracking-widest">{progress.toFixed(0)}% Complete</span>
            <span className="text-[10px] font-bold text-muted/40 uppercase tracking-widest">Secure Engine v1.2</span>
          </div>
        </div>
      </div>
    )
  }

  // ── Determine what to show in the right panel ─────────────────────────────
  // If no report yet for this drive, show "not scanned" state
  const showNotScanned = !activeReport && !isInitialScan

  // Extract data from active report (safe defaults)
  const firmware        = activeReport?.firmware        ?? []
  const drivers         = activeReport?.drivers         ?? []
  const controllers     = activeReport?.controllers     ?? []
  const trimStatus      = activeReport?.trimStatus      ?? []
  const eventLogs       = activeReport?.eventLogs       ?? []
  const recommendations = activeReport?.recommendations ?? []
  const issueCount      = activeReport?.issueCount      ?? {}
  const totalIssues     = ((issueCount.medium as number) || 0) + ((issueCount.high as number) || 0) + ((issueCount.critical as number) || 0)

  // Active score for the header ring
  const activeScore = activeReport
    ? { score: activeReport.score ?? 100, status: activeReport.status === 'unavailable' ? 'healthy' : activeReport.status }
    : { score: 100, status: 'healthy' }

  return (
    <div className="flex gap-6 animate-fade-in min-h-0">

      {/* ── LEFT SIDEBAR: Drive Selector ─────────────────────────────────── */}
      <div className={`flex flex-col gap-3 shrink-0 transition-all duration-300 ${sidebarOpen ? 'w-[260px]' : 'w-0 overflow-hidden'}`}>

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-1">
          {FILTER_TABS.map(tab => (
            <button key={tab.id} onClick={() => setFilterTab(tab.id)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all
                ${filterTab === tab.id
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'bg-white/5 text-muted border border-white/5 hover:bg-white/10 hover:text-foreground'
                }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* All Drives option */}
        <button
          onClick={() => setSelectedDiskIndex(null)}
          className={`w-full text-left p-3 rounded-xl border transition-all duration-200 flex items-center gap-3
            ${selectedDiskIndex === null
              ? 'bg-primary/10 border-primary/40'
              : 'bg-surface/20 border-white/5 hover:bg-surface/40 hover:border-white/10'
            }`}
        >
          <div className={`p-1.5 rounded-lg ${selectedDiskIndex === null ? 'bg-primary/20 text-primary' : 'bg-white/5 text-muted'}`}>
            <Database className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-foreground">All Drives</p>
            <p className="text-[10px] text-muted">{drives.length} device{drives.length !== 1 ? 's' : ''} detected</p>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className={`text-sm font-black ${globalScore.status === 'healthy' ? 'text-success' : globalScore.status === 'warning' ? 'text-warning' : 'text-red-400'}`}>
              {globalScore.score}
            </span>
            <span className="text-[9px] text-muted">/ 100</span>
          </div>
        </button>

        {/* Drive cards */}
        <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-320px)] custom-scrollbar pr-1">
          {filteredDrives.length === 0 && (
            <p className="text-xs text-muted text-center py-6">No drives match this filter</p>
          )}
          {filteredDrives.map(drive => {
            const ds = driveScores[drive.diskIndex] || { score: null, status: 'healthy' }
            return (
              <DriveCard
                key={drive.diskIndex}
                drive={drive}
                selected={selectedDiskIndex === drive.diskIndex}
                score={ds.score ?? null}
                status={ds.status}
                onClick={() => setSelectedDiskIndex(drive.diskIndex)}
              />
            )
          })}
        </div>
      </div>

      {/* ── RIGHT PANEL: Diagnostics ──────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col gap-6">

        {/* Toggle sidebar button */}
        <button onClick={() => setSidebarOpen(v => !v)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1 rounded-r-lg bg-surface/80 border border-white/10 text-muted hover:text-foreground transition-colors hidden">
          <ChevronRight className={`w-3 h-3 transition-transform ${sidebarOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* ── Header: Score + Drive Info ──────────────────────────────────── */}
        <div className="glass-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-5">
              {/* Score ring — always show for all drives including USB.
                  USB drives show score=0 with a dashed neutral ring (not orange icon).
                  Scanning state shows spinner overlay. */}
              {isSelectedScanning ? (
                <div className="w-36 h-36 flex flex-col items-center justify-center rounded-2xl bg-primary/5 border border-primary/20 gap-2 shrink-0">
                  <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                  <span className="text-[10px] font-black text-primary uppercase tracking-widest text-center leading-tight px-2">
                    Scanning...
                  </span>
                </div>
              ) : selectedDrive && !selectedDrive.smartSupported ? (
                // USB drives: show real score ring (based on drivers/events)
                <ScoreRing score={activeScore.score} status={activeScore.status} size="lg" />
              ) : (
                <ScoreRing score={activeScore.score} status={activeScore.status} size="lg" />
              )}
              <div>
                {selectedDrive ? (
                  <>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h2 className="text-base font-black text-foreground truncate max-w-[280px]">{selectedDrive.name}</h2>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mb-2">
                      <ProtocolBadge label={selectedDrive.protocolBadge} />
                      <LocationBadge label={selectedDrive.locationBadge} />
                      {!selectedDrive.smartSupported && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border bg-white/5 text-muted border-white/10">
                          SMART Unavailable
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-[11px] text-muted">
                      {selectedDrive.size > 0 && <span>{formatBytes(selectedDrive.size)}</span>}
                      {selectedDrive.mounts.length > 0 && <span>{selectedDrive.mounts.join(', ')}</span>}
                      {selectedDrive.temperature !== null && (
                        <span className={selectedDrive.temperature > 55 ? 'text-warning' : 'text-muted'}>
                          {selectedDrive.temperature}°C
                        </span>
                      )}
                      {selectedDrive.serial && <span className="font-mono text-[10px]">{selectedDrive.serial}</span>}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-lg font-black uppercase tracking-wide ${
                        activeScore.status === 'healthy' ? 'text-success' : activeScore.status === 'warning' ? 'text-warning' : 'text-red-400'
                      }`}>
                        {activeScore.status === 'healthy' ? 'All Systems Healthy' : activeScore.status === 'warning' ? 'Issues Detected' : 'Critical Issues'}
                      </span>
                    </div>
                    <p className="text-xs text-muted flex items-center gap-2 mb-2">
                      <Clock className="w-3 h-3" />
                      Scanned in {activeReport?.scanDurationMs || 0}ms • {activeReport ? new Date(activeReport.timestamp).toLocaleTimeString() : '—'}
                    </p>
                  </>
                )}
                <div className="flex gap-1.5 flex-wrap">
                  {Object.entries(issueCount as Record<string, number>).filter(([, v]) => v > 0).map(([k, v]) => (
                    <span key={k} className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${SEV_COLORS[k]?.bg} ${SEV_COLORS[k]?.text} ${SEV_COLORS[k]?.border}`}>
                      {v} {k}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 relative shrink-0">
              {exportSuccess && (
                <div className="absolute top-[-60px] right-0 flex items-center gap-3 p-3 rounded-xl bg-success/15 border border-success/30 animate-in fade-in slide-in-from-top-4 duration-300 z-10 whitespace-nowrap">
                  <div className="flex items-center gap-2 text-success text-xs font-black uppercase tracking-wider">
                    <Check className="w-4 h-4" /> {exportSuccess.type === 'pdf' ? 'PDF' : 'JSON'} Exported
                  </div>
                  <div className="h-4 w-[1px] bg-success/30 mx-1" />
                  <button onClick={() => openFile(exportSuccess.path)} className="text-[10px] font-black uppercase text-success hover:underline">Open</button>
                  <button onClick={() => openFolder(exportSuccess.path)} className="text-[10px] font-black uppercase text-success hover:underline">Folder</button>
                  <button onClick={() => setExportSuccess(null)} className="ml-2 text-success/50 hover:text-success"><XCircle className="w-4 h-4" /></button>
                </div>
              )}
              <button onClick={() => runScan(true)} disabled={globalScanState === 'scanning'}
                className="btn-primary text-xs gap-2 h-9 px-4">
                <RefreshCw className={`w-4 h-4 ${globalScanState === 'scanning' ? 'animate-spin' : ''}`} />
                {selectedDrive ? 'Rescan' : 'Rescan All'}
              </button>
              <div className="flex rounded-xl overflow-hidden border border-primary/30">
                <button onClick={() => handleExport('pdf')} disabled={exporting}
                  className="flex items-center gap-2 h-9 px-3 bg-primary text-white text-xs font-black uppercase tracking-widest hover:bg-primary/90 transition-colors disabled:opacity-50">
                  <FileText className="w-3.5 h-3.5" /> {exporting ? '...' : 'PDF'}
                </button>
                <div className="w-[1px] bg-white/10" />
                <button onClick={() => handleExport('json')} disabled={exportJson}
                  className="flex items-center justify-center w-9 h-9 bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
                  title="Export JSON">
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* SMART unavailable notice — only show for non-USB drives that lack SMART */}
          {selectedDrive && !selectedDrive.smartSupported && selectedDrive.category !== 'usb' && selectedDrive.category !== 'removable' && (
            <div className="mt-4 flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/10">
              <Info className="w-4 h-4 text-muted shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted leading-relaxed">
                <span className="font-bold text-foreground/70">SMART telemetry not available</span> for this device.
                Health data cannot be retrieved for this device type.
              </p>
            </div>
          )}

          {/* Scanning in-progress notice (rescan, not initial) */}
          {isSelectedScanning && (
            <div className="mt-4">
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden border border-white/[0.02]">
                <div className="h-full bg-gradient-to-r from-primary/50 to-primary rounded-full transition-all duration-500 ease-out shadow-[0_0_15px_rgba(14,165,233,0.4)]"
                  style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* ── Not yet scanned state ────────────────────────────────────────── */}
        {showNotScanned && (
          <div className="glass-card p-10 flex flex-col items-center justify-center gap-4 text-center">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <HardDrive className="w-8 h-8 text-muted" />
            </div>
            <div>
              <p className="text-sm font-black text-foreground uppercase tracking-widest mb-1">Not Yet Scanned</p>
              <p className="text-xs text-muted">Click Scan to analyse this drive's health data.</p>
            </div>
            <button onClick={() => runScan(true)} className="btn-primary text-xs gap-2 h-9 px-4">
              <RefreshCw className="w-4 h-4" /> Scan
            </button>
          </div>
        )}

        {/* ── USB unavailable panel + available system data ────────────────── */}
        {!showNotScanned && selectedDrive && !selectedDrive.smartSupported && (
          <div className="flex flex-col gap-4">
            {/* SMART unavailable card */}
            <div className="glass-card p-6 flex items-start gap-5">
              <div className="p-3 rounded-2xl bg-orange-500/10 border border-orange-500/20 shrink-0">
                <Usb className="w-6 h-6 text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-orange-400 uppercase tracking-widest mb-1">SMART Unavailable</p>
                <p className="text-xs text-muted leading-relaxed max-w-[480px]">
                  USB bridge controllers block SMART passthrough — this is normal for USB drives and does not indicate a problem.
                  Drive capacity, temperature (if available), and system-level driver data are shown below.
                </p>
                <div className="flex gap-3 flex-wrap mt-3 text-[11px] text-muted">
                  {selectedDrive.size > 0 && (
                    <span className="px-3 py-1 rounded-lg bg-white/5 border border-white/10">{formatBytes(selectedDrive.size)}</span>
                  )}
                  {selectedDrive.mounts.length > 0 && (
                    <span className="px-3 py-1 rounded-lg bg-white/5 border border-white/10">{selectedDrive.mounts.join(', ')}</span>
                  )}
                  {selectedDrive.temperature !== null && (
                    <span className={`px-3 py-1 rounded-lg border ${selectedDrive.temperature > 55 ? 'bg-warning/10 border-warning/20 text-warning' : 'bg-white/5 border-white/10'}`}>
                      {selectedDrive.temperature}°C
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Show system-wide driver data — still useful for USB drives */}
            {drivers.length > 0 && (
              <Section title="Driver Status (System-Wide)" icon={<Activity className="w-5 h-5" />}
                count={drivers.filter((d: any) => d.severity !== 'info').length}>
                <p className="text-[10px] text-muted/60 mt-3 mb-2 italic">
                  Storage drivers are system-wide. These apply to all connected drives including USB.
                </p>
                <div className="space-y-3 mt-1">
                  {drivers.map((drv: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-surface/30 border border-white/5 hover:border-white/10 transition-colors">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${drv.hasError ? 'bg-red-400' : drv.hasWarning ? 'bg-warning' : drv.isGenericDriver ? 'bg-orange-400' : 'bg-success'}`} />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-foreground truncate">{drv.deviceName}</p>
                          <p className="text-[10px] text-muted">{drv.driverProvider} • v{drv.driverVersion} • {drv.driverDate}</p>
                          {drv.issues.length > 0 && <p className="text-[10px] text-warning mt-1">{drv.issues[0]}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        {drv.isGenericDriver && <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-orange-500/15 text-orange-400 border border-orange-500/20">Generic</span>}
                        <SeverityBadge severity={drv.severity} />
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Show event logs for USB drives too */}
            {eventLogs.length > 0 && (
              <Section title="System Event Logs" icon={<Shield className="w-5 h-5" />}
                count={eventLogs.filter((e: any) => e.severity === 'critical' || e.severity === 'high').length}
                defaultOpen={false}>
                <p className="text-[10px] text-muted/60 mt-3 mb-2 italic">
                  Windows disk events are system-wide and may include USB device activity.
                </p>
                <div className="space-y-2 mt-1 max-h-[300px] overflow-y-auto custom-scrollbar">
                  {eventLogs.map((evt: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-surface/20 border border-white/5 text-[11px]">
                      <div className={SEV_COLORS[evt.severity]?.text || 'text-muted'}>{SEV_ICON[evt.severity]}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-bold text-foreground">{evt.source}</span>
                          <span className="text-muted">ID: {evt.eventId}</span>
                          <span className="text-muted/60">{new Date(evt.timeCreated).toLocaleString()}</span>
                        </div>
                        <p className="text-muted leading-relaxed break-words">{evt.message}</p>
                      </div>
                      <SeverityBadge severity={evt.severity} />
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}

        {/* ── Recommendations ─────────────────────────────────────────────── */}
        {!showNotScanned && !isSelectedScanning && recommendations.length > 0 && (
          <Section title="Recommendations" icon={<AlertTriangle className="w-5 h-5" />} count={totalIssues} defaultOpen>
            <div className="space-y-3 mt-4">
              {recommendations.map((rec: any) => {
                const c = SEV_COLORS[rec.severity] || SEV_COLORS.info
                return (
                  <div key={rec.id} className={`flex items-start gap-3 p-4 rounded-xl border ${c.border} ${c.bg}`}>
                    <div className={c.text}>{SEV_ICON[rec.severity]}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black text-foreground">{rec.title}</p>
                      <p className="text-[11px] text-muted mt-1 leading-relaxed">{rec.description}</p>
                      {rec.actionUrl && (
                        <button onClick={() => window.electron.shell.openExternal(rec.actionUrl)}
                          className="inline-flex items-center gap-1 text-[10px] font-bold text-primary mt-2 hover:underline">
                          <ExternalLink className="w-3 h-3" /> Visit manufacturer
                        </button>
                      )}
                    </div>
                    <SeverityBadge severity={rec.severity} />
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* ── Firmware Status ──────────────────────────────────────────────── */}
        {!showNotScanned && !isSelectedScanning && !(selectedDrive && !selectedDrive.smartSupported) && (
          <Section title="Firmware Status" icon={<Cpu className="w-5 h-5" />}
            count={firmware.filter((f: any) => f.severity !== 'info').length}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              {firmware.map((fw: any, i: number) => (
                <div key={i} className="p-4 rounded-xl bg-surface/30 border border-white/5 hover:border-white/10 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <HardDrive className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-xs font-black text-foreground truncate max-w-[180px]">{fw.model}</span>
                    </div>
                    <SeverityBadge severity={fw.severity} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                    <div><span className="text-muted font-bold">Firmware:</span> <span className="text-foreground font-semibold">{fw.firmwareVersion}</span></div>
                    <div><span className="text-muted font-bold">Interface:</span> <span className="text-foreground font-semibold">{fw.interfaceType}</span></div>
                    <div><span className="text-muted font-bold">Serial:</span> <span className="text-foreground/70 font-mono text-[10px]">{fw.serial || 'N/A'}</span></div>
                    {fw.updateAvailable && <div className="text-warning font-bold">⚠ Update Available</div>}
                  </div>
                  {fw.issues.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/5 space-y-1">
                      {fw.issues.map((issue: string, j: number) => (
                        <p key={j} className="text-[10px] text-warning/80 leading-relaxed">• {issue}</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {firmware.length === 0 && (
                <p className="text-xs text-muted col-span-2 py-4 text-center">
                  {selectedDrive ? `No firmware data for ${selectedDrive.name}` : 'No firmware data available'}
                </p>
              )}
            </div>
          </Section>
        )}

        {/* ── Driver Status ────────────────────────────────────────────────── */}
        {!showNotScanned && !isSelectedScanning && !(selectedDrive && !selectedDrive.smartSupported) && (
          <Section title={`Driver Status${selectedDrive ? ' (System-Wide)' : ''}`}
            icon={<Activity className="w-5 h-5" />}
            count={drivers.filter((d: any) => d.severity !== 'info').length}>
            {selectedDrive && (
              <p className="text-[10px] text-muted/60 mt-3 mb-1 italic">
                Storage drivers are system-wide and not specific to a single drive.
              </p>
            )}
            <div className="space-y-3 mt-3">
              {drivers.map((drv: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-surface/30 border border-white/5 hover:border-white/10 transition-colors">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${drv.hasError ? 'bg-red-400' : drv.hasWarning ? 'bg-warning' : drv.isGenericDriver ? 'bg-orange-400' : 'bg-success'}`} />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-foreground truncate">{drv.deviceName}</p>
                      <p className="text-[10px] text-muted">{drv.driverProvider} • v{drv.driverVersion} • {drv.driverDate}</p>
                      {drv.issues.length > 0 && <p className="text-[10px] text-warning mt-1">{drv.issues[0]}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {drv.isGenericDriver && <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-orange-500/15 text-orange-400 border border-orange-500/20">Generic</span>}
                    <SeverityBadge severity={drv.severity} />
                  </div>
                </div>
              ))}
              {drivers.length === 0 && <p className="text-xs text-muted py-4 text-center">No driver data available</p>}
            </div>
          </Section>
        )}

        {/* ── Controller Status ────────────────────────────────────────────── */}
        {!showNotScanned && !isSelectedScanning && !(selectedDrive && !selectedDrive.smartSupported) && (
          <Section title="Controller & PCIe Status" icon={<Zap className="w-5 h-5" />}
            count={controllers.filter((c: any) => c.severity !== 'info').length} defaultOpen={false}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              {controllers.map((ctrl: any, i: number) => (
                <div key={i} className="p-4 rounded-xl bg-surface/30 border border-white/5">
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-xs font-black text-foreground truncate max-w-[220px]">{ctrl.model}</span>
                    <SeverityBadge severity={ctrl.severity} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div><span className="text-muted font-bold">Controller:</span> <span className="text-foreground/80">{ctrl.controllerName}</span></div>
                    <div><span className="text-muted font-bold">Interface:</span> <span className="text-foreground/80">{ctrl.interfaceType}</span></div>
                    {ctrl.pcieGeneration && <div><span className="text-muted font-bold">PCIe Gen:</span> <span className="text-foreground/80">{ctrl.pcieGeneration}</span></div>}
                    {ctrl.pcieLinkWidth && <div><span className="text-muted font-bold">Link Width:</span> <span className="text-foreground/80">x{ctrl.pcieLinkWidth}</span></div>}
                    {ctrl.isBandwidthLimited && <div className="col-span-2 text-warning font-bold text-[10px] mt-1">⚠ Bandwidth Limited</div>}
                  </div>
                  {ctrl.issues.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/5 space-y-1">
                      {ctrl.issues.map((issue: string, j: number) => (
                        <p key={j} className="text-[10px] text-muted leading-relaxed">• {issue}</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {controllers.length === 0 && (
                <p className="text-xs text-muted col-span-2 py-4 text-center">
                  {selectedDrive ? `No controller data for ${selectedDrive.name}` : 'No controller data available'}
                </p>
              )}
            </div>
          </Section>
        )}

        {/* ── TRIM Status ──────────────────────────────────────────────────── */}
        {!showNotScanned && !isSelectedScanning && !(selectedDrive && !selectedDrive.smartSupported) && (
          <Section title="TRIM Status" icon={<CheckCircle className="w-5 h-5" />}
            count={trimStatus.filter((t: any) => t.severity !== 'info').length} defaultOpen={false}>
            <div className="space-y-3 mt-4">
              {trimStatus.map((trim: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-surface/30 border border-white/5">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${trim.trimEnabled ? 'bg-success/15 text-success' : trim.isSSD ? 'bg-warning/15 text-warning' : 'bg-white/5 text-muted'}`}>
                      {trim.trimEnabled ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-foreground">{trim.model}</p>
                      <p className="text-[10px] text-muted">
                        {trim.isSSD ? 'SSD' : 'HDD'} • {trim.fileSystem} • TRIM {trim.trimEnabled ? 'Enabled ✓' : trim.isSSD ? 'Disabled ✗' : 'N/A'}
                      </p>
                    </div>
                  </div>
                  <SeverityBadge severity={trim.severity} />
                </div>
              ))}
              {trimStatus.length === 0 && (
                <p className="text-xs text-muted py-4 text-center">
                  {selectedDrive
                    ? selectedDrive.smartSupported
                      ? `No TRIM data for ${selectedDrive.name}`
                      : 'TRIM status not available for this device type'
                    : 'No TRIM data available'}
                </p>
              )}
            </div>
          </Section>
        )}

        {/* ── Event Logs ───────────────────────────────────────────────────── */}
        {!showNotScanned && !isSelectedScanning && !(selectedDrive && !selectedDrive.smartSupported) && eventLogs.length > 0 && (
          <Section title={`System Event Logs${selectedDrive ? ' (System-Wide)' : ''}`}
            icon={<Shield className="w-5 h-5" />}
            count={eventLogs.filter((e: any) => e.severity === 'critical' || e.severity === 'high').length}
            defaultOpen={false}>
            {selectedDrive && (
              <p className="text-[10px] text-muted/60 mt-3 mb-1 italic">
                Windows disk events are system-wide. Events may not be specific to the selected drive.
              </p>
            )}
            <div className="space-y-2 mt-3 max-h-[300px] overflow-y-auto custom-scrollbar">
              {eventLogs.map((evt: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-surface/20 border border-white/5 text-[11px]">
                  <div className={SEV_COLORS[evt.severity]?.text || 'text-muted'}>{SEV_ICON[evt.severity]}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-bold text-foreground">{evt.source}</span>
                      <span className="text-muted">ID: {evt.eventId}</span>
                      <span className="text-muted/60">{new Date(evt.timeCreated).toLocaleString()}</span>
                    </div>
                    <p className="text-muted leading-relaxed break-words">{evt.message}</p>
                  </div>
                  <SeverityBadge severity={evt.severity} />
                </div>
              ))}
            </div>
          </Section>
        )}

      </div>{/* end right panel */}
    </div>
  )
})

StorageHealthCenter.displayName = 'StorageHealthCenter'
