import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { HardDrive, Activity, ShieldCheck, Zap, Thermometer, Info as InfoIcon, RefreshCcw, ShieldAlert } from 'lucide-react'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { DiskCard } from './components/DiskCard'
import { DriveScanner } from './components/DriveScanner'
import { DriveHealthScanner } from './components/DriveHealthScanner'
import { CircularProgress } from './components/CircularProgress'

import { AreaChart, Area, ResponsiveContainer, YAxis, CartesianGrid } from 'recharts'
import { UpdatePanel } from './components/UpdatePanel'
import { StorageExplorer } from './components/StorageExplorer/StorageExplorer'
import { DriveLifespanPanel } from './components/explore/DriveLifespanPanel'
import { RecoveryLab } from './components/recovery/RecoveryLab'
import { NASDashboard } from './components/recovery/NASMonitoring'
import { formatBytes } from './utils'

type TabType = 'dashboard' | 'scanner' | 'health' | 'cleanup' | 'lifespan' | 'recovery' | 'nas'

/**
 * 🌡️ UNIVERSAL TEMPERATURE FORMATTER
 * Ensures UI remains intentional and professional across all devices.
 */
function formatTemp(temp: number | null | undefined, isSupported: boolean, isReady: boolean) {
  if (!isReady) return "Initializing..."
  if (!isSupported) return "Not Supported"
  if (temp === null || temp === undefined || isNaN(temp)) return "Unavailable"
  return `${Math.round(temp)}°C`
}

