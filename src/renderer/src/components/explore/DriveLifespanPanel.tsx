import React, { useState, useEffect, useMemo } from 'react'
import { 
  Shield, 
  Clock, 
  Thermometer, 
  Activity, 
  AlertTriangle, 
  Info, 
  TrendingUp, 
  Zap, 
  CheckCircle2,
  AlertCircle
} from 'lucide-react'
import { LifespanAnalysis, LifespanEngineInput } from '../../services/driveLifespan/types'
import { analyzeDriveLifespan } from '../../services/driveLifespan/lifespanEngine'
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'

interface DriveLifespanPanelProps {
  driveData: any // Existing drive data with attributes
}

export const DriveLifespanPanel: React.FC<DriveLifespanPanelProps> = ({ driveData }) => {
  const [analysis, setAnalysis] = useState<LifespanAnalysis | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const lastDiskId = React.useRef<string | null>(null)
  const isAnalyzing = React.useRef(false)

  useEffect(() => {
    if (!driveData?.attributes || !driveData?.serial) {
      if (!analysis && !isLoading) setIsLoading(false)
      return
    }

    const currentDiskId = `${driveData.diskIndex}-${driveData.serial}`
    const isNewDrive = lastDiskId.current !== currentDiskId
    
    if (isNewDrive) {
      setIsLoading(true)
      setAnalysis(null)
      lastDiskId.current = currentDiskId
    }

    // Passive update: only run analysis if not already running
    if (isAnalyzing.current) return
    
    const runAnalysis = async () => {
      isAnalyzing.current = true
      try {
        const input: LifespanEngineInput = {
          attributes: driveData.attributes,
          temperature: driveData.temperature,
          powerOnHours: driveData.powerOnHours,
          model: driveData.name || 'Unknown Drive',
          type: (driveData.type || '').toLowerCase().includes('ssd') ? 'SSD' : 'HDD'
        }
        
        const result = await analyzeDriveLifespan(input)
        setAnalysis(result)
      } finally {
        setIsLoading(false)
        isAnalyzing.current = false
      }
    }

    runAnalysis()
  }, [driveData])

  const scoreColor = useMemo(() => {
    if (!analysis) return 'var(--color-muted)'
    const s = analysis.reliabilityScore
    if (s >= 90) return 'var(--color-success)'
    if (s >= 75) return 'var(--color-primary)'
    if (s >= 50) return 'var(--color-warning)'
    return 'var(--color-accent)'
  }, [analysis])

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 animate-pulse p-8">
        <div className="h-32 bg-white/5 rounded-3xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-64 bg-white/5 rounded-3xl" />
          <div className="h-64 bg-white/5 rounded-3xl" />
        </div>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center glass-card border-white/5">
        <Info className="w-12 h-12 text-muted mb-4" />
        <h3 className="text-xl font-bold text-foreground">Insufficient Telemetry</h3>
        <p className="text-muted max-w-md mt-2">
          Unable to perform lifespan analysis. Ensure SMART data is available for this drive.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8 animate-fade-in pb-12">
      {/* ── TOP SECTION: PRIMARY METRICS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Reliability Score Card */}
        <div className="lg:col-span-1 glass-card p-8 flex flex-col items-center justify-center relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
          <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          
          <div className="flex items-center gap-2 mb-8">
            <Shield className="w-5 h-5 text-primary" />
            <span className="text-xs font-black uppercase tracking-[0.2em] text-muted">Reliability Score</span>
          </div>

          <div className="relative flex items-center justify-center">
            <svg className="w-48 h-48 transform -rotate-90">
              <circle
                cx="96" cy="96" r="88"
                fill="none" stroke="currentColor" strokeWidth="12"
                className="text-white/5"
              />
              <circle
                cx="96" cy="96" r="88"
                fill="none" stroke={scoreColor} strokeWidth="12"
                strokeDasharray={552.92}
                strokeDashoffset={552.92 - (552.92 * analysis.reliabilityScore) / 100}
                strokeLinecap="round"
                className="transition-[stroke-dashoffset] duration-300 ease-out"
              />
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
          }`}>
            {analysis.healthQuality}
          </div>
        </div>

        {/* Life Expectancy & Risk */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-card p-8 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-6">
                <Clock className="w-5 h-5 text-primary" />
                <span className="text-xs font-black uppercase tracking-[0.2em] text-muted">Remaining Lifespan</span>
              </div>
              <div className="flex flex-col">
                <span className="text-4xl font-black text-foreground tracking-tight">
                  ≈ {analysis.estimatedRemainingYears[0]} – {analysis.estimatedRemainingYears[1]}
                </span>
                <span className="text-lg font-bold text-muted mt-1">Estimated Years</span>
              </div>
            </div>
            <p className="text-xs text-muted leading-relaxed mt-4">
              Prediction based on current wear level, historical SMART trends, and industry reliability profiles.
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
                }`}>
                  {analysis.riskLevel}
                </span>
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
            <div className="mt-4 p-3 rounded-2xl bg-white/5 border border-white/5 flex items-start gap-3">
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

      {/* ── MIDDLE SECTION: ANALYSIS DETAILS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Thermal & Impact Factors */}
        <div className="flex flex-col gap-6">
          {/* Thermal Zone */}
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
                <h4 className="text-sm font-black text-foreground uppercase tracking-tight">Thermal Condition</h4>
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

          {/* Impact Factors List */}
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

        {/* Probabilities & Insights */}
        <div className="flex flex-col gap-8">
           {/* Failure Probability Graph */}
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
                    <XAxis 
                      dataKey="period" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fontWeight: 'bold', fill: 'var(--color-muted)' }}
                    />
                    <YAxis hide domain={[0, 100]} />
                    <Tooltip 
                      contentStyle={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                      itemStyle={{ color: 'var(--color-primary)', fontWeight: 'bold' }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="probability" 
                      stroke="var(--color-primary)" 
                      fill="url(#probGradient)" 
                      strokeWidth={3} 
                      name="Probability (%)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
           </div>

           {/* SMART Insights */}
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

      {/* ── FOOTER: DISCLAIMER ── */}
      <div className="mt-8 flex flex-col items-center border-t border-white/5 pt-8 text-center">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-primary opacity-50" />
          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-muted">DriveWatch Intelligence Engine</span>
        </div>
        <p className="text-[10px] text-muted/60 max-w-lg leading-relaxed uppercase tracking-wider">
          Predictions are estimates based on SMART telemetry and usage patterns. Actual drive lifespan may vary. This is a read-only analytics layer and does not guarantee hardware performance or durability.
        </p>
      </div>
    </div>
  )
}
