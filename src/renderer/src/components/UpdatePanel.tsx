import { useEffect, useState, useCallback } from 'react'
import { 
  Download, 
  RefreshCw, 
  X, 
  CheckCircle, 
  AlertCircle, 
  Search, 
  Clock, 
  ChevronRight,
  Package,
  Activity,
} from 'lucide-react'

import logo from '../assets/logo.png'

type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'ready' | 'error'

interface UpdateData {
  status: UpdateStatus
  version?: string
  progress?: number
  error?: string
  releaseDate?: string
  totalBytes?: number
  transferredBytes?: number
}

export function UpdatePanel() {
  const [data, setData] = useState<UpdateData>({ status: 'idle' })
  const [lastChecked, setLastChecked] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [currentVersion, setCurrentVersion] = useState('...')
  const [isInstalling, setIsInstalling] = useState(false)

  useEffect(() => {
    // Get version once
    window.api.getAppVersion().then(v => setCurrentVersion(v || '1.0.0'))

    // Internal event to show panel manually
    const handleShow = () => setIsVisible(true)
    window.addEventListener('show-updater', handleShow)

    // Listen to main process updater events
    // This uses the cleanup function returned by preload script to prevent duplicates
    const cleanupUpdater = window.updater.onStatus((statusData) => {
      console.log('[Updater] State Sync:', statusData)
      
      // Ensure we have a valid status, fallback to idle if corrupted
      const validatedData = statusData && statusData.status ? statusData : { status: 'idle' }
      
      setData(validatedData)
      
      // Auto-show panel on activity
      if (validatedData.status !== 'idle') {
        setIsVisible(true)
      }

      if (validatedData.status === 'checking') {
        setLastChecked(new Date().toLocaleTimeString())
      }
    })

    return () => {
      cleanupUpdater()
      window.removeEventListener('show-updater', handleShow)
    }
  }, [])

  const handleCheck = useCallback(() => {
    window.updater.check()
  }, [])

  const handleDownload = useCallback(() => {
    window.updater.download()
  }, [])

  const handleInstall = useCallback(() => {
    setIsInstalling(true)
    window.updater.install()
  }, [])

  const formatSize = (bytes?: number) => {
    if (!bytes) return '...'
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(1)} MB`
  }

  // Safety fallback - if somehow visible but no data, don't crash
  if (!isVisible) return null

  // UI Status Mapping for clean rendering
  const getStatusContent = () => {
    switch (data.status) {
      case 'checking':
        return {
          title: 'Checking for updates...',
          desc: 'Synchronizing with global update servers to verify system integrity.'
        }
      case 'available':
        return {
          title: 'Update Available',
          desc: `A new optimization patch (v${data.version || '...' }) has been detected.`
        }
      case 'downloading':
        return {
          title: 'Downloading Patch',
          desc: 'Streaming high-speed performance data to local cache...'
        }
      case 'ready':
        return isInstalling 
          ? { title: 'Installing...', desc: 'Finalizing deployment... System restart imminent.' }
          : { title: 'Update Ready', desc: 'Performance package staged and verified for installation.' }
      case 'not-available':
        return {
          title: 'System Up-to-Date',
          desc: 'Your local system is currently running at peak performance.'
        }
      case 'error':
        return {
          title: 'Handshake Failure',
          desc: data.error || 'The update server is currently unreachable. Check uplink.'
        }
      default:
        return {
          title: 'Update Center',
          desc: 'System is awaiting update verification protocol.'
        }
    }
  }

  const content = getStatusContent()

  return (
    <div className="fixed bottom-10 right-10 z-[100] animate-in fade-in slide-in-from-bottom-8 duration-500">
      <div className="glass-card w-[440px] overflow-hidden rounded-[24px] border border-white/5 shadow-[0_30px_80px_rgba(0,0,0,0.8)] backdrop-blur-3xl bg-[#030303]/80">
        {/* Header */}
        <div className="p-6 flex items-center justify-between border-b border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-2xl border border-primary/20 shadow-[0_0_20px_rgba(6,182,212,0.15)] bg-primary/5 relative overflow-hidden">
              <img src={logo} className="w-8 h-8 object-contain relative z-10 drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]" alt="Logo" />
              <div className="absolute inset-0 bg-primary/10 blur-xl rounded-2xl" />
            </div>
            <div className="flex flex-col">
              <h4 className="text-[17px] font-black text-foreground uppercase tracking-[0.1em] leading-tight">System Update</h4>
              <div className="flex items-center gap-2 mt-1.5 opacity-80">
                <span className={`w-2 h-2 rounded-full ${data.status === 'error' ? 'bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'bg-success shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse'}`} />
                <span className="text-[10px] font-bold text-muted uppercase tracking-[0.2em] whitespace-nowrap">
                  Core: v{currentVersion}
                </span>
              </div>
            </div>
          </div>
          <button 
            onClick={() => setIsVisible(false)}
            className="p-2.5 hover:bg-white/10 rounded-full text-muted transition-all hover:text-foreground hover:scale-110 active:scale-90"
            title="Close Update Center"
          >
            <X className="w-5 h-5 stroke-[2.5px]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-8 space-y-8">
          {/* Status Message */}
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
              <Activity className="w-3.5 h-3.5 text-primary" />
              <h5 className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">{content.title}</h5>
            </div>
            <p className="text-[15px] font-semibold text-foreground/90 leading-relaxed pl-1">
              {content.desc}
            </p>
            {lastChecked && (
              <div className="flex items-center gap-2 text-[11px] font-bold text-primary/60 uppercase tracking-widest mt-3">
                <Clock className="w-3.5 h-3.5" />
                Verified: {lastChecked}
              </div>
            )}
          </div>

          {/* Progress Section */}
          {(data.status === 'downloading' || (data.status === 'ready' && isInstalling)) && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between text-[11px] font-black text-foreground/80 uppercase tracking-[0.15em]">
                <span className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-primary animate-pulse" />
                  {data.status === 'downloading' ? 'Data Throughput' : 'Deploying Assets'}
                </span>
                <span className="text-primary">{Math.round(data.progress || 0)}%</span>
              </div>
              <div className="h-2.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 p-[1.5px]">
                <div 
                  className="h-full bg-primary rounded-full transition-all duration-500 shadow-[0_0_20px_rgba(var(--color-primary-rgb),0.7)] relative"
                  style={{ width: `${data.progress || 100}%` }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                </div>
              </div>
              {data.status === 'downloading' && (
                <div className="flex justify-between items-center text-[10px] font-bold text-muted/50 uppercase tracking-[0.2em]">
                  <div className="flex items-center gap-2">
                    <Package className="w-3.5 h-3.5" />
                    Payload: {formatSize(data.totalBytes)}
                  </div>
                  <span className="text-primary/40">Target: v{data.version}</span>
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {data.status === 'error' && (
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-destructive/10 border border-destructive/20 shadow-[0_0_30px_rgba(var(--color-destructive-rgb),0.1)]">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0" />
              <p className="text-[12px] font-bold text-destructive leading-relaxed uppercase tracking-wide">
                {data.error || 'Server unreachable. Verify internet uplink.'}
              </p>
            </div>
          )}

          <div className="pt-2">
            {/* IDLE / UP-TO-DATE / ERROR -> CHECK BUTTON */}
            {(data.status === 'idle' || data.status === 'not-available' || data.status === 'error') && (
              <button
                onClick={handleCheck}
                className="w-full py-4 bg-[#0a0a0c] hover:bg-white/[0.03] text-foreground border border-white/5 hover:border-primary/40 rounded-2xl font-black text-[12px] uppercase tracking-[0.2em] transition-all duration-300 flex items-center justify-center gap-3 group relative overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.5)] active:scale-[0.98]"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <Search className="w-5 h-5 text-primary/70 group-hover:text-primary group-hover:scale-110 transition-all duration-300 relative z-10" />
                <span className="relative z-10 group-hover:text-white transition-colors duration-300">Re-validate System</span>
              </button>
            )}

            {/* CHECKING STATE -> DISABLED */}
            {data.status === 'checking' && (
              <button
                disabled
                className="w-full py-4 bg-white/[0.03] text-muted border border-white/10 rounded-2xl font-black text-[12px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 opacity-50 cursor-not-allowed"
              >
                <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                Authenticating...
              </button>
            )}

            {/* AVAILABLE -> DOWNLOAD BUTTON */}
            {data.status === 'available' && (
              <button
                onClick={handleDownload}
                className="w-full py-4 bg-primary hover:bg-primary/90 text-white rounded-2xl font-black text-[12px] uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 shadow-[0_15px_30px_rgba(var(--color-primary-rgb),0.4)] group"
              >
                <Download className="w-5 h-5 group-hover:translate-y-1 transition-transform" />
                Download Patch v{data.version}
              </button>
            )}

            {/* READY -> INSTALL BUTTON */}
            {data.status === 'ready' && (
              <button
                onClick={handleInstall}
                disabled={isInstalling}
                className={`w-full py-4 bg-success hover:bg-success/90 text-white rounded-2xl font-black text-[12px] uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 shadow-[0_15px_30px_rgba(var(--color-success-rgb),0.4)] group ${isInstalling ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <RefreshCw className={`w-5 h-5 ${isInstalling ? 'animate-spin' : 'group-hover:rotate-180'} transition-transform duration-700`} />
                {isInstalling ? 'Preparing Restart...' : 'Restart & Install Now'}
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-4 bg-white/[0.02] border-t border-white/5 flex items-center justify-between">
          <p className="text-[10px] font-bold text-muted/30 uppercase tracking-[0.25em]">
            Protcol: Secure-GitHub-L01
          </p>
          <div className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-pulse" />
        </div>
      </div>
    </div>
  )
}