function App(): React.JSX.Element {
  const [disks, setDisks] = useState<any[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isStatsReady, setIsStatsReady] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('dashboard')
  const [selectedLifespanDisk, setSelectedLifespanDisk] = useState<any>(null)
  const [globalHistory, setGlobalHistory] = useState<{ val: number }[]>([])
  const [cpuHistory, setCpuHistory] = useState<{ val: number }[]>([])
  const [ramHistory, setRamHistory] = useState<{ val: number }[]>([])
  const [gpuHistories, setGpuHistories] = useState<Record<number, { val: number }[]>>({})
  
  const [systemStats, setSystemStats] = useState<{
    cpuUsage: number;
    cpuTemp: number | null;
    cpuName: string;
    ramUsage: number;
    ramTotalBytes: number;
    ramUsedBytes: number;
    hasCpuTemp: boolean;
    hasGpuTemp: boolean;
    hasDiskTemp: boolean;
    diskTemp: number | null;
    thermalSource: 'LHM' | 'SI' | 'None';
    gpus: any[];
  }>({
    cpuUsage: 0,
    cpuTemp: null,
    cpuName: 'Unknown',
    ramUsage: 0,
    ramTotalBytes: 0,
    ramUsedBytes: 0,
    hasCpuTemp: false,
    hasGpuTemp: false,
    hasDiskTemp: false,
    diskTemp: null,
    thermalSource: 'None',
    gpus: []
  })

  const isFetchingRef = useRef(false)
  const isFetchingStatsRef = useRef(false)
  const prevGlobalSmoothRef = useRef(0)
  const prevCpuSmoothRef = useRef(0)
  const prevRamSmoothRef = useRef(0)
  const prevGpuSmoothRefs = useRef<Record<number, number>>({})

  const fetchDisks = useCallback(async () => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    try {
      const data = await window.api.getDiskData()
      if (Array.isArray(data)) {
        setDisks(data)
        setLoading(false)
      }
      setLastUpdated(new Date())
    } catch {
      setLoading(false)
    } finally {
      isFetchingRef.current = false
    }
  }, [])

  useEffect(() => {
    fetchDisks()
    const intervalMs = activeTab === 'dashboard' ? 1000 : activeTab === 'cleanup' || activeTab === 'lifespan' ? 3000 : 5000
    const intervalId = setInterval(() => {
      if (!document.hidden && !isPaused) fetchDisks()
    }, intervalMs)
    return () => clearInterval(intervalId)
  }, [activeTab, isPaused, fetchDisks])

  useEffect(() => {
    const fetchTelemetry = async () => {
      if (document.hidden || isFetchingStatsRef.current) return
      isFetchingStatsRef.current = true
      
      try {
        const [sys, gpusRaw] = await Promise.all([
          window.api.getSystemStats(),
          window.api.getGpuStats()
        ])

        const gpus = Array.isArray(gpusRaw) ? gpusRaw : (gpusRaw ? [gpusRaw] : [])

        // 🛡️ High-Reactivity Smoothing (0.3 prev / 0.7 current)
        const alpha = 0.7
        const smoothVal = (prev: number, curr: number) => prev * (1 - alpha) + curr * alpha
        
        prevCpuSmoothRef.current = smoothVal(prevCpuSmoothRef.current, sys.cpuUsage)
        prevRamSmoothRef.current = smoothVal(prevRamSmoothRef.current, sys.ramUsage)

        setSystemStats({ ...sys, gpus })
        setIsStatsReady(true)

        if (activeTab !== 'dashboard') return

        // Update Histories per sample (Circular Buffer)
        setCpuHistory(prev => {
          const h = prev.length === 0 ? Array(60).fill(0).map(() => ({ val: 0 })) : prev
          return [...h.slice(-59), { val: Math.round(prevCpuSmoothRef.current) }]
        })

        setRamHistory(prev => {
          const h = prev.length === 0 ? Array(60).fill(0).map(() => ({ val: 0 })) : prev
          return [...h.slice(-59), { val: Math.round(prevRamSmoothRef.current) }]
        })

        setGpuHistories(prev => {
          const next = { ...prev }
          gpus.forEach((g, idx) => {
            const usage = g.usage || 0
            prevGpuSmoothRefs.current[idx] = smoothVal(prevGpuSmoothRefs.current[idx] || 0, usage)
            const h = prev[idx] || Array(60).fill(0).map(() => ({ val: 0 }))
            next[idx] = [...h.slice(-59), { val: Math.round(prevGpuSmoothRefs.current[idx]) }]
          })
          return next
        })

      } catch (err) {
        console.error('[Telemetry] Fetch Error:', err)
      } finally {
        isFetchingStatsRef.current = false
      }
    }

    void fetchTelemetry()
    const intervalId = setInterval(fetchTelemetry, activeTab === 'dashboard' ? 1000 : 5000)
    return () => clearInterval(intervalId)
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'dashboard') return
    // Use the max active time % across all disks for the global graph
    const maxUsage = disks.length === 0 ? 0 : Math.max(...disks.map(d => d.usagePercent || 0))
    const clampedVal = Math.min(Math.max(maxUsage, 0), 100)
    let smoothVal = clampedVal > prevGlobalSmoothRef.current ? clampedVal : prevGlobalSmoothRef.current * 0.15 + clampedVal * 0.85
    prevGlobalSmoothRef.current = smoothVal
    setGlobalHistory((prev) => {
      if (prev.length === 0) return Array(60).fill(0).map(() => ({ val: 0 }))
      return [...prev.slice(-59), { val: smoothVal }]
    })
  }, [activeTab, disks])

  const stats = useMemo(() => {
    if (disks.length === 0) return { avgTemp: null, unitCount: 0, health: 'Unknown', healthColor: 'text-muted' }
    const temps = disks.map(d => d.temperature).filter((t): t is number => t != null && t > 0)
    let avgTemp = temps.length > 0 ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null
    if (avgTemp === null && systemStats.hasDiskTemp) avgTemp = Math.round(systemStats.diskTemp || 0)
    const anyWarning = disks.some(d => d.health !== 'Good' && d.health !== 'Unknown')
    return { avgTemp, unitCount: disks.length, health: anyWarning ? 'At Risk' : 'Optimal', healthColor: anyWarning ? 'text-warning' : 'text-success' }
  }, [disks, systemStats.diskTemp, systemStats.hasDiskTemp])

  const currentThroughput = useMemo(() => disks.length === 0 ? 0 : Math.round(disks.reduce((acc, d) => acc + (d.readSpeed + d.writeSpeed), 0)), [disks])
  const currentUsagePercent = useMemo(() => disks.length === 0 ? 0 : Math.round(Math.max(...disks.map(d => d.usagePercent || 0))), [disks])
  const renderHistory = useMemo(() => globalHistory.map(d => ({ ...d, renderVal: d.val < 0.1 ? 0.05 : d.val })), [globalHistory])

  /**
   * 🏷️ Sensor Status Badge Logic
   */
  const renderStatusBadge = () => {
    if (!isStatsReady) {
      return (
        <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-surface/50 border border-white/5">
          <RefreshCcw className="w-3.5 h-3.5 text-muted animate-spin" />
          <span className="text-[10px] font-black text-muted uppercase tracking-widest">Reconnecting Sensors...</span>
        </div>
      )
    }

    if (systemStats.thermalSource === 'LHM') {
      return (
        <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-primary/10 border border-primary/20">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] font-black text-primary uppercase tracking-widest">Advanced Sensors Active</span>
        </div>
      )
    }

    return (
      <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-warning/10 border border-warning/20">
        <Thermometer className="w-3.5 h-3.5 text-warning" />
        <span className="text-[10px] font-black text-warning uppercase tracking-widest">Basic Sensors Mode</span>
      </div>
    )
  }

  return (
    <div className="h-screen w-full flex bg-background overflow-hidden transition-colors duration-300">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="flex-1 flex flex-col h-full overflow-y-auto">
        <div className="w-full max-w-full px-6 py-4 md:py-6 pb-20 flex flex-col flex-1 gap-8 md:gap-12">
          <TopBar lastUpdated={lastUpdated} isPaused={isPaused} onTogglePause={() => setIsPaused(!isPaused)} />
          
          <main className="flex-1 flex flex-col gap-8 md:gap-12">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="flex flex-col">
                <h2 className="text-[32px] font-black tracking-tight text-foreground leading-none">
                  {activeTab === 'dashboard' ? 'Overview' 
                   : activeTab === 'scanner' ? 'Drive Scanner'
                   : activeTab === 'health' ? 'Health Analysis'
                   : activeTab === 'lifespan' ? 'Intelligence Engine'
                   : activeTab === 'recovery' ? 'Recovery Lab'
                   : activeTab === 'nas' ? 'NAS Monitoring'
                   : 'Storage Explorer'}
                </h2>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-success/5 border border-success/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-success" />
                    <span className="text-[10px] font-black text-success uppercase tracking-widest">Optimal</span>
                  </div>
                  {renderStatusBadge()}
                </div>
              </div>
            
            <div className="hidden sm:flex items-center gap-8 border-l border-border/30 pl-8">
              <div className="flex flex-col">
                <span className="text-[12px] font-bold uppercase tracking-wider text-muted mb-1">Avg Temp</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[22px] font-bold text-foreground">
                    {formatTemp(stats.avgTemp, true, isStatsReady)}
                  </span>
                </div>
              </div>
              <div className="flex flex-col">
                <span className="text-[12px] font-bold uppercase tracking-wider text-muted mb-1">Total I/O</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[22px] font-bold text-primary">{currentThroughput}</span>
                  <span className="text-sm font-bold text-muted uppercase">MB/s</span>
                </div>
              </div>
            </div>
          </div>

          {activeTab === 'dashboard' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
              {/* Throughput Graph */}
              <div className="lg:col-span-2 glass-card p-6 flex flex-col h-[320px]">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 rounded-2xl text-primary border border-primary/20">
                      <Activity className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-[18px] font-semibold text-foreground/90 uppercase tracking-tight">Disk Activity</h4>
                      <p className="text-[14px] font-medium text-muted">Real-time active time load</p>
                    </div>
                  </div>
                  <div className="flex items-baseline gap-4">
                    <div className="flex items-baseline gap-1.5 px-3 py-1 rounded-lg bg-surface/50 border border-white/5">
                      <span className="text-[20px] font-black text-foreground">{currentUsagePercent}%</span>
                      <span className="text-[10px] font-bold text-muted uppercase tracking-widest">Active Time</span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[32px] font-bold text-primary">{currentThroughput}</span>
                      <span className="text-sm font-bold text-muted">MB/s</span>
                    </div>
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={renderHistory} margin={{ left: 0, right: 40, top: 10, bottom: 0 }}>
                      <YAxis 
                        orientation="right" 
                        domain={[0, 100]} 
                        ticks={[0, 25, 50, 75, 100]}
                        tick={{ fontSize: 10, fontWeight: '900', fill: 'rgba(255,255,255,0.7)', dx: 10 }} 
                        axisLine={false} 
                        tickLine={false} 
                        width={50} 
                      />
                      <Area type="monotone" dataKey="renderVal" stroke="var(--color-primary)" strokeWidth={2} fill="var(--color-primary)" fillOpacity={0.1} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Hardware Sensors Sidebar */}
              <div className="lg:col-span-1 glass-card p-6 flex flex-col h-full">
                <div className="flex items-center gap-4 mb-8">
                  <div className="p-3 bg-surface rounded-2xl text-primary border border-border">
                    <Zap className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-[18px] font-semibold text-foreground/90 uppercase">Hardware Load</h4>
                    <p className="text-[14px] font-medium text-muted">Live Sensors</p>
                  </div>
                </div>

                <div className="flex-1 space-y-4">
                  {/* CPU Sensor */}
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-surface/30 border border-white/5 h-[110px]">
                    <div className="flex flex-col w-40">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[32px] font-black text-foreground">{Math.round(systemStats.cpuUsage)}%</span>
                        {systemStats.hasCpuTemp && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/15 border border-warning/30">
                            <Thermometer className="w-3 h-3 text-warning" />
                            <span className="text-[12px] font-black text-warning">
                              {formatTemp(systemStats.cpuTemp, true, isStatsReady)}
                            </span>
                          </div>
                        )}
                      </div>
                      <p className="text-[12px] font-bold text-muted uppercase mt-1">CPU Load</p>
                      <span className="text-[10px] font-semibold text-foreground/80 truncate mt-1">{systemStats.cpuName}</span>
                    </div>
                    <div className="h-full flex-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={cpuHistory} margin={{ left: 0, right: -30, top: 0, bottom: 0 }}>
                          <YAxis orientation="right" domain={[0, 100]} ticks={[0, 10, 30, 50, 70, 100]} tick={{ fontSize: 9, fontWeight: 'bold', fill: 'var(--color-muted)', opacity: 0.5 }} axisLine={false} tickLine={false} />
                          <Area type="monotone" dataKey="val" stroke="var(--color-primary)" strokeWidth={2} fill="var(--color-primary)" fillOpacity={0.1} isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  {/* RAM Sensor */}
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-surface/30 border border-white/5 h-[110px]">
                    <div className="flex flex-col w-40">
                      <span className="text-[32px] font-black text-foreground">{Math.round(systemStats.ramUsage)}%</span>
                      <p className="text-[12px] font-bold text-muted uppercase mt-1">RAM Usage</p>
                      <span className="text-[10px] font-semibold text-foreground/80 mt-1">{formatBytes(systemStats.ramUsedBytes)} / {formatBytes(systemStats.ramTotalBytes)}</span>
                    </div>
                    <div className="h-full flex-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={ramHistory} margin={{ left: 0, right: -30, top: 0, bottom: 0 }}>
                          <YAxis orientation="right" domain={[0, 100]} ticks={[0, 10, 30, 50, 70, 100]} tick={{ fontSize: 9, fontWeight: 'bold', fill: 'var(--color-muted)', opacity: 0.5 }} axisLine={false} tickLine={false} />
                          <Area type="monotone" dataKey="val" stroke="var(--color-primary)" strokeWidth={2} fill="var(--color-primary)" fillOpacity={0.1} isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* GPU Sensors */}
                  {systemStats.gpus.map((gpu, idx) => (
                    <div key={idx} className="flex items-center justify-between p-4 rounded-2xl bg-surface/30 border border-white/5 h-[110px]">
                      <div className="flex flex-col w-40">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[32px] font-black text-foreground">{Math.round(gpu.usage)}%</span>
                          {systemStats.hasGpuTemp && (
                            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 border border-primary/30">
                              <Thermometer className="w-3 h-3 text-primary" />
                              <span className="text-[12px] font-black text-primary">
                                {formatTemp(gpu.temperature, true, isStatsReady)}
                              </span>
                            </div>
                          )}
                        </div>
                        <p className="text-[12px] font-bold text-muted uppercase mt-1">GPU Load</p>
                        <span className="text-[10px] font-semibold text-foreground/80 truncate mt-1">{gpu.name}</span>
                      </div>
                      <div className="h-full flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={gpuHistories[idx] || []} margin={{ left: 0, right: -30, top: 0, bottom: 0 }}>
                            <YAxis orientation="right" domain={[0, 100]} ticks={[0, 10, 30, 50, 70, 100]} tick={{ fontSize: 9, fontWeight: 'bold', fill: 'var(--color-muted)', opacity: 0.5 }} axisLine={false} tickLine={false} />
                            <Area type="monotone" dataKey="val" stroke="var(--color-primary)" strokeWidth={2} fill="var(--color-primary)" fillOpacity={0.1} isAnimationActive={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-3 mt-8">
                <div className="flex items-center justify-between mb-6">
                  <h4 className="text-[14px] font-black text-muted uppercase tracking-[0.2em]">Active Storage Units</h4>
                  <div className="h-[1px] flex-1 ml-6 bg-white/5" />
                </div>
                {loading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="glass-card p-6 h-[240px] flex flex-col gap-5 animate-pulse border-white/5 bg-white/[0.02]">
                        <div className="flex justify-between items-start">
                          <div className="w-12 h-12 rounded-2xl bg-white/10" />
                          <div className="w-20 h-6 rounded-full bg-white/5 border border-white/5" />
                        </div>
                        <div className="space-y-3">
                          <div className="w-2/3 h-6 rounded-md bg-white/10" />
                          <div className="w-1/3 h-4 rounded-md bg-white/5" />
                        </div>
                        <div className="mt-auto space-y-4">
                          <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                            <div className="w-1/2 h-full bg-white/10 rounded-full" />
                          </div>
                          <div className="flex justify-between items-center">
                            <div className="w-24 h-4 rounded-md bg-white/5" />
                            <div className="w-12 h-4 rounded-md bg-white/5" />
                          </div>
                        </div>
                      </div>
                    ))}
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

          {activeTab === 'scanner' && <DriveScanner drives={Array.from(new Set(disks.flatMap(d => d.mounts || []))).sort()} />}
          {activeTab === 'health' && <DriveHealthScanner />}
          {activeTab === 'cleanup' && <StorageExplorer disks={disks} />}
          
          {activeTab === 'lifespan' && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-3xl font-black text-foreground tracking-tight uppercase italic">Intelligence <span className="text-primary tracking-normal not-italic">Engine</span></h2>
                  <p className="text-xs font-bold text-muted uppercase tracking-widest mt-1">Drive Lifespan & Reliability Analytics</p>
                </div>
                
                {/* Large Disk Selector for Intelligence Engine */}
                <div className="flex gap-4 overflow-x-auto pb-2 custom-scrollbar">
                   {disks.map(d => (
                     <button 
                       key={d.id}
                       onClick={async () => {
                          const smart = await window.api.health.runSmart(d.diskIndex)
                          setSelectedLifespanDisk({ ...d, ...smart })
                       }}
                       className={`flex items-center gap-4 p-4 min-w-[240px] rounded-2xl border transition-all relative group text-left ${
                         selectedLifespanDisk?.diskIndex === d.diskIndex 
                          ? 'bg-primary/10 border-primary/40 shadow-[0_0_30px_rgba(6,182,212,0.15)] scale-[1.02]' 
                          : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20'
                       }`}
                     >
                       <div className={`p-3 rounded-xl ${selectedLifespanDisk?.diskIndex === d.diskIndex ? 'bg-primary/20 text-primary' : 'bg-surface text-muted group-hover:text-foreground'}`}>
                         <HardDrive className="w-6 h-6" />
                       </div>
                       <div className="flex flex-col min-w-0">
                         <span className={`text-xs font-black uppercase tracking-[0.2em] ${selectedLifespanDisk?.diskIndex === d.diskIndex ? 'text-primary' : 'text-muted'}`}>
                           {d.mounts?.[0] || 'Disk'} {d.diskIndex}
                         </span>
                         <span className="text-sm font-bold text-foreground truncate mt-0.5" title={d.name}>
                           {d.name || 'Local Storage'}
                         </span>
                         <span className="text-[10px] font-bold text-muted uppercase tracking-wider">
                           {formatBytes(d.size)} • {d.type || 'HDD'}
                         </span>
                       </div>
                       {selectedLifespanDisk?.diskIndex === d.diskIndex && (
                         <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary shadow-[0_0_10px_rgba(6,182,212,1)]" />
                       )}
                     </button>
                   ))}
                </div>
              </div>

              {selectedLifespanDisk ? (
                <DriveLifespanPanel driveData={selectedLifespanDisk} />
              ) : (
                <div className="flex flex-col items-center justify-center p-24 glass-card border-dashed border-white/10 opacity-60">
                   <Zap className="w-12 h-12 text-primary mb-4 animate-pulse" />
                   <p className="text-sm font-black text-muted uppercase tracking-widest">Select a drive to begin analysis</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'recovery' && (
             <div className="flex flex-col gap-6 animate-fade-in">
               <div className="flex flex-col gap-2 mb-4">
                 <h2 className="text-3xl font-black text-foreground tracking-tight uppercase italic">Recovery <span className="text-primary tracking-normal not-italic">Lab</span></h2>
                 <p className="text-xs font-bold text-muted uppercase tracking-widest">Deleted Data Recovery System</p>
               </div>
               
               <RecoveryLab disks={disks} />
             </div>
          )}

          {activeTab === 'nas' && (
             <div className="flex flex-col gap-6 animate-fade-in">
               <div className="flex flex-col gap-2 mb-4">
                 <h2 className="text-3xl font-black text-foreground tracking-tight uppercase italic">NAS <span className="text-primary tracking-normal not-italic">Monitoring</span></h2>
                 <p className="text-xs font-bold text-muted uppercase tracking-widest">Network Attached Storage Dashboard</p>
               </div>
               
               <NASDashboard isActive={activeTab === 'nas'} />
             </div>
          )}
        </main>
      </div>
      <UpdatePanel />
      </div>
    </div>
  )
}

export default App
