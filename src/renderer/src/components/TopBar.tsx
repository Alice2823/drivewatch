import React, { useState, useEffect } from 'react'
import { Activity, Moon, Sun, Pause, Play, Search, RefreshCw, ShieldCheck, HardDrive } from 'lucide-react'
import { useTheme } from './ThemeProvider'

import logo from '../assets/logo.png'

interface TopBarProps {
  lastUpdated: Date | null
  isPaused: boolean
  onTogglePause: () => void
  activeTab: 'dashboard' | 'scanner' | 'health' | 'cleanup'
  setActiveTab: (tab: 'dashboard' | 'scanner' | 'health' | 'cleanup') => void
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
    <header className="glass-panel w-full border-border rounded-2xl shadow-xl shadow-primary/5 overflow-hidden relative z-10">
      <div className="w-full max-w-[1300px] mx-auto flex flex-col md:flex-row items-center justify-between px-4 md:px-8 py-4 gap-4 md:gap-0">
        
        {/* Left: Brand */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 md:w-11 md:h-11 rounded-full overflow-hidden shadow-lg border border-white/10">
              <img src={logo} alt="DriveWatch Logo" className="w-full h-full object-contain p-1" />
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

        {/* Middle: Tab Navigation (Individual Separated Options) */}
        <div className="flex items-center gap-3">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: Activity },
            { id: 'scanner', label: 'Scanner', icon: RefreshCw },
            { id: 'health', label: 'Health', icon: ShieldCheck },
            { id: 'cleanup', label: 'Explorer', icon: HardDrive }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-3 px-6 py-2.5 rounded-2xl border transition-all duration-500 group shadow-xl ${
                activeTab === tab.id 
                  ? 'bg-primary border-primary/50 text-white shadow-primary/20 scale-105' 
                  : 'bg-surface/30 border-white/5 text-muted/60 hover:bg-surface/50 hover:border-white/10 hover:text-foreground/80'
              }`}
            >
              <tab.icon className={`w-4 h-4 transition-transform duration-500 group-hover:scale-110 ${
                activeTab === tab.id ? 'text-white' : 'text-muted/40 group-hover:text-primary/60'
              }`} />
              <span className="text-[11px] font-black uppercase tracking-[0.15em] relative">
                {tab.label}
              </span>
            </button>
          ))}
        </div>


        {/* Right: Status + Controls (Desktop) */}
        <div className="hidden md:flex items-center gap-6">
          {/* Update Check Button */}
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('show-updater'))
              window.updater.check()
            }}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/5 hover:bg-primary/10 border border-primary/20 transition-all group pointer-events-auto"
          >
            <Search className="w-3.5 h-3.5 text-primary/60 group-hover:text-primary transition-colors" />
            <span className="text-[11px] font-black uppercase tracking-widest text-primary/80 group-hover:text-primary transition-colors">
              Check for Updates
            </span>
          </button>

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
