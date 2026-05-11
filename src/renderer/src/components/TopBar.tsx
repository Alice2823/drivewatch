import React, { useState, useEffect } from 'react'
import { Activity, Pause, Play, Search, RefreshCw, ShieldCheck, HardDrive, Hexagon } from 'lucide-react'
import logo from '../assets/logo.png'

interface TopBarProps {
  lastUpdated: Date | null
  isPaused: boolean
  onTogglePause: () => void
}

export const TopBar: React.FC<TopBarProps> = React.memo(({
  lastUpdated,
  isPaused,
  onTogglePause
}) => {
  const [timeAgo, setTimeAgo] = useState<string>('')
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    window.api.getAppVersion().then(setVersion)
  }, [])

  // Tick every second to update the "Xs ago" counter
  useEffect(() => {
    const update = () => {
      if (!lastUpdated) {
        setTimeAgo('')
        return
      }
      const seconds = Math.floor((Date.now() - lastUpdated.getTime()) / 1000)
      if (seconds < 60) {
        setTimeAgo(`${seconds}s ago`)
      } else {
        setTimeAgo(`${Math.floor(seconds / 60)}m ago`)
      }
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [lastUpdated])

  return (
    <header className="w-full border-b border-white/5 bg-background/90 z-10 sticky top-0">
      <div className="w-full max-w-full flex flex-col md:flex-row items-center justify-between px-6 py-4 gap-4 md:gap-0">

        {/* Left: Brand */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 md:w-11 md:h-11 rounded-xl overflow-hidden bg-primary/10 border border-primary/20 relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-white/10 pointer-events-none rounded-xl" />
              <img src={logo} alt="DriveWatch Logo" className="w-6 h-6 md:w-7 md:h-7 object-contain relative z-10" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-[20px] md:text-[22px] font-bold tracking-tight text-foreground leading-none mb-1">DriveWatch</h1>
              <div className="flex items-center gap-2.5 mt-0.5">
                <div className="relative flex items-center justify-center w-2 h-2">
                  <div className={`absolute inset-0 rounded-full animate-ping opacity-20 ${isPaused ? 'bg-amber-500' : 'bg-emerald-500'
                    }`} />
                  <div className={`relative w-1.5 h-1.5 rounded-full ${isPaused ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                    }`} />
                </div>
                <span className="text-[10px] md:text-[11px] font-black uppercase tracking-[0.15em] text-muted/60">
                  {isPaused ? 'Paused' : 'Monitoring'}
                </span>
              </div>
            </div>
          </div>

          {/* Mobile Status + Controls (visible only on small screens) */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={onTogglePause}
              className={`group relative flex items-center gap-3 px-4 py-2 rounded-full border transition-all duration-300 ${isPaused
                ? 'bg-zinc-900/40 border-white/5 text-muted/80'
                : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                }`}
            >
              <div className="relative flex items-center justify-center">
                {!isPaused && (
                  <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping scale-125 opacity-20" />
                )}
                <div className={`w-1.5 h-1.5 rounded-full ${isPaused ? 'bg-zinc-600' : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                  }`} />
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest">
                {isPaused ? 'Paused' : 'Live'}
              </span>
            </button>
          </div>
        </div>

        {/* Tab Navigation Removed - Now in Sidebar */}

        {/* Right: Status + Controls (Desktop) */}
        <div className="hidden md:flex items-center gap-5">
          {/* Update Check Button */}
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('show-updater'))
              window.updater.check()
            }}
            className="relative flex items-center gap-2.5 px-5 py-2 rounded-full overflow-hidden bg-[#0a0a0c] border border-white/5 hover:border-primary/40 transition-colors duration-150 group"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
            <RefreshCw className="w-3.5 h-3.5 text-primary/70 group-hover:text-primary transition-colors duration-150 relative z-10" />
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-muted group-hover:text-white transition-colors duration-300 relative z-10">
              System Update
            </span>
          </button>

          {/* Last Updated */}
          <div className="flex flex-col items-end justify-center px-4 py-1.5 rounded-xl bg-surface/30 border border-white/5">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted/60 leading-none mb-1">Last Update</span>
            <span className="text-[13px] font-black text-foreground/90 tabular-nums leading-none">
              {timeAgo || 'Initializing...'}
            </span>
          </div>

          {/* Control Buttons */}
          <div className="flex items-center gap-3">
            <button
              id="toggle-pause"
              onClick={onTogglePause}
              className={`group relative flex items-center gap-3 px-4 py-2 rounded-full border transition-all duration-300 ${isPaused
                ? 'bg-zinc-900/40 border-white/5 hover:border-amber-500/30 text-muted/80'
                : 'bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.05)] text-emerald-400'
                }`}
              title={isPaused ? 'Resume monitoring' : 'Pause monitoring'}
            >
              <div className="relative flex items-center justify-center">
                {!isPaused && (
                  <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping scale-150 opacity-20" />
                )}
                <div className={`w-2 h-2 rounded-full transition-all duration-500 ${isPaused ? 'bg-zinc-600' : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                  }`} />
              </div>

              <span className={`text-[10px] font-black uppercase tracking-[0.2em] transition-colors duration-300 ${isPaused ? 'group-hover:text-amber-500' : 'text-emerald-400'
                }`}>
                {isPaused ? 'Paused' : 'Live'}
              </span>

              {/* Sophisticated highlight effect */}
              <div className={`absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none ${isPaused
                ? 'bg-gradient-to-tr from-amber-500/5 via-transparent to-transparent'
                : 'bg-gradient-to-tr from-emerald-500/10 via-transparent to-white/5'
                }`} />
            </button>
          </div>
        </div>
      </div>
    </header>
  )
})

TopBar.displayName = 'TopBar'
