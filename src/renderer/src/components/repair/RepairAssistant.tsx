import React, { useState, useEffect, useRef } from 'react'
import { AlertTriangle, Shield, CheckCircle2, X, Terminal, RefreshCw, AlertCircle, Info, Calendar, Zap, Activity } from 'lucide-react'

interface FsHealthStatus {
  driveLetter: string
  isDirty: boolean
  needsRepair: boolean
  offlineRepairRequired: boolean
  message: string
  severity: 'low' | 'medium' | 'high' | 'critical'
}

interface RepairAssistantProps {
  driveLetter: string
  onClose: () => void
  onRepairSuccess?: () => void
}

export const RepairAssistant: React.FC<RepairAssistantProps> = ({ driveLetter, onClose, onRepairSuccess }) => {
  const [health, setHealth] = useState<FsHealthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [repairing, setRepairing] = useState(false)
  const [repairMode, setRepairMode] = useState<'scan' | 'spotfix' | 'fix' | 'schedule'>('scan')
  const [progress, setProgress] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const [repairDone, setRepairDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    checkHealth()
  }, [driveLetter])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [log])

  const checkHealth = async () => {
    setLoading(true)
    setError(null)
    try {
      const status = await window.api.health.checkFs(driveLetter)
      setHealth(status)
      if (status.offlineRepairRequired) {
        setRepairMode('fix')
      } else if (status.needsRepair) {
        setRepairMode('spotfix')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const startRepair = async () => {
    if (repairMode === 'schedule') {
      await handleSchedule()
      return
    }

    setRepairing(true)
    setLog([])
    setProgress(0)
    setError(null)

    const unSubOutput = window.api.health.onChkdskOutput((data: any) => {
      if (data.driveLetter.startsWith(driveLetter.replace(':', ''))) {
        setLog(prev => [...prev.slice(-199), data.line])
      }
    })

    const unSubProgress = window.api.health.onChkdskProgress((data: any) => {
      if (data.driveLetter.startsWith(driveLetter.replace(':', ''))) {
        setProgress(data.progress)
      }
    })

    try {
      const res = await window.api.health.runChkdsk(driveLetter, repairMode)
      if (res.needsReboot || res.error?.includes('reboot')) {
        setRepairMode('schedule')
        setLog(prev => [...prev, '[SYS] This volume requires an offline repair.', '[SYS] Scheduling reboot fix...'])
        // Automatically try to schedule if we were in 'fix' mode
        if (repairMode === 'fix' || repairMode === 'spotfix') {
           await handleSchedule()
        }
      } else if (res.clean) {
        setRepairDone(true)
        onRepairSuccess?.()
      } else {
        setError(res.error || "Repair completed but some issues might remain.")
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      unSubOutput()
      unSubProgress()
      setRepairing(false)
    }
  }

  const handleSchedule = async () => {
    setRepairing(true)
    try {
      const res = await window.api.health.scheduleReboot(driveLetter)
      if (res.success) {
        setRepairDone(true)
        setLog([res.message])
      } else {
        setError(res.message)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setRepairing(false)
    }
  }

  if (loading) {
    return (
      <div className="glass-panel p-8 flex flex-col items-center justify-center min-h-[300px]">
        <RefreshCw className="w-8 h-8 text-primary animate-spin mb-4" />
        <p className="text-muted font-bold animate-pulse uppercase tracking-widest text-[10px]">Analyzing Filesystem Integrity...</p>
      </div>
    )
  }

  const severityColor = health?.severity === 'critical' ? 'text-accent' : health?.severity === 'high' ? 'text-warning' : 'text-primary'
  const severityBg = health?.severity === 'critical' ? 'bg-accent/10 border-accent/20' : health?.severity === 'high' ? 'bg-warning/10 border-warning/20' : 'bg-primary/10 border-primary/20'

  return (
    <div className="glass-panel overflow-hidden flex flex-col max-h-[90vh] w-full max-w-2xl border-white/10 shadow-2xl">
      {/* Header */}
      <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl ${severityBg} ${severityColor}`}>
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-black text-foreground leading-none">Filesystem Repair Assistant</h3>
            <p className="text-[10px] font-bold text-muted uppercase tracking-widest mt-1.5">Drive {driveLetter}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-muted transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6 custom-scrollbar">
        {!repairing && !repairDone ? (
          <>
            {/* Status Section */}
            <div className={`p-5 rounded-2xl border ${severityBg} relative overflow-hidden`}>
              <div className="flex items-start gap-4 relative z-10">
                <AlertTriangle className={`w-8 h-8 ${severityColor} shrink-0`} />
                <div>
                  <h4 className={`text-sm font-black uppercase tracking-wider ${severityColor}`}>
                    {health?.offlineRepairRequired ? 'Severe Corruption Detected' : 'Issues Found'}
                  </h4>
                  <p className="text-sm text-foreground/90 mt-1 font-medium leading-relaxed">
                    {health?.message}
                  </p>
                </div>
              </div>
            </div>

            {/* Recommendation */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="glass-card p-4 border-white/5">
                <span className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2">Recommended Repair</span>
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-success/10 text-success border border-success/20">
                    <Zap className="w-4 h-4" />
                  </div>
                  <span className="text-[13px] font-bold text-foreground">
                    {repairMode === 'fix' ? 'CHKDSK /F (Full Fix)' : repairMode === 'spotfix' ? 'CHKDSK /SpotFix' : 'Verify Only'}
                  </span>
                </div>
              </div>
              <div className="glass-card p-4 border-white/5">
                <span className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2">Risk Level</span>
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg ${severityBg} ${severityColor}`}>
                    <Activity className="w-4 h-4" />
                  </div>
                  <span className="text-[13px] font-bold text-foreground uppercase tracking-wider">{health?.severity}</span>
                </div>
              </div>
            </div>

            {/* Warning */}
            <div className="p-4 rounded-xl border border-accent/30 bg-accent/5 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-accent shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-accent uppercase tracking-widest">Safety Warning</p>
                <p className="text-xs text-foreground/70 mt-1 leading-relaxed">
                  Filesystem repair can occasionally cause data loss in severely damaged sectors. 
                  <span className="font-bold text-foreground ml-1">Always backup important data before proceeding.</span>
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 mt-2">
              <button
                onClick={() => { setRepairMode(health?.offlineRepairRequired ? 'fix' : 'spotfix'); startRepair(); }}
                className="btn-primary w-full py-4 flex items-center justify-center gap-3 font-black text-[14px] uppercase tracking-widest group shadow-lg shadow-primary/20"
              >
                <Shield className="w-5 h-5 group-hover:scale-110 transition-transform" />
                Repair Safely
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => { setRepairMode('scan'); startRepair(); }}
                  className="flex-1 p-3 rounded-xl bg-surface border border-white/5 hover:border-white/20 text-muted font-bold text-[11px] uppercase tracking-widest transition-all"
                >
                  Scan Only
                </button>
                <button
                  onClick={() => window.electron.shell.openExternal('https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/chkdsk')}
                  className="p-3 rounded-xl bg-surface border border-white/5 hover:border-white/20 text-muted transition-all"
                >
                  <Info className="w-5 h-5" />
                </button>
              </div>
            </div>
          </>
        ) : repairDone ? (
          <div className="flex flex-col items-center justify-center py-10 text-center animate-in zoom-in-95 duration-500">
            <div className="w-20 h-20 rounded-full bg-success/20 flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(34,197,94,0.2)]">
              <CheckCircle2 className="w-10 h-10 text-success" />
            </div>
            <h4 className="text-xl font-black text-foreground">Repair Process Complete</h4>
            <p className="text-muted text-sm mt-2 max-w-sm">
              {repairMode === 'schedule' 
                ? 'The repair has been successfully scheduled. It will run automatically the next time you restart Windows.' 
                : 'The filesystem repair has completed successfully. No further action is required.'}
            </p>
            <button onClick={onClose} className="mt-8 px-10 py-3 rounded-xl bg-surface border border-white/10 hover:border-primary/50 font-bold text-sm transition-all">
              Close Assistant
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-6 animate-in fade-in duration-300">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-primary animate-spin" />
                <span className="text-sm font-black text-foreground uppercase tracking-widest">
                  {repairMode === 'schedule' ? 'Scheduling Repair...' : 'Repairing Filesystem...'}
                </span>
              </div>
              <span className="text-sm font-black text-primary">{progress}%</span>
            </div>

            <div className="h-2 w-full bg-white/[0.03] rounded-full overflow-hidden border border-white/5">
              <div
                className="h-full bg-primary shadow-[0_0_15px_var(--color-primary)] transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Terminal Console */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-muted px-1">
                <Terminal className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Live Output Stream</span>
              </div>
              <div 
                ref={logRef}
                className="h-[250px] bg-black/60 rounded-2xl border border-white/5 p-4 font-mono text-[11px] overflow-y-auto custom-scrollbar"
              >
                {log.map((line, i) => (
                  <div key={i} className="py-0.5 border-b border-white/[0.02] last:border-0">
                    <span className="text-primary mr-2 opacity-50">{">"}</span>
                    <span className={line.includes('[SYS]') ? 'text-accent' : 'text-foreground/80'}>{line}</span>
                  </div>
                ))}
                {log.length === 0 && <div className="text-muted italic opacity-50">Initializing engine...</div>}
              </div>
            </div>

            {repairMode === 'schedule' && (
              <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 flex items-start gap-3">
                <Calendar className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-primary uppercase tracking-widest">Reboot Required</p>
                  <p className="text-xs text-foreground/70 mt-1">
                    This volume is in use. DriveWatch is scheduling an offline repair. You must restart Windows to complete the process.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-accent/10 border-t border-accent/20 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-accent shrink-0 mt-0.5" />
          <p className="text-xs font-bold text-accent">{error}</p>
        </div>
      )}
    </div>
  )
}
