import React, { useState, useEffect } from 'react'
import { Activity, Moon, Sun, Pause, Play } from 'lucide-react'
import { useTheme } from './ThemeProvider'

interface TopBarProps {
  lastUpdated: Date | null
  isPaused: boolean
  onTogglePause: () => void
  activeTab: 'dashboard' | 'scanner'
  setActiveTab: (tab: 'dashboard' | 'scanner') => void
}

export const TopBar: React.FC<TopBarProps> = React.memo(({
  lastUpdated,
  isPaused,
  onTogglePause,
  activeTab,
  setActiveTab
}) => {
  const { isDarkMode, toggleTheme } = useTheme()
  const [timeAgo, setTimeAgo] = useState<string>('')

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
    <header className="glass-panel w-full border-border rounded-2xl shadow-xl shadow-primary/5 overflow-hidden relative z-10">
      <div className="w-full max-w-[1300px] mx-auto flex flex-col md:flex-row items-center justify-between px-4 md:px-8 py-4 gap-4 md:gap-0">
        
        {/* Left: Brand */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 md:w-11 md:h-11 primary-gradient rounded-xl shadow-md">
              <Activity className="w-5 h-5 md:w-6 md:h-6 text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-[20px] md:text-[22px] font-bold tracking-tight text-foreground leading-none mb-1">DriveWatch</h1>
              <div className="flex items-center gap-2">
                <span className="relative flex h-1.5 w-1.5">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    isPaused ? 'bg-warning' : 'bg-success'
                  }`} />
                  <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
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

        {/* Middle: Tab Navigation */}
        <div className="flex w-full md:w-auto p-1 rounded-full border border-border bg-nav shadow-inner backdrop-blur-md relative">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex-1 md:flex-none px-6 md:px-10 py-2 md:py-2.5 text-[12px] md:text-[13px] font-black uppercase tracking-widest rounded-full transition-all duration-300 relative z-10 ${
              activeTab === 'dashboard' 
                ? 'bg-gradient-to-r from-primary to-primary/90 text-white shadow-[0_2px_12px_rgba(var(--color-primary-rgb),0.5)] border border-white/10' 
                : 'text-muted hover:text-foreground/90 hover:bg-surface-hover border border-transparent'
            }`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('scanner')}
            className={`flex-1 md:flex-none px-6 md:px-10 py-2 md:py-2.5 text-[12px] md:text-[13px] font-black uppercase tracking-widest rounded-full transition-all duration-300 relative z-10 ${
              activeTab === 'scanner' 
                ? 'bg-gradient-to-r from-primary to-primary/90 text-white shadow-[0_2px_12px_rgba(var(--color-primary-rgb),0.5)] border border-white/10' 
                : 'text-muted hover:text-foreground/90 hover:bg-surface-hover border border-transparent'
            }`}
          >
            Scanner
          </button>
        </div>


        {/* Right: Status + Controls (Desktop) */}
        <div className="hidden md:flex items-center gap-6">
          {/* Last Updated */}
          <div className="flex flex-col items-end mr-2">
            <span className="text-[12px] font-bold uppercase tracking-wider text-muted leading-none mb-1">Last Update</span>
            <span className="text-[16px] font-bold text-primary tabular-nums">
              {timeAgo || 'Initializing...'}
            </span>
          </div>
 
          {/* Control Buttons */}
          <div className="flex items-center gap-3">
            <button
              id="toggle-pause"
              onClick={onTogglePause}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all duration-300 shadow-sm ${
                isPaused
                  ? 'bg-warning/10 border-warning/30 text-warning hover:bg-warning/20'
                  : 'bg-success/10 border-success/30 text-success hover:bg-success/20'
              }`}
              title={isPaused ? 'Resume monitoring' : 'Pause monitoring'}
            >
              {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
              <span className="text-[11px] font-black uppercase tracking-widest">{isPaused ? 'Paused' : 'Live'}</span>
            </button>
 
            <button
              id="toggle-theme"
              onClick={toggleTheme}
              className="p-2.5 rounded-full bg-surface/30 border border-border hover:bg-surface hover:border-border text-muted hover:text-foreground transition-all duration-300 shadow-sm"
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
