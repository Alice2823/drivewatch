import React from 'react'
import { Activity, RefreshCw, ShieldCheck, HardDrive } from 'lucide-react'

interface SidebarProps {
  activeTab: 'dashboard' | 'scanner' | 'health' | 'cleanup'
  setActiveTab: (tab: 'dashboard' | 'scanner' | 'health' | 'cleanup') => void
}

export const Sidebar: React.FC<SidebarProps> = React.memo(({ activeTab, setActiveTab }) => {
  const [appVersion, setAppVersion] = React.useState('...')

  React.useEffect(() => {
    if (window.api && window.api.getAppVersion) {
      window.api.getAppVersion().then(v => setAppVersion(v || '1.1.15'))
    }
  }, [])
  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: Activity },
    { id: 'scanner', label: 'Scanner', icon: RefreshCw },
    { id: 'health', label: 'Health', icon: ShieldCheck },
    { id: 'cleanup', label: 'Explorer', icon: HardDrive }
  ]

  return (
    <div className="h-full py-6 pl-6 pr-3 shrink-0 z-20">
      <aside className="w-[260px] h-full flex flex-col gap-2 py-8 px-6 rounded-2xl border border-white/5 bg-card/60 backdrop-blur-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] relative overflow-hidden">
        
        {/* Ambient Top Glow */}
        <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent pointer-events-none" />
        {/* Subtle structural grid in background */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:24px_24px] opacity-30 pointer-events-none mix-blend-screen" />

        <div className="flex flex-col gap-10 flex-1 relative z-10">
          <div className="flex flex-col gap-3">
          <div className="w-full flex items-center justify-center mb-4">
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-muted/50">
              Main Menu
            </span>
          </div>
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-300 group relative overflow-hidden active:scale-[0.97] ${
                    isActive
                      ? 'bg-primary/20 border border-primary/30 text-white shadow-[0_0_25px_rgba(6,182,212,0.15)]'
                      : 'bg-transparent border border-transparent text-muted hover:bg-white/5 hover:text-foreground hover:border-white/10 hover:shadow-[0_0_20px_rgba(255,255,255,0.03)]'
                  }`}
                >
                  {/* Active Indicator Line */}
                  {isActive && (
                    <div className="absolute left-0 top-[20%] bottom-[20%] w-[4px] bg-primary shadow-[0_0_15px_rgba(6,182,212,1)] rounded-r-full" />
                  )}
                  {/* Subtle inner highlight */}
                  {isActive && (
                    <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent pointer-events-none" />
                  )}
                  
                  <div className="relative">
                    {isActive && <div className="absolute inset-0 bg-primary/30 blur-md rounded-full scale-150" />}
                    <tab.icon className={`w-5 h-5 relative z-10 transition-all duration-300 ${
                      isActive ? 'text-primary drop-shadow-[0_0_10px_rgba(6,182,212,0.8)] scale-110' : 'text-muted/70 group-hover:text-primary group-hover:scale-110 group-hover:drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]'
                    }`} />
                  </div>
                  <span className={`text-[13px] font-bold tracking-wide transition-all duration-300 ${isActive ? 'translate-x-1.5' : 'group-hover:translate-x-1.5'}`}>
                    {tab.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Bottom decorative section */}
        <div className="relative z-10 mt-auto pt-6 border-t border-white/5">
           <div className="flex flex-col items-center justify-center opacity-50 hover:opacity-100 transition-opacity gap-1">
             <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted text-center">Core Engine</span>
             <div className="flex items-center gap-2">
               <div className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_10px_rgba(16,185,129,0.8)] animate-pulse" />
               <span className="text-[11px] font-bold text-primary">v{appVersion} (Stable)</span>
             </div>
           </div>
        </div>
      </aside>
    </div>
  )
})

Sidebar.displayName = 'Sidebar'
