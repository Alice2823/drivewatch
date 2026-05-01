import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { HardDrive, Thermometer, Activity, ChevronDown, ChevronUp, Hash, ShieldCheck, Zap, Info, X, LogOut, CirclePower } from 'lucide-react'


import { AreaChart, Area, ResponsiveContainer, YAxis, CartesianGrid } from 'recharts'
import { formatBytes } from '../utils'

interface DiskCardProps {
  data: any
}

export const DiskCard: React.FC<DiskCardProps> = React.memo(({ data }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [history, setHistory] = useState<{ val: number }[]>(() =>
    Array(20).fill(0).map(() => ({ val: 0 }))
  )

  const prevSmoothValRef = useRef<number>(0)

  useEffect(() => {
    const rawVal = (data.readSpeed || 0) + (data.writeSpeed || 0)
    const clampedVal = Math.min(Math.max(rawVal, 0), 5000)

    let smoothVal: number
    if (clampedVal > prevSmoothValRef.current) {
      smoothVal = clampedVal
    } else {
      smoothVal = prevSmoothValRef.current * 0.15 + clampedVal * 0.85
    }
    prevSmoothValRef.current = smoothVal

    setHistory((prev) => {
      const next = [...prev, { val: smoothVal }]
      return next.slice(-20)
    })
  }, [data])

  const totalSpeed = (data.readSpeed || 0) + (data.writeSpeed || 0)
  const isDiskIdle = totalSpeed < 0.5

  const renderHistory = useMemo(
    () => history.map((d) => ({ ...d, renderVal: d.val < 0.1 ? 0.05 : d.val })),
    [history]
  )

  const usagePercent = useMemo(
    () => (data.size > 0 ? Math.round((data.used / data.size) * 100) : 0),
    [data.size, data.used]
  )

  const tempColor = useMemo(() => {
    if (data.temperature == null) return 'text-muted'
    if (data.temperature < 40) return 'text-success'
    if (data.temperature < 55) return 'text-warning'
    return 'text-accent'
  }, [data.temperature])

  const tempBgClass = useMemo(() => {
    if (data.temperature == null) return 'bg-surface border-border'
    if (data.temperature < 40) return 'bg-success/10 border-success/20'
    if (data.temperature < 55) return 'bg-warning/10 border-warning/20'
    return 'bg-accent/10 border-accent/20'
  }, [data.temperature])

  const healthInfo = useMemo(() => {
    switch (data.health) {
      case 'Good':
        return { color: 'text-success', bg: 'bg-success/10 border-success/20', label: 'Healthy' }
      case 'Warning':
        return { color: 'text-warning', bg: 'bg-warning/10 border-warning/20', label: 'Warning' }
      case 'Critical':
        return { color: 'text-accent', bg: 'bg-accent/10 border-accent/20', label: 'Critical' }
      default:
        return { color: 'text-muted', bg: 'bg-surface border-border', label: 'Unknown' }
    }
  }, [data.health])

  const formatSpeed = useCallback((val: number): string => {
    if (!val || val < 0) return '0.00'
    if (val >= 1000) return `${(val / 1024).toFixed(1)}`
    if (val >= 100) return Math.round(val).toString()
    if (val >= 1) return val.toFixed(1)
    return val.toFixed(2)
  }, [])

  const speedUnit = useCallback((val: number): string => {
    if (val >= 1000) return 'GB/s'
    return 'MB/s'
  }, [])

  const displayName = data.name || 'Local Drive'
  const mounts = data.mounts && data.mounts.length > 0 ? data.mounts : []


  const toggleExpanded = useCallback(() => setIsExpanded((prev) => !prev), [])
  
  const handleEject = useCallback(async () => {
    if (!mounts.length) return
    const driveLetter = mounts[0] // Eject first partition
    await window.api.ejectDrive(driveLetter)
  }, [mounts])



  const glowIntensity = Math.min(totalSpeed / 100, 1)
  
  // Color for usage bar

  // Color for usage bar
  const usageBarColor =
    usagePercent > 90
      ? 'bg-accent'
      : usagePercent > 70
        ? 'bg-warning'
        : 'bg-gradient-to-r from-primary to-primary/70'

  return (
    <div
      className={`glass-card flex flex-col p-5 md:p-6 overflow-hidden transition-all duration-500 gap-6 relative group ${totalSpeed > 5 ? 'ring-1 ring-primary/30 shadow-[0_0_30px_rgba(var(--color-primary-rgb),0.1)]' : 'ring-1 ring-white/5'
        } ${data.stale ? 'opacity-70 grayscale-[50%]' : ''}`}
    >
      {/* ── TOP: Header Section ── */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex gap-4 min-w-0 flex-1">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-surface/80 to-surface/30 border border-white/10 flex items-center justify-center flex-shrink-0 shadow-inner">
            <HardDrive className={`w-6 h-6 ${totalSpeed > 5 ? 'text-primary drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 'text-muted'}`} />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              className="text-[20px] font-black tracking-tight text-foreground truncate leading-none mb-2"
              title={displayName}
            >
              {displayName}
            </h3>
            <div className="flex items-center gap-3 flex-wrap mt-1.5 text-[12px] font-bold uppercase tracking-widest text-muted/80">
              {/* Clean Drive Type Text */}
              <span className="flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-muted/50" />
                {data.type || 'HDD'}
              </span>
              
              {mounts.length > 0 && (
                <>
                  <span className="text-white/10 text-[10px]">•</span>
                  {/* Minimalist Volume List */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted/50">VOL:</span>
                    <div className="flex items-center gap-1">
                      {mounts.map((m: string, i: number) => (
                        <span key={m} className="text-primary font-black drop-shadow-[0_0_4px_rgba(59,130,246,0.4)]">
                          {m}{i < mounts.length - 1 ? ',' : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Temperature Live Readout */}
        <div className="flex flex-col items-end justify-center">
          <div className="flex items-center gap-2 bg-black/40 border border-white/5 shadow-inner px-3.5 py-1.5 rounded-full backdrop-blur-md">
            <div className={`w-2 h-2 rounded-full bg-current ${tempColor} animate-pulse shadow-[0_0_8px_currentColor]`} />
            <span className="text-[10px] font-black uppercase tracking-widest text-muted/60">TEMP</span>
            <span className={`text-[15px] font-black tabular-nums tracking-tighter ${tempColor} ml-1`}>
              {data.temperature != null ? `${data.temperature}°C` : '--'}
            </span>
          </div>
        </div>
      </div>

      {/* ── MIDDLE: Capacity Section ── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-end mb-0.5">
          <span className="text-[11px] font-bold text-muted uppercase tracking-widest">Storage Capacity</span>
          <span className="text-[13px] font-black text-foreground">{usagePercent}% <span className="text-[10px] text-muted font-bold ml-0.5">USED</span></span>
        </div>
        <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-white/10 shadow-inner relative">
          <div
            className={`h-full transition-all duration-1000 ease-out rounded-full relative ${usageBarColor}`}
            style={{ width: `${usagePercent}%` }}
          >
            {/* Inner gradient overlay for depth */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/20 rounded-full" />
            {/* Glowing leading edge */}
            <div className="absolute right-0 top-0 bottom-0 w-4 bg-white/40 blur-[2px] rounded-full" />
          </div>
        </div>
        <div className="flex justify-between items-center text-[10px] font-bold text-muted/60 tracking-wider mt-0.5">
          <span>{formatBytes(data.used)}</span>
          <span>{formatBytes(data.size)}</span>
        </div>
      </div>

      {/* ── BOTTOM: Performance Area ── */}
      <div className="flex flex-col gap-4 mt-2">
        {/* Read / Write Metrics */}
        <div className="flex items-center justify-between">
          <div className="flex gap-6">
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5 mb-1">
                <ChevronDown className="w-3.5 h-3.5 text-success" />
                <span className="text-[10px] font-bold text-muted uppercase tracking-widest">Read</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-[20px] font-black text-foreground tabular-nums tracking-tight">
                  {formatSpeed(data.readSpeed)}
                </span>
                <span className="text-[10px] font-bold text-muted/70 uppercase">
                  {speedUnit(data.readSpeed)}
                </span>
              </div>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5 mb-1">
                <ChevronUp className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] font-bold text-muted uppercase tracking-widest">Write</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-[20px] font-black text-foreground tabular-nums tracking-tight">
                  {formatSpeed(data.writeSpeed)}
                </span>
                <span className="text-[10px] font-bold text-muted/70 uppercase">
                  {speedUnit(data.writeSpeed)}
                </span>
              </div>
            </div>
          </div>
          
          {/* Active indicator */}
          {!isDiskIdle && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              <span className="text-[9px] font-black text-primary uppercase tracking-widest">Active</span>
            </div>
          )}
        </div>

        {/* Graph */}
        <div className="h-24 w-full relative -mx-1">
          <div className={`absolute inset-0 transition-all duration-1000 ${isDiskIdle ? 'opacity-30 grayscale' : 'opacity-100'}`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={renderHistory} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                <defs>
                  <linearGradient id={`gradient-${data.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} opacity={0.4} />
                <YAxis 
                  orientation="right" 
                  domain={[0, (dataMax: number) => Math.max(dataMax, 5)]} 
                  tick={{ fontSize: 10, fill: 'var(--color-muted)' }} 
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={(val) => `${val} MB/s`}
                  width={60}
                />
                <Area
                  type="monotone"
                  dataKey="renderVal"
                  stroke="var(--color-primary)"
                  strokeWidth={2.5}
                  fill={`url(#gradient-${data.id})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── FOOTER: Health Status ── */}
      <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/5">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface/30 border border-white/5`}>
          <div className={`w-2 h-2 rounded-full bg-current ${healthInfo.color} ${data.health !== 'Good' && data.health !== 'Unknown' ? 'animate-pulse' : ''}`} />
          <span className={`text-[11px] font-bold uppercase tracking-wider ${healthInfo.color}`}>
            {healthInfo.label}
          </span>
        </div>

        <div className="flex gap-2">
          {data.isRemovable && (
            <button
              onClick={handleEject}
              className="p-2.5 rounded-xl transition-all duration-300 active:scale-90 border bg-accent/10 text-accent border-accent/20 hover:bg-accent/20 hover:border-accent/40 shadow-sm"
              title="Safely Eject Drive"
            >
              <CirclePower className="w-6 h-6" />
            </button>

          )}

          <button
            onClick={toggleExpanded}
            className={`p-2.5 rounded-xl transition-all duration-300 active:scale-90 border ${
              isExpanded 
                ? 'bg-primary/20 text-primary border-primary/30 shadow-lg shadow-primary/10' 
                : 'bg-surface/30 text-muted hover:bg-white/10 hover:text-foreground border-white/5 hover:border-white/20'
            }`}
            title="Hardware Details"
          >
            {isExpanded ? <X className="w-6 h-6" /> : <Info className="w-6 h-6" />}
          </button>
        </div>
      </div>


      {/* ── FLOATING DROPDOWN DETAILS ── */}
      {isExpanded && (
        <div className="absolute bottom-[80px] right-0 sm:right-5 z-50 w-full sm:w-[280px] bg-[#0f172a]/95 backdrop-blur-xl p-5 rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.6)] border border-white/10 animate-in fade-in slide-in-from-bottom-4 zoom-in-95 duration-300">
          <div className="flex flex-col gap-5">
            {/* Section 1: Identity */}
            <div>
              <h5 className="text-[10px] font-black text-muted/70 uppercase tracking-[0.2em] mb-3">Hardware Identity</h5>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 text-muted">
                    <Hash className="w-4 h-4 text-primary/70" />
                    <span className="text-[12px] font-bold uppercase tracking-wider">Serial</span>
                  </div>
                  <span className="text-[13px] font-bold text-foreground/90 font-mono bg-white/5 px-2 py-1 rounded-md border border-white/5">
                    {data.serial || '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 text-muted">
                    <ShieldCheck className="w-4 h-4 text-primary/70" />
                    <span className="text-[12px] font-bold uppercase tracking-wider">Mount Point</span>
                  </div>
                  <span className="text-[13px] font-bold text-foreground/90 bg-white/5 px-2 py-1 rounded-md border border-white/5">
                    Disk {data.diskIndex ?? '—'}
                  </span>
                </div>
              </div>
            </div>

            <div className="h-[1px] bg-white/10 w-full rounded-full" />

            {/* Section 2: Connection */}
            <div>
              <h5 className="text-[10px] font-black text-muted/70 uppercase tracking-[0.2em] mb-3">Connection</h5>
              <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between">
                <span className="text-[12px] font-bold text-primary uppercase tracking-wider">Interface</span>
                <span className="text-[14px] font-black text-primary">{data.interface || 'SATA/NVMe'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

DiskCard.displayName = 'DiskCard'
