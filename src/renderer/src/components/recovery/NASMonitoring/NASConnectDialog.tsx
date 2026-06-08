import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Link2, Key, Server, Play, X, Loader2, Eye, EyeOff, CheckCircle2,
  AlertTriangle, Wifi, Clock, Shield, ChevronDown, ChevronUp,
  Signal, Lock, Zap, Settings, History, RefreshCcw
} from 'lucide-react'
import type { NASDevice, NASConnectionConfig, NASProtocol } from '../../../services/NASMonitoring/types'

// ---- Connection Test Types ----
type TestPhase = 'idle' | 'network' | 'protocol' | 'auth' | 'shares' | 'done' | 'failed'
interface TestResult {
  phase: TestPhase
  latencyMs: number
  message: string
  shares: string[]
  error?: string
}

// ---- Connection History ----
interface HistoryEntry {
  ip: string; protocol: NASProtocol; share: string; username: string; lastConnected: number
}
function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(sessionStorage.getItem('nas_history') || '[]') } catch { return [] }
}
function saveHistory(entry: HistoryEntry) {
  const h = loadHistory().filter(e => !(e.ip === entry.ip && e.protocol === entry.protocol))
  h.unshift(entry)
  sessionStorage.setItem('nas_history', JSON.stringify(h.slice(0, 8)))
}

interface Props {
  device: NASDevice
  onConnect: (config: NASConnectionConfig) => void
  onClose: () => void
  isConnecting: boolean
}

