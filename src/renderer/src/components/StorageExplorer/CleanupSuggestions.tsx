import React, { useState, useEffect, useCallback } from 'react'
import { Trash2, Sparkles, HardDrive, FileText, Zap, Clock } from 'lucide-react'

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export const CleanupSuggestions: React.FC<{ drivePath?: string }> = ({ drivePath }) => {
  const [suggestions, setSuggestions] = useState<{ largeUnused: any[]; junkFiles: any[] }>({ largeUnused: [], junkFiles: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [optResult, setOptResult] = useState<{ deletedCount: number; freedSpace: number } | null>(null)

  const loadSuggestions = useCallback(async () => {
    const data = await window.api.storage.getSuggestions(drivePath)
    setSuggestions(data)
    setIsLoading(false)
  }, [drivePath])

  useEffect(() => {
    loadSuggestions()
  }, [loadSuggestions])

  const handleOptimize = async () => {
    if (suggestions.junkFiles.length === 0) {
      // Still allow optimization because we added the targeted temp folder purge
    }
    
    if (!confirm(`Warning: This will permanently purge system junk clusters to optimize performance. Proceed?`)) return
    
    setIsOptimizing(true)
    try {
      const res = await window.api.storage.optimize()
      if (res.success) {
        setOptResult({ deletedCount: res.deletedCount, freedSpace: res.freedSpace })
        await loadSuggestions()
        setTimeout(() => setOptResult(null), 8000)
      }
    } catch (err) {
      console.error('Optimization failed:', err)
    } finally {
      setIsOptimizing(false)
    }
  }

  const handleDelete = async (path: string) => {
    if (!confirm('Move to Recycle Bin?')) return
    const res = await window.api.storage.delete([path])
    if (res.success) {
      setSuggestions(prev => ({
        largeUnused: prev.largeUnused.filter(f => f.path !== path),
        junkFiles: prev.junkFiles.filter(f => f.path !== path)
      }))
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 text-muted">
         <div className="relative">
           <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse" />
           <Sparkles className="w-12 h-12 animate-spin-slow text-primary/60 relative z-10" />
         </div>
         <span className="text-[10px] font-black uppercase tracking-[0.3em] animate-pulse">Synthesizing Neural Insights...</span>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto pr-4 scrollbar-thin scrollbar-thumb-white/10 space-y-10 pb-12 animate-fade-in">
      {/* ── PREMIUM OPTIMIZATION BANNER ── */}
      <div className="relative overflow-hidden rounded-[3rem] border border-white/10 bg-[#080808]/40 backdrop-blur-3xl shadow-2xl group">
        {/* Animated Background Orbs */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/10 blur-[140px] rounded-full -mr-80 -mt-80 animate-pulse duration-[4000ms]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-accent/5 blur-[120px] rounded-full -ml-40 -mb-40" />
        
        <div className="relative z-10 p-12 flex flex-col xl:flex-row items-center justify-between gap-12">
          <div className="flex flex-col md:flex-row items-center gap-10 text-center md:text-left">
            <div className="relative group/icon">
              <div className="absolute inset-0 bg-primary/30 blur-3xl rounded-full opacity-0 group-hover/icon:opacity-100 transition-opacity duration-1000" />
              <div className="relative w-24 h-24 flex items-center justify-center bg-gradient-to-br from-white/10 to-transparent rounded-[2.5rem] border border-white/10 shadow-inner overflow-hidden">
                <Sparkles className={`w-12 h-12 ${isOptimizing ? 'animate-spin text-primary' : 'text-primary'} transition-all duration-700 group-hover/icon:scale-125 group-hover/icon:rotate-12`} />
                {isOptimizing && (
                  <div className="absolute inset-0 border-4 border-primary/20 border-t-primary rounded-[2.5rem] animate-spin" />
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-center md:justify-start gap-4">
                <span className="px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-[9px] font-black text-primary uppercase tracking-[0.2em] shadow-lg shadow-primary/5">
                  Quantum Engine v2.4
                </span>
                {optResult && (
                  <span className="px-4 py-1.5 rounded-full bg-success/10 border border-success/20 text-[9px] font-black text-success uppercase tracking-[0.2em] animate-bounce">
                    Purge Success
                  </span>
                )}
              </div>
              <h2 className="text-4xl font-black text-white tracking-tighter leading-tight">
                {optResult ? 'System Optimized' : 'Smart Optimization Engine'}
              </h2>
              <p className="text-muted/50 text-base font-medium max-w-lg leading-relaxed">
                {optResult 
                  ? `Purged ${optResult.deletedCount} system clusters, recovering ${formatBytes(optResult.freedSpace)} of potential disk bandwidth.`
                  : 'Advanced neural mapping detects high-impact cleanup targets to keep your storage running at peak theoretical performance.'
                }
              </p>
            </div>
          </div>

          <button 
            onClick={handleOptimize}
            disabled={isOptimizing}
            className={`group relative overflow-hidden px-14 py-6 rounded-[2rem] font-black text-[11px] uppercase tracking-[0.3em] transition-all duration-700 shadow-2xl ${
              isOptimizing 
                ? 'bg-white/5 text-muted cursor-not-allowed border border-white/5' 
                : 'bg-primary text-white hover:shadow-[0_25px_60px_-15px_rgba(var(--color-primary-rgb),0.6)] hover:scale-[1.03] active:scale-95'
            }`}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            <span className="relative z-10 flex items-center gap-3">
              {isOptimizing ? (
                <>
                  <div className="w-2 h-2 bg-white rounded-full animate-ping" />
                  Running Neural Purge...
                </>
              ) : (
                'Execute Deep Optimization'
              )}
            </span>
          </button>
        </div>
      </div>

      {/* ── SUGGESTIONS GRID ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
        {/* Forgotten Giants */}
        <div className="space-y-6">
          <div className="flex items-center justify-between px-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-2xl bg-warning/10 border border-warning/20 flex items-center justify-center shadow-lg shadow-warning/5">
                <HardDrive className="w-5 h-5 text-warning" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-foreground/90">Forgotten Giants</h3>
                <p className="text-[9px] font-bold text-muted/40 uppercase tracking-widest mt-0.5">Size {">"} 10MB • 1D Inactivity</p>
              </div>
            </div>
            <span className="text-[10px] font-black text-muted/20 tracking-[0.2em]">{suggestions.largeUnused.length} UNITS</span>
          </div>
          
          <div className="bg-surface/10 rounded-[2.5rem] border border-white/5 overflow-hidden shadow-xl">
            {suggestions.largeUnused.length === 0 ? (
              <div className="py-24 text-center">
                <div className="inline-flex p-4 bg-white/5 rounded-full mb-4">
                  <Clock className="w-8 h-8 text-muted/20" />
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted/30">All sectors clear</p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.03]">
                {suggestions.largeUnused.slice(0, 15).map(file => (
                  <div key={file.path} className="group flex items-center justify-between p-6 hover:bg-white/[0.02] transition-all duration-300">
                    <div className="flex items-center gap-5 min-w-0">
                      <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center shrink-0 group-hover:bg-warning/10 transition-colors">
                        <FileText className="w-6 h-6 text-muted/30 group-hover:text-warning/60" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-bold truncate text-foreground/70 group-hover:text-foreground transition-colors">{file.name}</span>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-black text-warning">{formatBytes(file.size)}</span>
                          <span className="w-1 h-1 rounded-full bg-white/10" />
                          <span className="text-[10px] font-medium text-muted/30 truncate pr-4">{file.path}</span>
                        </div>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleDelete(file.path)}
                      className="p-4 bg-white/0 rounded-2xl opacity-0 group-hover:opacity-100 transition-all hover:bg-accent/20 hover:text-accent transform group-hover:translate-x-0 translate-x-4"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Digital Waste */}
        <div className="space-y-6">
          <div className="flex items-center justify-between px-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center shadow-lg shadow-accent/5">
                <Zap className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-foreground/90">Digital Waste</h3>
                <p className="text-[9px] font-bold text-muted/40 uppercase tracking-widest mt-0.5">System Cache • Logs • Temp Clusters</p>
              </div>
            </div>
            <span className="text-[10px] font-black text-muted/20 tracking-[0.2em]">{suggestions.junkFiles.length} CLUSTERS</span>
          </div>

          <div className="bg-surface/10 rounded-[2.5rem] border border-white/5 overflow-hidden shadow-xl">
            {suggestions.junkFiles.length === 0 ? (
              <div className="py-24 text-center">
                 <div className="inline-flex p-4 bg-white/5 rounded-full mb-4">
                  <Zap className="w-8 h-8 text-muted/20" />
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted/30">System Optimized</p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.03]">
                {suggestions.junkFiles.slice(0, 15).map(file => (
                  <div key={file.path} className="group flex items-center justify-between p-6 hover:bg-white/[0.02] transition-all duration-300">
                    <div className="flex items-center gap-5 min-w-0">
                      <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                        <DatabaseIcon className="w-6 h-6 text-muted/30 group-hover:text-primary/60" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-bold truncate text-foreground/70 group-hover:text-foreground transition-colors">{file.name}</span>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-black text-primary">{formatBytes(file.size)}</span>
                          <span className="w-1 h-1 rounded-full bg-white/10" />
                          <span className="text-[10px] font-medium text-muted/30 truncate pr-4">{file.path}</span>
                        </div>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleDelete(file.path)}
                      className="p-4 bg-white/0 rounded-2xl opacity-0 group-hover:opacity-100 transition-all hover:bg-accent/20 hover:text-accent transform group-hover:translate-x-0 translate-x-4"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const DatabaseIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M3 5V19A9 3 0 0 0 21 19V5"/>
    <path d="M3 12A9 3 0 0 0 21 12"/>
  </svg>
)
