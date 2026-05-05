import React, { useState, useEffect } from 'react'
import { Activity, Moon, Sun, Pause, Play, Search, RefreshCw, ShieldCheck, HardDrive, Hexagon } from 'lucide-react'
import { useTheme } from './ThemeProvider'
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
  const { isDarkMode, toggleTheme } = useTheme()
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
    <header className="w-full border-b border-white/5 bg-background/50 backdrop-blur-md z-10 sticky top-0">
      <div className="w-full max-w-[1300px] mx-auto flex flex-col md:flex-row items-center justify-between px-4 md:px-8 py-4 gap-4 md:gap-0">
        
        {/* Left: Brand */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 md:w-11 md:h-11 rounded-xl overflow-hidden bg-primary/10 border border-primary/20 shadow-[0_0_15px_rgba(6,182,212,0.15)] relative">
               <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-white/10 pointer-events-none rounded-xl" />
               <img src={logo} alt="DriveWatch Logo" className="w-6 h-6 md:w-7 md:h-7 object-contain relative z-10 drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-[20px] md:text-[22px] font-bold tracking-tight text-foreground leading-none mb-1">DriveWatch</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    isPaused ? 'bg-warning' : 'bg-success'
                  }`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 shadow-[0_0_8px_currentColor] ${
                    isPaused ? 'bg-warning' : 'bg-success'
                  }`} />
                </span>
                <span className="text-[10px] md:text-[12px] font-bold uppercase tracking-wider text-muted">
                  {isPaused ? 'Paused' : 'Live Monitoring'}
                </span>
              </div>
            </div>
          </div>

          {/* Mobile Status + Controls (visible only on small screens) */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={onTogglePause}
              className={`flex items-center justify-center p-2 rounded-full border transition-all shadow-sm ${
                isPaused
                  ? 'bg-warning/20 border-warning/30 text-warning'
                  : 'bg-success/10 border-success/20 text-success'
              }`}
            >
              {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
            </button>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full bg-surface/30 border border-border text-muted"
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
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
            className="relative flex items-center gap-2.5 px-5 py-2 rounded-full overflow-hidden bg-[#0a0a0c] border border-white/5 hover:border-primary/40 transition-all duration-300 group active:scale-[0.96] shadow-[0_4px_15px_rgba(0,0,0,0.4)]"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
            <RefreshCw className="w-3.5 h-3.5 text-primary/70 group-hover:text-primary group-hover:rotate-180 transition-all duration-500 relative z-10" />
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
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl border transition-all duration-200 active:scale-[0.96] ${
                isPaused
                  ? 'bg-warning/10 border-warning/30 text-warning hover:bg-warning/20 shadow-[0_0_15px_rgba(245,158,11,0.1)]'
                  : 'bg-success/10 border-success/30 text-success hover:bg-success/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
              }`}
              title={isPaused ? 'Resume monitoring' : 'Pause monitoring'}
            >
              {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
              <span className="text-[11px] font-black uppercase tracking-widest">{isPaused ? 'Paused' : 'Live'}</span>
            </button>
 
            <button
              id="toggle-theme"
              onClick={toggleTheme}
              className="p-2.5 rounded-xl bg-surface/30 border border-white/5 hover:bg-white/5 hover:border-white/10 text-muted hover:text-foreground transition-all duration-200 active:scale-[0.96] shadow-inner"
              title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

          </div>
        </div>
      </div>
    </header>
  )
})

TopBar.displayName = 'TopBar'
