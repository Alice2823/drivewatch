import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { HardDrive, Activity, ShieldCheck, RefreshCw, Thermometer, Zap } from 'lucide-react'
import { TopBar } from './components/TopBar'
import { DiskCard } from './components/DiskCard'
import { DriveScanner } from './components/DriveScanner'
import { CircularProgress } from './components/CircularProgress'
import { AreaChart, Area, ResponsiveContainer, YAxis, CartesianGrid } from 'recharts'

type TabType = 'dashboard' | 'scanner'

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function App(): React.JSX.Element {
  const [disks, setDisks] = useState<any[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('dashboard')
  const [globalHistory, setGlobalHistory] = useState<{ val: number }[]>([])
  const [cpuHistory, setCpuHistory] = useState<{ val: number }[]>([])
  const [ramHistory, setRamHistory] = useState<{ val: number }[]>([])
  const [systemStats, setSystemStats] = useState<{ 
    cpuUsage: number; 
    cpuTemp: number | null; 
    cpuName: string;
    cpuCores: number;
    cpuThreads: number;
    ramUsage: number;
    ramTotalBytes: number;
    ramUsedBytes: number;
  }>({
    cpuUsage: 0,
    cpuTemp: null,
    cpuName: 'Unknown',
    cpuCores: 0,
    cpuThreads: 0,
    ramUsage: 0,
    ramTotalBytes: 0,
    ramUsedBytes: 0
  })

  // Use refs for mutable state that shouldn't trigger re-renders
  const retryCountRef = useRef(0)
  const isFetchingRef = useRef(false)
  const prevGlobalSmoothRef = useRef(0)
  const prevCpuSmoothRef = useRef(0)
  const prevRamSmoothRef = useRef(0)

  // ── Data Fetching ──
  const fetchDisks = useCallback(async () => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true

    try {
      const data = await window.api.getDiskData()

      if (Array.isArray(data) && data.length > 0) {
        setDisks(data)
        retryCountRef.current = 0
        setLoading(false)
      } else {
        retryCountRef.current++
        // After 5 retries (~10s) stop showing loading spinner
        if (retryCountRef.current >= 5) {
          setLoading(false)
        }
      }
      setLastUpdated(new Date())
    } catch {
      retryCountRef.current++
      if (retryCountRef.current >= 5) {
        setLoading(false)
      }
    } finally {
      isFetchingRef.current = false
    }
  }, [])

  // ── Computed Stats ──
  // Update graph history array every time disks update (every 1s) to force scrolling
  useEffect(() => {
    const rawTotalIO = disks.reduce((acc: number, d: any) => acc + ((d.readSpeed || 0) + (d.writeSpeed || 0)), 0)
    const clampedVal = Math.min(Math.max(rawTotalIO, 0), 10000)

    let smoothVal: number
    if (clampedVal > prevGlobalSmoothRef.current) {
      smoothVal = clampedVal
    } else {
      smoothVal = prevGlobalSmoothRef.current * 0.15 + clampedVal * 0.85
    }
    prevGlobalSmoothRef.current = smoothVal

    setGlobalHistory((prev) => {
      if (prev.length === 0) return Array(30).fill(0).map(() => ({ val: 0 }))
      const next = [...prev, { val: smoothVal }]
      return next.slice(-30)
    })
  }, [disks])

  // ── Polling Interval (1s loop for real-time graphs) ──
  useEffect(() => {
    fetchDisks() 
    if (isPaused) return
    const intervalId = setInterval(fetchDisks, 1000)
    return () => clearInterval(intervalId)
  }, [isPaused, fetchDisks])

  // ── System Stats Polling (1s) ──
  useEffect(() => {
    const fetchSystem = async () => {
      try {
        const stats = await window.api.getSystemStats()
        setSystemStats(stats)
      } catch { /* silent */ }
    }
    fetchSystem()
    const intervalId = setInterval(fetchSystem, 1000)
    return () => clearInterval(intervalId)
  }, [])

  // ── CPU/RAM History Update ──
  useEffect(() => {
    const rawCpu = systemStats.cpuUsage
    let smoothCpu: number
    if (rawCpu > prevCpuSmoothRef.current) smoothCpu = rawCpu
    else smoothCpu = prevCpuSmoothRef.current * 0.15 + rawCpu * 0.85
    prevCpuSmoothRef.current = smoothCpu

    setCpuHistory((prev) => {
      if (prev.length === 0) return Array(30).fill(0).map(() => ({ val: 0 }))
      const next = [...prev, { val: smoothCpu }]
      return next.slice(-30)
    })

    const rawRam = systemStats.ramUsage
    let smoothRam: number
    if (rawRam > prevRamSmoothRef.current) smoothRam = rawRam
    else smoothRam = prevRamSmoothRef.current * 0.15 + rawRam * 0.85
    prevRamSmoothRef.current = smoothRam

    setRamHistory((prev) => {
      if (prev.length === 0) return Array(30).fill(0).map(() => ({ val: 0 }))
      const next = [...prev, { val: smoothRam }]
      return next.slice(-30)
    })
  }, [systemStats])
  // ── Computed Stats ──
  const stats = useMemo(() => {
    if (disks.length === 0) return { avgTemp: null, unitCount: 0, health: 'Unknown', healthColor: 'text-muted' }

    const temps = disks.map(d => d.temperature).filter((t): t is number => t != null && t > 0)
    const avgTemp = temps.length > 0 ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null
    const anyWarning = disks.some(d => d.health !== 'Good' && d.health !== 'Unknown')

    return {
      avgTemp,
      unitCount: disks.length,
      health: anyWarning ? 'At Risk' : 'Optimal',
      healthColor: anyWarning ? 'text-warning' : 'text-success'
    }
  }, [disks])

  // ── Collect all mount points for scanner ──
  const allMounts = useMemo(() => {
    const mounts = new Set<string>()
    for (const disk of disks) {
      if (disk.mounts) {
        for (const m of disk.mounts) {
          if (m) mounts.add(m)
        }
      }
    }
    return Array.from(mounts).sort()
  }, [disks])

  const togglePause = useCallback(() => setIsPaused(prev => !prev), [])

  const currentThroughput = useMemo(() => {
    // Display RAW aggregate throughput in text
    if (disks.length === 0) return 0
    return Math.round(disks.reduce((acc, d) => acc + (d.readSpeed + d.writeSpeed), 0))
  }, [disks])

  const isGlobalIdle = currentThroughput < 0.5
  
  const renderHistory = useMemo(() => 
    globalHistory.map(d => ({ ...d, renderVal: d.val < 0.1 ? 0.05 : d.val })),
    [globalHistory]
  )

  return (
    <div className="min-h-screen w-full flex flex-col items-center bg-background transition-colors duration-300">
      <div className="w-full max-w-[1300px] px-4 md:px-8 py-4 md:py-6 flex flex-col flex-1 gap-12 md:gap-16">
        <TopBar
          lastUpdated={lastUpdated}
          isPaused={isPaused}
          onTogglePause={togglePause}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
        />

        <main className="flex-1 flex flex-col gap-12 md:gap-16">
          {/* ── Header Section ── */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h2 className="text-[38px] font-black tracking-tight text-foreground leading-tight">
                {activeTab === 'dashboard' ? 'Dashboard' : 'Drive Scanner'}
              </h2>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-success/10 border border-success/10">
                  <span className="w-2 h-2 rounded-full bg-success shadow-[0_0_8px_rgba(var(--color-success-rgb),0.5)]" />
                  <span className="text-xs font-bold text-success uppercase tracking-wider">System Optimal</span>
                </div>
                <span className="text-xs font-semibold text-muted/60 uppercase tracking-widest">
                  {disks.length} storage units active
                </span>
              </div>
            </div>

            <div className="flex items-center gap-10">
              {/* Quick Metrics */}
              <div className="hidden sm:flex items-center gap-8 border-l border-border/30 pl-8">
                <div className="flex flex-col">
                  <span className="text-[12px] font-bold uppercase tracking-wider text-muted mb-1">Average Temp</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[22px] font-bold text-foreground">{stats.avgTemp ? stats.avgTemp : '--'}</span>
                    <span className="text-sm font-bold text-muted">°C</span>
                  </div>
                </div>
                <div className="flex flex-col">
                  <span className="text-[12px] font-bold uppercase tracking-wider text-muted mb-1">Total Throughput</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[22px] font-bold text-primary">{currentThroughput}</span>
                    <span className="text-sm font-bold text-muted uppercase">MB/s</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── DASHBOARD TAB ── */}
          {activeTab === 'dashboard' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
              {/* Top Row: Performance (2/3 width) and Stats (1/3 width) */}
              
              {/* Global IO Graph - Spans 2 columns */}
              <div className="lg:col-span-2 glass-card p-4 md:p-6 border border-white/5 shadow-xl flex flex-col h-full min-h-[200px] md:min-h-[320px]">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 rounded-2xl text-primary border border-primary/20">
                      <Activity className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-[18px] font-semibold text-foreground/90 uppercase tracking-tight">Disk Throughput</h4>
                      <p className="text-[14px] font-medium text-muted">Real-time aggregate I/O performance</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {isGlobalIdle ? (
                      <span className="text-[12px] font-bold text-muted/80 uppercase tracking-widest bg-surface/80 px-3 py-1 rounded-full border border-border/50">Idle State</span>
                    ) : (
                      <div className="flex flex-col items-end">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[32px] font-bold text-primary tracking-tighter">{currentThroughput}</span>
                          <span className="text-sm font-bold text-muted uppercase">MB/s</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className={`flex-1 min-h-[160px] transition-all duration-1000 ${isGlobalIdle ? 'opacity-40' : 'opacity-100'}`}>

                  {renderHistory.length > 0 && (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={renderHistory} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="globalIO" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
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
                          strokeWidth={4}
                          fill="url(#globalIO)"
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

            {/* System Stats - Spans 1 column */}
            <div className="lg:col-span-1 glass-card p-6 border border-white/5 shadow-xl flex flex-col h-full">
              <div className="flex items-center gap-4 mb-8">
                <div className="p-3 bg-surface rounded-2xl text-primary border border-border shadow-sm">
                  <Zap className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-[18px] font-semibold text-foreground/90 uppercase tracking-tight">Hardware Load</h4>
                  <p className="text-[14px] font-medium text-muted">Core resources</p>
                </div>
              </div>

              <div className="flex-1 space-y-4">
                <div className="flex items-center justify-between p-4 rounded-2xl bg-surface/30 border border-white/5 hover:bg-surface/50 transition-all gap-6 h-[110px]">
                  <div className="flex flex-col flex-shrink-0 w-28">
                    <span className="text-[28px] font-bold text-foreground leading-none">{Math.round(systemStats.cpuUsage)}%</span>
                    <p className="text-[12px] font-bold text-muted uppercase tracking-wide mt-1">CPU Load</p>
                    <div className="flex flex-col mt-2">
                      <span className="text-[10px] font-semibold text-foreground/80 truncate" title={systemStats.cpuName}>{systemStats.cpuName}</span>
                      <span className="text-[9px] font-bold text-muted uppercase tracking-wider">{systemStats.cpuCores} Cores / {systemStats.cpuThreads} Threads</span>
                    </div>
                  </div>
                  <div className="h-full flex-1 relative min-w-0 -my-2 -mr-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={cpuHistory} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gradient-cpu" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                          </linearGradient>

                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} opacity={0.4} />
                        <YAxis 
                          orientation="right" 
                          domain={[0, 100]} 
                          tick={{ fontSize: 10, fill: 'var(--color-muted)' }} 
                          tickLine={false} 
                          axisLine={false} 
                          tickFormatter={(val) => `${val}%`}
                          width={40}
                        />
                        <Area
                          type="monotone"
                          dataKey="val"
                          stroke="var(--color-primary)"
                          strokeWidth={2.5}

                          fill="url(#gradient-cpu)"
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-2xl bg-surface/30 border border-white/5 hover:bg-surface/50 transition-all gap-6 h-[110px]">
                  <div className="flex flex-col flex-shrink-0 w-28">
                    <span className="text-[28px] font-bold text-foreground leading-none">{Math.round(systemStats.ramUsage)}%</span>
                    <p className="text-[12px] font-bold text-muted uppercase tracking-wide mt-1">RAM Usage</p>
                    <div className="flex flex-col mt-2">
                      <span className="text-[10px] font-semibold text-foreground/80">{systemStats.ramUsedBytes > 0 ? formatBytes(systemStats.ramUsedBytes) : '--'} Used</span>
                      <span className="text-[9px] font-bold text-muted uppercase tracking-wider">{systemStats.ramTotalBytes > 0 ? formatBytes(systemStats.ramTotalBytes) : '--'} Total</span>
                    </div>
                  </div>
                  <div className="h-full flex-1 relative min-w-0 -my-2 -mr-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={ramHistory} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gradient-ram" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} opacity={0.4} />
                        <YAxis 
                          orientation="right" 
                          domain={[0, 100]} 
                          tick={{ fontSize: 10, fill: 'var(--color-muted)' }} 
                          tickLine={false} 
                          axisLine={false} 
                          tickFormatter={(val) => `${val}%`}
                          width={40}
                        />
                        <Area
                          type="monotone"
                          dataKey="val"
                          stroke="var(--color-primary)"
                          strokeWidth={2.5}
                          fill="url(#gradient-ram)"
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>

            {/* Drive Cards Section - Full Width */}
            <div className="lg:col-span-3 mt-12 md:mt-16">
              <div className="flex items-center justify-between mb-8">
                <h4 className="text-[18px] font-semibold text-foreground/90 uppercase tracking-tight">Active Storage Units</h4>
                <div className="h-[1px] flex-1 mx-6 bg-border/30" />
              </div>

              {loading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-6 glass-card border border-border shadow-xl">

                  <div className="relative">
                    <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                    <Activity className="absolute inset-0 m-auto w-6 h-6 text-primary animate-pulse" />
                  </div>
                  <p className="text-[14px] font-bold text-muted uppercase tracking-widest">Enabling sensors...</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {disks.map((disk) => (
                    <DiskCard key={disk.id} data={disk} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── SCANNER TAB ── */}
        {activeTab === 'scanner' && (
          <DriveScanner drives={allMounts} />
        )}
      </main>

      {/* Footer */}
      <footer className="py-6 border-t border-border mt-auto">
        <div className="max-w-[1400px] mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-muted" />
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted">
              DriveWatch v2.0.0
            </span>
          </div>
          <span className="text-[9px] font-bold text-muted">
            Real-time Storage Monitor
          </span>
        </div>
      </footer>
      </div>
    </div>
  )
}

export default App
