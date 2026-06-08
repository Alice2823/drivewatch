import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Shield, Clock, Thermometer, Activity, AlertTriangle,
  Info, Zap, CheckCircle2, AlertCircle, RefreshCw, Bug
} from 'lucide-react'
import { LifespanAnalysis, LifespanEngineInput } from '../../services/driveLifespan/types'
import { analyzeDriveLifespan } from '../../services/driveLifespan/lifespanEngine'
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'

interface DriveLifespanPanelProps { driveData: any }

// ── Debug Panel ───────────────────────────────────────────────────────────────
const DebugPanel: React.FC<{
  diskIndex: number | undefined
  scanResult: any
  analysis: LifespanAnalysis | null
  fetchCount: number
  phase: string
}> = ({ diskIndex, scanResult, analysis, fetchCount, phase }) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl border border-yellow-400/30 bg-yellow-500/5 p-4">
      <button onClick={() => setOpen(v => !v)} className="flex items-center gap-2 text-yellow-400 text-xs font-black uppercase tracking-widest w-full">
        <Bug className="w-3.5 h-3.5" />
        Telemetry Debug Panel
        <span className="ml-auto opacity-60">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 font-mono text-[11px] space-y-1 text-yellow-200/80">
          <div><span className="text-yellow-400">Phase:</span> {phase}</div>
          <div><span className="text-yellow-400">Fetch count:</span> {fetchCount}</div>
          <div><span className="text-yellow-400">diskIndex requested:</span> {diskIndex ?? 'undefined'}</div>
          <div><span className="text-yellow-400">Scan result found:</span> {scanResult === undefined ? '⏳ not yet fetched' : scanResult ? '✅ YES' : '❌ NO (null)'}</div>
          {scanResult && (<>
            <div><span className="text-yellow-400">Stored diskIndex:</span> {scanResult.diskIndex}</div>
            <div><span className="text-yellow-400">slowCount:</span> {scanResult.slowCount}</div>
            <div><span className="text-yellow-400">errorCount:</span> {scanResult.errorCount}</div>
            <div><span className="text-yellow-400">weakSectors:</span> {scanResult.weakSectors?.length ?? 0}</div>
            <div><span className="text-yellow-400">scanMode:</span> {scanResult.scanMode}</div>
          </>)}
          {!scanResult && scanResult !== undefined && (
            <div className="text-orange-400 mt-1">⚠️ No scan data — run Surface Scan first, or diskIndex mismatch!</div>
          )}
          {analysis && (<>
            <div className="border-t border-yellow-400/20 mt-2 pt-2">
              <div><span className="text-yellow-400">Reliability:</span> {analysis.reliabilityScore}</div>
              <div><span className="text-yellow-400">Risk:</span> {analysis.riskLevel}</div>
              <div><span className="text-yellow-400">Lifespan:</span> {analysis.estimatedRemainingYears[0]}–{analysis.estimatedRemainingYears[1]} yrs</div>
              <div><span className="text-yellow-400">Surface insights:</span> {analysis.smartInsights.filter(i => i.attributeId >= 9990).length > 0 ? '✅ present' : '⚠️ none'}</div>
            </div>
          </>)}
        </div>
      )}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export const DriveLifespanPanel: React.FC<DriveLifespanPanelProps> = ({ driveData }) => {
  // undefined = not yet fetched; null = fetched, no data; object = has data
  const [scanTelemetry, setScanTelemetry] = useState<any>(undefined)
  const [analysis, setAnalysis] = useState<LifespanAnalysis | null>(null)
  const [phase, setPhase] = useState<'fetching' | 'analyzing' | 'done'>('fetching')
  const [fetchCount, setFetchCount] = useState(0)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  // Refs — avoids stale closures entirely
  const generationRef = useRef(0)
  const fetchFnRef = useRef<(() => Promise<void>) | undefined>(undefined)
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const isAnalyzingRef = useRef(false)

  // Disk key — reset everything when drive changes
  const diskKey = `${driveData?.diskIndex}-${driveData?.name}`

  useEffect(() => {
    // New drive selected → bump generation, wipe state
    generationRef.current++
    const myGen = generationRef.current

    setScanTelemetry(undefined)
    setAnalysis(null)
    setPhase('fetching')
    setFetchCount(0)
    setAnalysisError(null)
    isAnalyzingRef.current = false

    // Clear old interval
    if (intervalRef.current) clearInterval(intervalRef.current)

    const diskIdx: number = driveData?.diskIndex
    if (diskIdx === undefined || diskIdx === null) return

    // Fetch function stored in ref so interval always calls latest version
    const doFetch = async () => {
      try {
        const driveModel: string = driveData?.name ?? ''
        const driveSerial: string = driveData?.serial ?? ''
        const driveDevicePath = `\\\\.\\PhysicalDrive${diskIdx}`
        console.log(`[DriveLifespanPanel] Fetching scan result: diskIndex=${diskIdx}, model="${driveModel}", serial="${driveSerial}", device="${driveDevicePath}"`)
        const res = await window.api.surfaceScan.getLastResult(diskIdx, driveModel, driveSerial, driveDevicePath)
        if (generationRef.current !== myGen) return

        console.log(`[DriveLifespanPanel] Telemetry for diskIndex=${diskIdx}:`,
          res ? `slowCount=${res.slowCount}, errorCount=${res.errorCount}` : 'null')

        setFetchCount(c => c + 1)
        setScanTelemetry((prev: any) => {
          if (JSON.stringify(prev) === JSON.stringify(res)) return prev
          return res
        })
      } catch {
        if (generationRef.current === myGen) {
          setScanTelemetry((prev: any) => prev === undefined ? null : prev)
        }
      }
    }

    fetchFnRef.current = doFetch

    // First fetch immediately, then every 3s
    doFetch()
    intervalRef.current = setInterval(() => fetchFnRef.current?.(), 3000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diskKey])

  // Run analysis whenever driveData or scanTelemetry changes (and telemetry was fetched)
  useEffect(() => {
    if (!driveData || scanTelemetry === undefined) return
    if (isAnalyzingRef.current) return

    const myGen = generationRef.current
    isAnalyzingRef.current = true
    setPhase('analyzing')
    setAnalysisError(null)

    const input: LifespanEngineInput = {
      attributes: driveData.attributes || [],
      temperature: driveData.temperature ?? null,
      powerOnHours: driveData.powerOnHours ?? null,
      model: driveData.name || 'Unknown Drive',
      type: (driveData.type || '').toLowerCase().includes('ssd') ? 'SSD' : 'HDD',
      smartAvailable: driveData.available === true,
      smartUnsupported: driveData.unsupported === true,
      surfaceScanResult: scanTelemetry  // null is valid — means no scan run yet
    }

    console.log(`[DriveLifespanPanel] ⚡ Analyzing "${input.model}" (diskIndex=${driveData.diskIndex}):`, {
      attributes: input.attributes.length,
      hasSurface: !!scanTelemetry,
      slowCount: scanTelemetry?.slowCount ?? 'N/A',
      errorCount: scanTelemetry?.errorCount ?? 'N/A'
    })

    analyzeDriveLifespan(input).then(result => {
      if (generationRef.current !== myGen) return
      console.log(`[DriveLifespanPanel] ✅ score=${result.reliabilityScore}, risk=${result.riskLevel}, lifespan=${result.estimatedRemainingYears}`)
      setAnalysis(result)
      setPhase('done')
    }).catch(err => {
      if (generationRef.current !== myGen) return
      setAnalysisError(err?.message || 'Analysis failed')
      setPhase('done')
    }).finally(() => {
      isAnalyzingRef.current = false
    })
  }, [driveData, scanTelemetry])

  const scoreColor = useMemo(() => {
    if (!analysis) return 'var(--color-muted)'
    const s = analysis.reliabilityScore
    if (s >= 90) return 'var(--color-success)'
    if (s >= 75) return 'var(--color-primary)'
    if (s >= 50) return 'var(--color-warning)'
    return 'var(--color-accent)'
  }, [analysis])

  const isLoading = phase !== 'done'

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <DebugPanel diskIndex={driveData?.diskIndex} scanResult={scanTelemetry} analysis={null} fetchCount={fetchCount} phase={phase} />
        <div className="flex items-center gap-3 p-6 glass-card rounded-3xl">
          <RefreshCw className="w-5 h-5 animate-spin text-primary shrink-0" />
          <span className="text-sm font-black text-muted uppercase tracking-widest">
            {phase === 'fetching' ? 'Fetching surface scan telemetry...' : 'Computing reliability analysis...'}
          </span>
        </div>
        <div className="animate-pulse flex flex-col gap-6">
          <div className="h-40 bg-white/5 rounded-3xl" />
          <div className="grid grid-cols-2 gap-6">
            <div className="h-52 bg-white/5 rounded-3xl" />
            <div className="h-52 bg-white/5 rounded-3xl" />
          </div>
        </div>
      </div>
    )
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (analysisError) {
    return (
      <div className="flex flex-col gap-4">
        <DebugPanel diskIndex={driveData?.diskIndex} scanResult={scanTelemetry} analysis={null} fetchCount={fetchCount} phase={phase} />
        <div className="p-12 text-center glass-card border-white/5 rounded-3xl">
          <AlertCircle className="w-12 h-12 text-accent mx-auto mb-4" />
          <h3 className="text-xl font-bold text-foreground">Analysis Error</h3>
          <p className="text-muted mt-2 text-sm">{analysisError}</p>
        </div>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="flex flex-col gap-4">
        <DebugPanel diskIndex={driveData?.diskIndex} scanResult={scanTelemetry} analysis={null} fetchCount={fetchCount} phase={phase} />
        <div className="p-12 text-center glass-card border-white/5 rounded-3xl">
          <Info className="w-12 h-12 text-muted mx-auto mb-4" />
          <h3 className="text-xl font-bold text-foreground">Insufficient Telemetry</h3>
          <p className="text-muted mt-2">Ensure SMART data is available for this drive.</p>
        </div>
      </div>
    )
  }

  // ── Full analysis view ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-8 animate-fade-in pb-12">
      <DebugPanel diskIndex={driveData?.diskIndex} scanResult={scanTelemetry} analysis={analysis} fetchCount={fetchCount} phase={phase} />

      {/* Primary metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Reliability Score */}
        <div className="lg:col-span-1 glass-card p-8 flex flex-col items-center justify-center relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
          <div className="flex items-center gap-2 mb-8">
            <Shield className="w-5 h-5 text-primary" />
            <span className="text-xs font-black uppercase tracking-[0.2em] text-muted">Reliability Score</span>
          </div>
          <div className="relative flex items-center justify-center">
            <svg className="w-48 h-48 transform -rotate-90">
              <circle cx="96" cy="96" r="88" fill="none" stroke="currentColor" strokeWidth="12" className="text-white/5" />
              <circle cx="96" cy="96" r="88" fill="none" stroke={scoreColor} strokeWidth="12"
                strokeDasharray={552.92}
                strokeDashoffset={552.92 - (552.92 * analysis.reliabilityScore) / 100}
                strokeLinecap="round" className="transition-[stroke-dashoffset] duration-300 ease-out" />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span className="text-5xl font-black text-foreground tracking-tighter">{analysis.reliabilityScore}</span>
              <span className="text-[10px] font-bold text-muted uppercase tracking-widest mt-1">/ 100</span>
            </div>
          </div>
          <div className={`mt-8 px-6 py-2 rounded-2xl border text-sm font-black uppercase tracking-widest ${
            analysis.healthQuality === 'Excellent' ? 'bg-success/10 border-success/30 text-success' :
            analysis.healthQuality === 'Good' ? 'bg-primary/10 border-primary/30 text-primary' :
            analysis.healthQuality === 'Aging' ? 'bg-warning/10 border-warning/30 text-warning' :
            'bg-accent/10 border-accent/30 text-accent'
          }`}>{analysis.healthQuality}</div>
          {!scanTelemetry && (
            <div className="mt-4 px-4 py-2 rounded-xl bg-orange-500/10 border border-orange-500/30 text-[10px] text-orange-400 font-bold text-center">
              ⚠️ SMART only — run Surface Scan for full accuracy
            </div>
          )}
        </div>

        {/* Lifespan + Risk */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-card p-8 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-6">
                <Clock className="w-5 h-5 text-primary" />
                <span className="text-xs font-black uppercase tracking-[0.2em] text-muted">Remaining Lifespan</span>
              </div>
              <span className="text-4xl font-black text-foreground tracking-tight">
                ≈ {analysis.estimatedRemainingYears[0]} – {analysis.estimatedRemainingYears[1]}
              </span>
              <span className="block text-lg font-bold text-muted mt-1">Estimated Years</span>
            </div>
            <p className="text-xs text-muted leading-relaxed mt-4">
              Based on surface degradation telemetry, SMART trends, and industry reliability profiles.
            </p>
          </div>

          <div className="glass-card p-8 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-6">
                <Activity className="w-5 h-5 text-primary" />
                <span className="text-xs font-black uppercase tracking-[0.2em] text-muted">Risk Level</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className={`text-4xl font-black tracking-tighter ${
                  analysis.riskLevel === 'CRITICAL' ? 'text-accent' :
                  analysis.riskLevel === 'HIGH' ? 'text-warning' :
                  analysis.riskLevel === 'MEDIUM' ? 'text-primary' : 'text-success'
                }`}>{analysis.riskLevel}</span>
                <div className="flex gap-1">
                  {[1,2,3,4].map(i => (
                    <div key={i} className={`w-2 h-6 rounded-full ${
                      (analysis.riskLevel === 'LOW' && i <= 1) ? 'bg-success' :
                      (analysis.riskLevel === 'MEDIUM' && i <= 2) ? 'bg-primary' :
                      (analysis.riskLevel === 'HIGH' && i <= 3) ? 'bg-warning' :
                      (analysis.riskLevel === 'CRITICAL' && i <= 4) ? 'bg-accent' : 'bg-white/5'
                    }`} />
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 p-3 rounded-2xl bg-white/5 border border-white/5 flex gap-3">
              <Info className="w-4 h-4 text-muted shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted font-medium">
                {analysis.riskLevel === 'LOW' ? 'Normal operating risk. Maintain regular backups.' :
                 analysis.riskLevel === 'MEDIUM' ? 'Slightly elevated risk. Monitor telemetry frequently.' :
                 'Elevated failure probability. Backup critical data immediately.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Middle section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="flex flex-col gap-6">
          {/* Thermal */}
          <div className="glass-card p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-4 rounded-2xl border ${
                analysis.thermalStatus.zone === 'Excellent' ? 'bg-success/10 border-success/30 text-success' :
                analysis.thermalStatus.zone === 'Warm' ? 'bg-primary/10 border-primary/30 text-primary' :
                analysis.thermalStatus.zone === 'Hot' ? 'bg-warning/10 border-warning/30 text-warning' :
                'bg-accent/10 border-accent/30 text-accent'
              }`}>
                <Thermometer className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-black text-foreground uppercase">Thermal Condition</h4>
                <p className="text-xs text-muted font-bold mt-0.5">{analysis.thermalStatus.zone} Zone • {analysis.thermalStatus.temperature}°C</p>
              </div>
            </div>
            <div className="text-right">
              <span className={`text-lg font-black ${analysis.thermalStatus.lifespanImpact < 0 ? 'text-accent' : 'text-success'}`}>
                {analysis.thermalStatus.lifespanImpact > 0 ? '+' : ''}{analysis.thermalStatus.lifespanImpact}%
              </span>
              <p className="text-[10px] font-bold text-muted uppercase tracking-widest mt-1">Impact</p>
            </div>
          </div>

          {/* Impact Factors */}
          <div className="glass-card p-8 flex-1">
            <h4 className="text-xs font-black text-muted uppercase tracking-[0.2em] mb-8">Lifespan Impact Factors</h4>
            <div className="space-y-6">
              {analysis.impactFactors.length > 0 ? analysis.impactFactors.map((impact, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    <div>
                      <p className="text-sm font-bold text-foreground/90">{impact.factor}</p>
                      <p className="text-[11px] text-muted font-medium mt-0.5">{impact.description}</p>
                    </div>
                  </div>
                  <span className={`text-sm font-black px-3 py-1 rounded-lg ${impact.impact < 0 ? 'text-accent bg-accent/5' : 'text-success bg-success/5'}`}>
                    {impact.impact > 0 ? '+' : ''}{impact.impact}%
                  </span>
                </div>
              )) : (
                <p className="text-sm text-muted italic">No significant impact factors detected.</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-8">
          {/* Failure Probability */}
          <div className="glass-card p-8 h-[240px] flex flex-col">
            <h4 className="text-xs font-black text-muted uppercase tracking-[0.2em] mb-6">Failure Probability (Est.)</h4>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analysis.failureProbabilities}>
                  <defs>
                    <linearGradient id="probGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="period" axisLine={false} tickLine={false}
                    tick={{ fontSize: 10, fontWeight: 'bold', fill: 'var(--color-muted)' }} />
                  <YAxis hide domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                    itemStyle={{ color: 'var(--color-primary)', fontWeight: 'bold' }} />
                  <Area type="monotone" dataKey="probability" stroke="var(--color-primary)"
                    fill="url(#probGradient)" strokeWidth={3} name="Probability (%)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Insights */}
          <div className="glass-card p-8 flex-1">
            <h4 className="text-xs font-black text-muted uppercase tracking-[0.2em] mb-6">Intelligence Insights</h4>
            <div className="space-y-4">
              {analysis.smartInsights.length > 0 ? analysis.smartInsights.map((insight, i) => (
                <div key={i} className={`p-4 rounded-2xl border flex gap-4 ${
                  insight.severity === 'critical' ? 'bg-accent/5 border-accent/20' :
                  insight.severity === 'warning' ? 'bg-warning/5 border-warning/20' :
                  'bg-white/5 border-white/5'
                }`}>
                  {insight.severity === 'critical' ? <AlertCircle className="w-5 h-5 text-accent shrink-0 mt-0.5" /> :
                   insight.severity === 'warning' ? <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" /> :
                   <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />}
                  <div>
                    <p className={`text-xs font-black uppercase tracking-wider ${
                      insight.severity === 'critical' ? 'text-accent' :
                      insight.severity === 'warning' ? 'text-warning' : 'text-primary'
                    }`}>{insight.name}</p>
                    <p className="text-xs text-foreground/80 font-medium leading-relaxed mt-1">{insight.message}</p>
                  </div>
                </div>
              )) : (
                <div className="flex flex-col items-center justify-center py-8 opacity-40">
                  <CheckCircle2 className="w-8 h-8 text-success mb-2" />
                  <p className="text-xs font-bold text-muted uppercase">All attributes nominal</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 flex flex-col items-center border-t border-white/5 pt-8 text-center">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-primary opacity-50" />
          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-muted">DriveWatch Intelligence Engine</span>
        </div>
        <p className="text-[10px] text-muted/60 max-w-lg leading-relaxed uppercase tracking-wider">
          Predictions are estimates based on SMART telemetry, surface scan data, and usage patterns. Run a Surface Scan first for maximum accuracy.
        </p>
      </div>
    </div>
  )
}