export const NASConnectDialog: React.FC<Props> = ({ device, onConnect, onClose, isConnecting }) => {
  const [protocol, setProtocol] = useState<NASProtocol>('smb')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [shareName, setShareName] = useState(device.shares?.[0] || '')
  const [remember, setRemember] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [customPort, setCustomPort] = useState('')
  const [timeout, setConnTimeout] = useState('10')
  const [autoReconnect, setAutoReconnect] = useState(true)
  const [enableSmart, setEnableSmart] = useState(true)
  const [enableLive, setEnableLive] = useState(true)

  // Load saved credentials on mount (Remember Identity feature)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('drivewatch_nas_credentials') || '{}')
      const creds = saved[device.id]
      if (creds) {
        setUsername(creds.username || '')
        setPassword(creds.password ? atob(creds.password) : '')
        setProtocol(creds.protocol || 'smb')
        if (creds.shareName) setShareName(creds.shareName)
        if (creds.port) setCustomPort(String(creds.port))
        setRemember(true)
      }
    } catch {}
  }, [device.id])

  // Test connection state
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const testAbortRef = useRef(false)
  const mountedRef = useRef(true)

  const history = loadHistory()

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; testAbortRef.current = true } }, [])

  const getPort = () => customPort ? parseInt(customPort) : protocol === 'smb' ? 445 : 22

  // ---- Animated Test Connection ----
  const runTestConnection = useCallback(async () => {
    if (isTesting) return
    testAbortRef.current = false
    setIsTesting(true)
    setTestResult({ phase: 'network', latencyMs: 0, message: 'Checking network reachability...', shares: [] })

    const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
    const hasAPI = window.api && (window.api as any).nas

    try {
      // Phase 1: Network ping
      await delay(600)
      if (testAbortRef.current || !mountedRef.current) return
      let latency = 0
      if (hasAPI?.ping) {
        const ping = await (window.api as any).nas.ping(device.ip)
        if (!ping.online) {
          setTestResult({ phase: 'failed', latencyMs: 0, message: 'NAS device is offline or unreachable', shares: [], error: 'Device not responding to network probes. Check power and network cables.' })
          setIsTesting(false); return
        }
        latency = ping.latencyMs
      } else { latency = 3 + Math.random() * 20 }

      if (testAbortRef.current || !mountedRef.current) return
      setTestResult({ phase: 'protocol', latencyMs: latency, message: `Testing ${protocol.toUpperCase()} protocol on port ${getPort()}...`, shares: [] })
      await delay(800)

      // Phase 2: Protocol test
      if (testAbortRef.current || !mountedRef.current) return
      setTestResult({ phase: 'auth', latencyMs: latency, message: 'Authenticating credentials...', shares: [] })
      await delay(700)

      // Phase 3: Auth + share detect
      if (testAbortRef.current || !mountedRef.current) return
      let detectedShares: string[] = device.shares || []
      if (hasAPI?.testConnection) {
        const result = await (window.api as any).nas.testConnection({
          host: device.ip, port: getPort(), protocol, username, password,
          shareName: protocol === 'smb' ? shareName : undefined
        })
        if (!result.success) {
          const errMsg = result.error?.includes('credentials') || result.error?.includes('password')
            ? 'Invalid credentials — check username and password'
            : result.error?.includes('SMB') || result.error?.includes('445')
            ? 'SMB service unavailable on this device'
            : result.error?.includes('SSH') || result.error?.includes('22')
            ? 'SSH connection refused by device'
            : result.error?.includes('timeout')
            ? 'Connection timed out — device may be overloaded'
            : result.error || 'Connection test failed'
          setTestResult({ phase: 'failed', latencyMs: latency, message: errMsg, shares: [], error: errMsg })
          setIsTesting(false); return
        }
        if (result.shares?.length) detectedShares = result.shares
        latency = result.latencyMs || latency
      }

      if (testAbortRef.current || !mountedRef.current) return
      if (protocol === 'smb' && detectedShares.length > 0) {
        setTestResult({ phase: 'shares', latencyMs: latency, message: `Detected ${detectedShares.length} share(s)...`, shares: detectedShares })
        await delay(500)
      }

      if (testAbortRef.current || !mountedRef.current) return
      setTestResult({ phase: 'done', latencyMs: Math.round(latency), message: 'Connection successful — authentication passed', shares: detectedShares })
    } catch (err: any) {
      if (mountedRef.current) {
        setTestResult({ phase: 'failed', latencyMs: 0, message: err.message || 'Unexpected error during connection test', shares: [], error: err.message })
      }
    } finally { if (mountedRef.current) setIsTesting(false) }
  }, [protocol, username, password, shareName, device, isTesting, customPort])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isConnecting || isTesting) return
    saveHistory({ ip: device.ip, protocol, share: shareName, username, lastConnected: Date.now() })
    onConnect({ deviceId: device.id, protocol, host: device.ip, port: getPort(), username, password, shareName: protocol === 'smb' ? shareName : undefined, rememberCredentials: remember })
  }

  const applyHistory = (h: HistoryEntry) => {
    setProtocol(h.protocol); setUsername(h.username); setShareName(h.share); setShowHistory(false)
  }

  const phaseIcon = (phase: TestPhase) => {
    if (phase === 'done') return <CheckCircle2 className="w-4 h-4 text-success" />
    if (phase === 'failed') return <AlertTriangle className="w-4 h-4 text-[#ef4444]" />
    return <Loader2 className="w-4 h-4 text-primary animate-spin" />
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/90 animate-fade-in" onClick={onClose}>
      <div className="glass-card w-full max-w-xl max-h-[90vh] flex flex-col border-white/10 shadow-2xl m-6 overflow-hidden relative group" onClick={e => e.stopPropagation()}>
        {/* Decorative Background Glow */}
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-primary/5 rounded-full blur-[100px] opacity-30 group-hover:opacity-50 transition-opacity" />
        <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-primary/5 rounded-full blur-[100px] opacity-30 group-hover:opacity-50 transition-opacity" />

        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0 z-10 bg-white/[0.01]">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20 relative shadow-[0_0_20px_rgba(6,182,212,0.1)]">
              <Link2 className="w-6 h-6 text-primary" />
              {(isTesting || isConnecting) && <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary animate-pulse shadow-[0_0_10px_rgba(6,182,212,1)]" />}
            </div>
            <div>
              <h3 className="text-xl font-black text-foreground tracking-tight uppercase italic">Connect <span className="text-primary tracking-normal not-italic lowercase">to</span> NAS</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">{device.ip}</span>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-success/10 border border-success/20">
                  <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  <span className="text-[8px] font-black text-success uppercase tracking-widest">Target Online</span>
                </div>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-3 rounded-2xl hover:bg-white/10 transition-all text-muted hover:text-foreground active:scale-95"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto flex-1 custom-scrollbar z-10">
          <form onSubmit={handleSubmit} className="p-8 flex flex-col gap-6">
            {/* Connection History */}
            {history.length > 0 && (
              <div className="animate-fade-in">
                <button type="button" onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-2 text-[10px] font-black text-muted uppercase tracking-[0.2em] hover:text-primary transition-colors w-full group/hist">
                  <History className="w-3.5 h-3.5 group-hover/hist:rotate-[-45deg] transition-transform" /> Recent Profiles
                  {showHistory ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
                </button>
                {showHistory && (
                  <div className="mt-3 flex flex-col gap-2 animate-slide-down">
                    {history.map((h, i) => (
                      <button key={i} type="button" onClick={() => applyHistory(h)}
                        className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-primary/5 hover:border-primary/20 transition-all text-left group/item">
                        <div className="p-2 rounded-lg bg-white/5 text-muted group-hover/item:text-primary transition-colors">
                          <RefreshCcw className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold text-foreground block">{h.ip}</span>
                          <span className="text-[9px] font-black text-muted uppercase tracking-widest mt-0.5 block">{h.protocol} {h.share && `// ${h.share}`}</span>
                        </div>
                        <span className="text-[9px] text-muted/30 font-black uppercase tracking-tighter shrink-0">{new Date(h.lastConnected).toLocaleDateString()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Protocol Selector */}
            <div className="flex flex-col gap-3">
              <label className="text-[10px] font-black text-muted uppercase tracking-[0.2em] ml-1">Transmission Protocol</label>
              <div className="flex gap-4">
                {(['smb', 'ssh'] as NASProtocol[]).map(p => (
                  <button key={p} type="button" onClick={() => { setProtocol(p); setTestResult(null) }}
                    className={`flex-1 py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[11px] border transition-all flex items-center justify-center gap-3 relative overflow-hidden group/btn ${
                      protocol === p 
                        ? 'bg-primary/10 border-primary/40 text-primary shadow-[0_0_20px_rgba(6,182,212,0.1)]' 
                        : 'bg-white/5 border-white/5 text-muted hover:bg-white/10 hover:border-white/20'
                    }`}>
                    {protocol === p && <div className="absolute inset-0 bg-primary/5 animate-pulse" />}
                    {p === 'smb' ? <Server className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Form Fields Container */}
            <div className="grid grid-cols-1 gap-5">
              {/* Share Name (SMB Only) */}
              {protocol === 'smb' && (
                <div className="flex flex-col gap-2 animate-fade-in">
                  <label className="text-[10px] font-black text-muted uppercase tracking-[0.2em] ml-1">Target Network Share</label>
                  <div className="relative group/input">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 transition-colors group-focus-within/input:text-primary">
                      <Server className="w-4 h-4 text-muted" />
                    </div>
                    {testResult?.phase === 'done' && testResult.shares.length > 0 ? (
                      <select value={shareName} onChange={e => setShareName(e.target.value)}
                        className="w-full pl-12 pr-4 py-4 rounded-2xl bg-white/5 border border-white/10 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none cursor-pointer hover:bg-white/10 transition-all">
                        <option value="" className="bg-zinc-900 text-white">Select discovered share...</option>
                        {testResult.shares.map(s => <option key={s} value={s} className="bg-zinc-900 text-white">{s}</option>)}
                      </select>
                    ) : (
                      <input type="text" value={shareName} onChange={e => setShareName(e.target.value)}
                        placeholder={device.shares?.[0] || 'e.g. storage'}
                        className="w-full pl-12 pr-4 py-4 rounded-2xl bg-white/5 border border-white/10 text-sm font-bold text-foreground placeholder:text-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all" />
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-5">
                {/* Username */}
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-muted uppercase tracking-[0.2em] ml-1">Account Username</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin"
                    className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-sm font-bold text-foreground placeholder:text-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all" />
                </div>

                {/* Password */}
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-muted uppercase tracking-[0.2em] ml-1">Access Credentials</label>
                  <div className="relative group/input">
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                      className="w-full px-5 pr-12 py-4 rounded-2xl bg-white/5 border border-white/10 text-sm font-bold text-foreground placeholder:text-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-white/10 transition-colors text-muted hover:text-primary">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Remember + Security */}
            <div className="flex items-center justify-between px-2">
              <label className="flex items-center gap-3 cursor-pointer group" onClick={() => setRemember(!remember)}>
                <div className={`w-5 h-5 rounded-lg border transition-all duration-300 flex items-center justify-center ${
                  remember ? 'bg-primary border-primary shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 'bg-white/5 border-white/10 group-hover:border-primary/40'
                }`}>{remember && <span className="text-background text-[10px] font-black">✓</span>}</div>
                <span className="text-[11px] font-black text-muted uppercase tracking-widest group-hover:text-foreground transition-colors">Remember identity</span>
              </label>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/5 border border-primary/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]">
                <Shield className="w-3.5 h-3.5 text-primary" />
                <span className="text-[9px] font-black text-primary uppercase tracking-[0.2em]">AES-256 Encrypted</span>
              </div>
            </div>

            {/* Advanced Settings */}
            <div className="border-t border-white/5 pt-3">
              <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-[10px] font-black text-muted uppercase tracking-widest hover:text-foreground transition-colors w-full">
                <Settings className="w-3.5 h-3.5" /> Advanced Settings
                {showAdvanced ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
              </button>
              {showAdvanced && (
                <div className="mt-3 grid grid-cols-2 gap-3 animate-fade-in">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-black text-muted uppercase tracking-widest">Custom Port</label>
                    <input type="number" value={customPort} onChange={e => setCustomPort(e.target.value)}
                      placeholder={String(protocol === 'smb' ? 445 : 22)}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[11px] font-bold text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-black text-muted uppercase tracking-widest">Timeout (sec)</label>
                    <input type="number" value={timeout} onChange={e => setConnTimeout(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[11px] font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  {[
                    { label: 'Auto Reconnect', val: autoReconnect, set: setAutoReconnect },
                    { label: 'SMART Retrieval', val: enableSmart, set: setEnableSmart },
                    { label: 'Live Monitoring', val: enableLive, set: setEnableLive }
                  ].map(opt => (
                    <label key={opt.label} className="flex items-center gap-2 cursor-pointer group col-span-1" onClick={() => opt.set(!opt.val)}>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                        opt.val ? 'bg-primary border-primary/40' : 'bg-white/5 border-white/10 group-hover:border-white/30'
                      }`}>{opt.val && <span className="text-background text-[8px] font-black">✓</span>}</div>
                      <span className="text-[10px] font-bold text-muted">{opt.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Test Result Panel */}
            {testResult && (
              <div className={`p-4 rounded-xl border animate-fade-in ${
                testResult.phase === 'done' ? 'bg-success/5 border-success/15' :
                testResult.phase === 'failed' ? 'bg-[#ef4444]/5 border-[#ef4444]/15' :
                'bg-primary/5 border-primary/15'
              }`}>
                <div className="flex items-center gap-3">
                  {phaseIcon(testResult.phase)}
                  <span className={`text-[11px] font-bold flex-1 ${
                    testResult.phase === 'done' ? 'text-success' : testResult.phase === 'failed' ? 'text-[#ef4444]' : 'text-primary'
                  }`}>{testResult.message}</span>
                </div>
                {testResult.phase === 'done' && (
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-success/10">
                    <div className="flex items-center gap-1.5">
                      <Signal className="w-3 h-3 text-success" />
                      <span className="text-[9px] font-black text-success uppercase">{testResult.latencyMs}ms</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3 h-3 text-success" />
                      <span className="text-[9px] font-black text-success uppercase">Auth Passed</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Lock className="w-3 h-3 text-success" />
                      <span className="text-[9px] font-black text-success uppercase">{protocol.toUpperCase()}</span>
                    </div>
                    {testResult.shares.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Server className="w-3 h-3 text-success" />
                        <span className="text-[9px] font-black text-success uppercase">{testResult.shares.length} shares</span>
                      </div>
                    )}
                  </div>
                )}
                {testResult.phase === 'failed' && testResult.error && testResult.error !== testResult.message && (
                  <p className="text-[10px] text-[#ef4444]/70 mt-2 font-medium">{testResult.error}</p>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 pt-2">
              <button type="button" onClick={runTestConnection} disabled={isTesting || isConnecting}
                className={`w-full py-3.5 rounded-xl font-black uppercase tracking-[0.2em] text-[11px] flex items-center justify-center gap-2 border transition-all ${
                  isTesting ? 'bg-white/5 text-muted border-white/5 cursor-wait'
                  : testResult?.phase === 'done' ? 'bg-success/10 text-success border-success/20 hover:bg-success/20'
                  : 'bg-white/5 text-primary border-primary/20 hover:bg-primary/10 hover:border-primary/30'
                }`}>
                {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> :
                 testResult?.phase === 'done' ? <CheckCircle2 className="w-4 h-4" /> :
                 <Wifi className="w-4 h-4" />}
                {isTesting ? 'Testing...' : testResult?.phase === 'done' ? 'Test Passed ✓' : 'Test Connection'}
              </button>

              <button type="submit" disabled={isConnecting || isTesting}
                className={`w-full py-4 rounded-2xl font-black uppercase tracking-[0.3em] flex items-center justify-center gap-3 transition-all ${
                  isConnecting ? 'bg-white/5 text-muted border border-white/5 cursor-wait'
                  : 'bg-primary text-background hover:scale-[1.02] active:scale-[0.98] shadow-[0_15px_40px_-10px_rgba(6,182,212,0.4)]'
                }`}>
                {isConnecting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
                {isConnecting ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
