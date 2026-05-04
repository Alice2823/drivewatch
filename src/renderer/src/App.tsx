import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { HardDrive, Activity, ShieldCheck, Zap, Thermometer, Info as InfoIcon, RefreshCcw } from 'lucide-react'
import { TopBar } from './components/TopBar'
import { DiskCard } from './components/DiskCard'
import { DriveScanner } from './components/DriveScanner'
import { DriveHealthScanner } from './components/DriveHealthScanner'
import { CircularProgress } from './components/CircularProgress'

import logo from './assets/logo.png'
import { AreaChart, Area, ResponsiveContainer, YAxis, CartesianGrid } from 'recharts'
import { UpdatePanel } from './components/UpdatePanel'
import { StorageExplorer } from './components/StorageExplorer/StorageExplorer'

type TabType = 'dashboard' | 'scanner' | 'health' | 'cleanup'

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
  const [globalHistory, setGlobalHistory] = useState<{ val: number }[]>([])
  const [cpuHistory, setCpuHistory] = useState<{ val: number }[]>([])
  const [ramHistory, setRamHistory] = useState<{ val: number }[]>([])
  const [gpuHistory, setGpuHistory] = useState<{ val: number }[]>([])
  
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
  const prevGpuSmoothRef = useRef(0)

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
    const intervalId = setInterval(() => {
      if (!document.hidden && !isPaused) fetchDisks()
    }, 2000)
    return () => clearInterval(intervalId)
  }, [isPaused, fetchDisks])

  useEffect(() => {
    const fetchAllStats = async () => {
      if (document.hidden || isFetchingStatsRef.current) return
      isFetchingStatsRef.current = true
      try {
        const [sysDataFresh, gpuDataRaw] = await Promise.all([
          window.api.getSystemStats(),
          window.api.getGpuStats()
        ])
        
        const gpusRaw = Array.isArray(gpuDataRaw) ? gpuDataRaw : (gpuDataRaw ? [gpuDataRaw] : [])
        
        const gpus = gpusRaw.map(g => ({
          ...g,
          temperature: sysDataFresh.hasGpuTemp ? sysDataFresh.gpuTemp : null
        }))

        setSystemStats(prev => ({
          ...prev,
          ...sysDataFresh,
          gpus: gpus.length > 0 ? gpus : [{ usage: 0, name: "Integrated Graphics", temperature: sysDataFresh.gpuTemp }]
        }))
        setIsStatsReady(true)

        // Smoothing Logic
        setCpuHistory(prev => {
          if (prev.length === 0) return Array(60).fill(0).map(() => ({ val: 0 }))
          const raw = sysDataFresh.cpuUsage
          let smooth = prevCpuSmoothRef.current
          if (raw > smooth) smooth = smooth * 0.5 + raw * 0.5
          else smooth = smooth * 0.7 + raw * 0.3
          prevCpuSmoothRef.current = smooth
          return [...prev.slice(-59), { val: smooth }]
        })

        setRamHistory(prev => {
          if (prev.length === 0) return Array(60).fill(0).map(() => ({ val: 0 }))
          const raw = sysDataFresh.ramUsage || 0
          let smooth = prevRamSmoothRef.current
          if (raw > smooth) smooth = smooth * 0.5 + raw * 0.5
          else smooth = smooth * 0.7 + raw * 0.3
          prevRamSmoothRef.current = smooth
          return [...prev.slice(-59), { val: smooth }]
        })

        const primaryGpuUsage = gpus[0]?.usage || 0
        setGpuHistory(prev => {
          if (prev.length === 0) return Array(60).fill(0).map(() => ({ val: 0 }))
          const prevSmooth = prevGpuSmoothRef.current
          const alpha = 0.6
          const smoothGpu = prevSmooth * (1 - alpha) + primaryGpuUsage * alpha
          prevGpuSmoothRef.current = smoothGpu
          return [...prev.slice(-59), { val: Math.round(smoothGpu) }]
        })
      } catch (err) {
        console.error('[Renderer] Telemetry Sync Error:', err)
      } finally {
        isFetchingStatsRef.current = false
      }
    }

    fetchAllStats()
    const intervalId = setInterval(fetchAllStats, 1000)
    return () => clearInterval(intervalId)
  }, [])

  useEffect(() => {
    const rawTotalIO = disks.reduce((acc: number, d: any) => acc + ((d.readSpeed || 0) + (d.writeSpeed || 0)), 0)
    const clampedVal = Math.min(Math.max(rawTotalIO, 0), 10000)
    let smoothVal = clampedVal > prevGlobalSmoothRef.current ? clampedVal : prevGlobalSmoothRef.current * 0.15 + clampedVal * 0.85
    prevGlobalSmoothRef.current = smoothVal
    setGlobalHistory((prev) => {
      if (prev.length === 0) return Array(60).fill(0).map(() => ({ val: 0 }))
      return [...prev.slice(-59), { val: smoothVal }]
    })
  }, [disks])

  const stats = useMemo(() => {
    if (disks.length === 0) return { avgTemp: null, unitCount: 0, health: 'Unknown', healthColor: 'text-muted' }
    const temps = disks.map(d => d.temperature).filter((t): t is number => t != null && t > 0)
    let avgTemp = temps.length > 0 ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null
    if (avgTemp === null && systemStats.hasDiskTemp) avgTemp = Math.round(systemStats.diskTemp || 0)
    const anyWarning = disks.some(d => d.health !== 'Good' && d.health !== 'Unknown')
    return { avgTemp, unitCount: disks.length, health: anyWarning ? 'At Risk' : 'Optimal', healthColor: anyWarning ? 'text-warning' : 'text-success' }
  }, [disks, systemStats.diskTemp, systemStats.hasDiskTemp])

  const currentThroughput = useMemo(() => disks.length === 0 ? 0 : Math.round(disks.reduce((acc, d) => acc + (d.readSpeed + d.writeSpeed), 0)), [disks])
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
    <div className="min-h-screen w-full flex flex-col items-center bg-background transition-colors duration-300">
      <div className="w-full max-w-[1300px] px-4 md:px-8 py-4 md:py-6 pb-20 flex flex-col flex-1 gap-12 md:gap-16">
        <TopBar lastUpdated={lastUpdated} isPaused={isPaused} onTogglePause={() => setIsPaused(!isPaused)} activeTab={activeTab} setActiveTab={setActiveTab} />
        
        <main className="flex-1 flex flex-col gap-12 md:gap-16">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="flex flex-col">
              <h2 className="text-[38px] font-black tracking-tight text-foreground leading-tight">
                {activeTab === 'dashboard' ? 'Dashboard' : 'Drive Scanner'}
              </h2>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-success/10 border border-success/10">
                  <span className="w-2 h-2 rounded-full bg-success shadow-[0_0_8px_rgba(var(--color-success-rgb),0.5)]" />
                  <span className="text-xs font-bold text-success uppercase tracking-wider">System Optimal</span>
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
                      <h4 className="text-[18px] font-semibold text-foreground/90 uppercase">Disk Throughput</h4>
                      <p className="text-[14px] font-medium text-muted">Aggregate performance</p>
                    </div>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[32px] font-bold text-primary">{currentThroughput}</span>
                    <span className="text-sm font-bold text-muted">MB/s</span>
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={renderHistory} margin={{ left: 0, right: -30, top: 0, bottom: 0 }}>
                      <YAxis orientation="right" domain={[0, 100]} ticks={[0, 10, 30, 50, 70, 100]} tick={{ fontSize: 9, fontWeight: 'bold', fill: 'var(--color-muted)', opacity: 0.5 }} axisLine={false} tickLine={false} />
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
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/15 border border-warning/30" title={!systemStats.hasCpuTemp ? "Temperature not supported on this processor." : ""}>
                          <Thermometer className="w-3 h-3 text-warning" />
                          <span className="text-[12px] font-black text-warning">
                            {formatTemp(systemStats.cpuTemp, systemStats.hasCpuTemp, isStatsReady)}
                          </span>
                        </div>
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

                  {/* GPU Sensors */}
                  {systemStats.gpus.map((gpu, idx) => (
                    <div key={idx} className="flex items-center justify-between p-4 rounded-2xl bg-surface/30 border border-white/5 h-[110px]">
                      <div className="flex flex-col w-40">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[32px] font-black text-foreground">{Math.round(gpu.usage)}%</span>
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 border border-primary/30" title={!systemStats.hasGpuTemp ? "Temperature not supported on this graphics unit." : ""}>
                            <Thermometer className="w-3 h-3 text-primary" />
                            <span className="text-[12px] font-black text-primary">
                              {formatTemp(gpu.temperature, systemStats.hasGpuTemp, isStatsReady)}
                            </span>
                          </div>
                        </div>
                        <p className="text-[12px] font-bold text-muted uppercase mt-1">GPU Load</p>
                        <span className="text-[10px] font-semibold text-foreground/80 truncate mt-1">{gpu.name}</span>
                      </div>
                      <div className="h-full flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={idx === 0 ? gpuHistory : []} margin={{ left: 0, right: -30, top: 0, bottom: 0 }}>
                            <YAxis orientation="right" domain={[0, 100]} ticks={[0, 10, 30, 50, 70, 100]} tick={{ fontSize: 9, fontWeight: 'bold', fill: 'var(--color-muted)', opacity: 0.5 }} axisLine={false} tickLine={false} />
                            <Area type="monotone" dataKey="val" stroke="var(--color-primary)" strokeWidth={2} fill="var(--color-primary)" fillOpacity={0.1} isAnimationActive={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Disk Units */}
              <div className="lg:col-span-3 mt-12">
                <div className="flex items-center justify-between mb-8">
                  <h4 className="text-[18px] font-semibold text-foreground/90 uppercase">Active Storage Units</h4>
                  <div className="h-[1px] flex-1 mx-6 bg-border/30" />
                </div>
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-6 glass-card">
                    <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                    <p className="text-[14px] font-bold text-muted uppercase">Scanning devices...</p>
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
        </main>
      </div>
      <UpdatePanel />
    </div>
  )
}

export default App
