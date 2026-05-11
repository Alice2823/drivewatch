import React from 'react'
import { Activity, RefreshCw, ShieldCheck, HardDrive, Zap, ShieldAlert, Server } from 'lucide-react'

interface SidebarProps {
  activeTab: 'dashboard' | 'scanner' | 'health' | 'cleanup' | 'lifespan' | 'recovery' | 'nas'
  setActiveTab: (tab: 'dashboard' | 'scanner' | 'health' | 'cleanup' | 'lifespan' | 'recovery' | 'nas') => void
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
    { id: 'cleanup', label: 'Explorer', icon: HardDrive },
    { id: 'lifespan', label: 'Lifespan', icon: Zap },
    { id: 'recovery', label: 'Recovery', icon: ShieldAlert },
    { id: 'nas', label: 'NAS Monitor', icon: Server }
  ]

  return (
    <div className="h-full py-6 pl-6 pr-3 shrink-0 z-20">
      <aside className="w-[260px] h-full flex flex-col gap-2 py-8 px-6 rounded-2xl border border-white/5 bg-card/80 shadow-[0_12px_34px_-24px_rgba(0,0,0,0.85)] relative overflow-hidden">
        
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
                  className={`flex items-center gap-4 px-5 py-4 rounded-2xl transition-colors duration-150 group relative overflow-hidden ${
                    isActive
                      ? 'bg-primary/20 border border-primary/30 text-white'
                      : 'bg-transparent border border-transparent text-muted hover:bg-white/5 hover:text-foreground hover:border-white/10'
                  }`}
                >
                  {/* Active Indicator Line */}
                  {isActive && (
                    <div className="absolute left-0 top-[20%] bottom-[20%] w-[4px] bg-primary rounded-r-full" />
                  )}
                  {/* Subtle inner highlight */}
                  {isActive && (
                    <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent pointer-events-none" />
                  )}
                  
                  <div className="relative">
                    <tab.icon className={`w-5 h-5 relative z-10 transition-colors duration-150 ${
                      isActive ? 'text-primary' : 'text-muted/70 group-hover:text-primary'
                    }`} />
                  </div>
                  <span className={`text-[13px] font-bold tracking-wide transition-transform duration-150 ${isActive ? 'translate-x-1' : 'group-hover:translate-x-1'}`}>
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
               <div className="w-1.5 h-1.5 rounded-full bg-success" />
               <span className="text-[11px] font-bold text-primary">v{appVersion} (Stable)</span>
             </div>
           </div>
        </div>
      </aside>
    </div>
  )
})

Sidebar.displayName = 'Sidebar'
