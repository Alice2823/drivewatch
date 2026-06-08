import React from 'react'
import {
  Server, Search, Loader2, AlertTriangle, X, ArrowLeft,
  Link2, Unplug, RefreshCcw, Wifi, Shield
} from 'lucide-react'
import { useNASMonitoring } from '../../../services/NASMonitoring/hooks/useNASMonitoring'
import { NASDeviceCard } from './NASDeviceCard'
import { NASConnectDialog } from './NASConnectDialog'
import { NASStoragePanel } from './NASStoragePanel'
import { NASTransferMonitor } from './NASTransferMonitor'
import type { NASDevice } from '../../../services/NASMonitoring/types'

interface Props {
  isActive: boolean
}

export const NASDashboard: React.FC<Props> = ({ isActive }) => {
  const {
    state,
    selectedDevice,
    activeView,
    connectDialogOpen,
    setConnectDialogOpen,
    scanNetwork,
    connectToDevice,
    disconnectDevice,
    selectDevice
  } = useNASMonitoring(isActive)

  const [connectTarget, setConnectTarget] = React.useState<NASDevice | null>(null)

  const handleOpenConnect = (device: NASDevice) => {
    setConnectTarget(device)
    setConnectDialogOpen(true)
  }

  const isConnected = (deviceId: string) => state.connections[deviceId]?.state === 'connected'
  const isConnecting = connectTarget ? state.connections[connectTarget.id]?.state === 'connecting' : false

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {activeView === 'device' && (
            <button onClick={() => selectDevice(null)}
              className="p-2 rounded-xl bg-white/5 border border-white/5 text-muted hover:text-foreground hover:bg-white/10 transition-all">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-center gap-4">
            <div className="p-4 bg-primary/10 rounded-[22px] text-primary border border-primary/20 shadow-[0_0_30px_rgba(6,182,212,0.15)] relative group/icon">
              <div className="absolute inset-0 bg-primary/10 rounded-[22px] blur-md opacity-0 group-hover/icon:opacity-100 transition-opacity" />
              <Server className="w-7 h-7 relative z-10" />
            </div>
            <div>
              <h3 className="text-2xl font-black text-foreground tracking-tight uppercase italic leading-none mb-1">
                {activeView === 'device' && selectedDevice ? selectedDevice.name : 'Network Storage'}
              </h3>
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">
                  {activeView === 'device' ? 'Active Monitoring Dash' : 'Intelligent Node Discovery'}
                </p>
                {state.isScanning && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 animate-pulse">
                    <div className="w-1 h-1 rounded-full bg-primary" />
                    <span className="text-[8px] font-black text-primary uppercase tracking-widest">Active Scan</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {activeView === 'overview' && (
            <button 
              onClick={scanNetwork} 
              disabled={state.isScanning}
              className={`flex items-center gap-3 px-6 py-3.5 rounded-2xl font-black uppercase tracking-[0.15em] text-[11px] transition-all relative overflow-hidden group/scan ${
                state.isScanning
                  ? 'bg-white/5 text-muted border border-white/5 cursor-wait'
                  : 'bg-primary text-background hover:scale-[1.02] active:scale-[0.98] shadow-[0_10px_30px_-5px_rgba(6,182,212,0.3)]'
              }`}
            >
              {state.isScanning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4 group-hover:rotate-12 transition-transform" />
              )}
              <span>{state.isScanning ? 'Probing...' : 'Refresh Network'}</span>
            </button>
          )}
          {activeView === 'device' && selectedDevice && (
            <>
              {isConnected(selectedDevice.id) ? (
                <button onClick={() => disconnectDevice(selectedDevice.id)}
                  className="flex items-center gap-2 px-5 py-3 rounded-xl font-black uppercase tracking-widest text-[11px] bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/20 hover:bg-[#ef4444]/20 transition-all">
                  <Unplug className="w-4 h-4" /> Disconnect
                </button>
              ) : (
                <button onClick={() => handleOpenConnect(selectedDevice)}
                  className="flex items-center gap-2 px-5 py-3 rounded-xl font-black uppercase tracking-widest text-[11px] bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all">
                  <Link2 className="w-4 h-4" /> Connect
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {state.error && (
        <div className="p-4 rounded-2xl bg-[#ef4444]/10 border border-[#ef4444]/20 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0" />
          <p className="text-sm font-bold text-[#ef4444] flex-1">{state.error}</p>
          <button onClick={() => {/* clear error handled via next scan */}} className="text-[#ef4444]/60 hover:text-[#ef4444]">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Overview View */}
      {activeView === 'overview' && (
        <div className="flex flex-col gap-6">
          {/* Status Bar */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/5">
              <Wifi className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-black text-muted uppercase tracking-widest">
                {state.devices.length} Device{state.devices.length !== 1 ? 's' : ''} Found
              </span>
            </div>
            {state.lastScanAt && (
              <span className="text-[10px] font-bold text-muted/60 uppercase tracking-wider">
                Last scan: {new Date(state.lastScanAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Device List */}
          {state.devices.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {state.devices.map(device => (
                <div key={device.id} className="flex gap-3 items-stretch">
                  <div className="flex-1">
                    <NASDeviceCard
                      device={device}
                      connection={state.connections[device.id]}
                      onSelect={selectDevice}
                      isSelected={selectedDevice?.id === device.id}
                    />
                  </div>
                  {!isConnected(device.id) && (
                    <button onClick={() => handleOpenConnect(device)}
                      className="px-4 rounded-2xl bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-all flex items-center gap-2 shrink-0">
                      <Link2 className="w-4 h-4" />
                      <span className="text-[10px] font-black uppercase tracking-widest hidden lg:inline">Connect</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 px-6 rounded-[32px] bg-white/[0.02] border border-white/5 relative overflow-hidden group">
              {/* Decorative Background Glows */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-primary/10 rounded-full blur-[80px] opacity-20 group-hover:opacity-40 transition-opacity duration-1000" />
              
              {state.isScanning ? (
                <>
                  <div className="relative mb-8">
                    <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
                    <div className="relative w-20 h-20 rounded-3xl bg-surface flex items-center justify-center border border-primary/30 shadow-[0_0_40px_rgba(6,182,212,0.1)]">
                      <Server className="w-10 h-10 text-primary/40" />
                      <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-surface border border-primary/20 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      </div>
                    </div>
                  </div>
                  <div className="text-center space-y-2 z-10">
                    <h4 className="text-lg font-black text-foreground uppercase tracking-[0.2em] animate-pulse">
                      Discovery <span className="text-primary">Active</span>
                    </h4>
                    <p className="text-xs text-muted font-medium tracking-wide max-w-sm leading-relaxed">
                      Probing local subnet for TrueNAS, Synology, and SMB-compliant storage systems...
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative mb-8">
                    <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl group-hover:bg-primary/20 transition-colors duration-700" />
                    <div className="relative w-20 h-20 rounded-3xl bg-surface flex items-center justify-center border border-white/10 group-hover:border-primary/30 transition-all duration-500 shadow-xl">
                      <Server className="w-10 h-10 text-primary/30 group-hover:text-primary/60 transition-colors" />
                    </div>
                  </div>
                  <div className="text-center space-y-2 z-10">
                    <h4 className="text-lg font-black text-foreground uppercase tracking-[0.2em]">
                      No Network <span className="text-primary">Storage</span>
                    </h4>
                    <p className="text-xs text-muted font-medium tracking-wide max-w-[320px] mx-auto leading-relaxed">
                      We couldn't detect any active NAS devices on your current segment. Ensure your storage server is online and reachable.
                    </p>
                  </div>
                  <button onClick={scanNetwork}
                    className="mt-10 flex items-center gap-3 px-8 py-4 rounded-2xl bg-primary text-background font-black uppercase tracking-[0.15em] text-[11px] hover:scale-[1.05] active:scale-[0.95] transition-all shadow-[0_15px_40px_-12px_rgba(6,182,212,0.5)] z-10 group/btn">
                    <Search className="w-4 h-4 group-hover:rotate-12 transition-transform" /> 
                    <span>Scan Network</span>
                  </button>
                  
                  <div className="mt-8 pt-8 border-t border-white/5 w-full max-w-xs flex justify-center gap-6 opacity-30 group-hover:opacity-60 transition-opacity">
                    <div className="text-[9px] font-bold text-muted uppercase tracking-widest">TrueNAS</div>
                    <div className="text-[9px] font-bold text-muted uppercase tracking-widest">Synology</div>
                    <div className="text-[9px] font-bold text-muted uppercase tracking-widest">SMB/CIFS</div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Device Detail View */}
      {activeView === 'device' && selectedDevice && (
        <div className="flex flex-col gap-6">
          {/* Connection Status Banner */}
          {state.connections[selectedDevice.id]?.state === 'failed' ? (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#ef4444]/10 border border-[#ef4444]/20">
              <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0" />
              <span className="text-[11px] font-bold text-[#ef4444] flex-1 leading-relaxed">
                <span className="font-black uppercase tracking-widest block mb-0.5">Telemetry Failed</span>
                {state.connections[selectedDevice.id]?.lastError || 'Connection lost or NAS rejected telemetry commands.'}
              </span>
              <button onClick={() => handleOpenConnect(selectedDevice)}
                className="ml-auto px-4 py-2 rounded-lg bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/20 text-[10px] font-black uppercase tracking-widest hover:bg-[#ef4444]/20 transition-all">
                Retry
              </button>
            </div>
          ) : isConnected(selectedDevice.id) ? (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-success/5 border border-success/15">
              <Shield className="w-4 h-4 text-success" />
              <span className="text-[11px] font-black text-success uppercase tracking-widest">Secure Connection Active</span>
              <span className="text-[10px] text-muted font-bold ml-auto">
                via {state.connections[selectedDevice.id]?.protocol?.toUpperCase() || 'SMB'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/5">
              <Unplug className="w-4 h-4 text-muted" />
              <span className="text-[11px] font-bold text-muted">Not connected — connect to view storage analytics and monitoring data</span>
              <button onClick={() => handleOpenConnect(selectedDevice)}
                className="ml-auto px-4 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 text-[10px] font-black uppercase tracking-widest hover:bg-primary/20 transition-all">
                Connect
              </button>
            </div>
          )}

          {/* Analytics (only when connected) */}
          {isConnected(selectedDevice.id) && state.storage[selectedDevice.id] && (
            <>
              <NASStoragePanel
                storage={state.storage[selectedDevice.id]}
                smart={state.smart[selectedDevice.id]}
                health={state.health[selectedDevice.id]}
              />
              {state.transfers[selectedDevice.id] && (
                <NASTransferMonitor stats={state.transfers[selectedDevice.id]} />
              )}
            </>
          )}
        </div>
      )}

      {/* Connect Dialog */}
      {connectDialogOpen && connectTarget && (
        <NASConnectDialog
          device={connectTarget}
          onConnect={(config) => {
            connectToDevice(config)
            setConnectDialogOpen(false)
          }}
          onClose={() => {
            setConnectDialogOpen(false)
            setConnectTarget(null)
          }}
          isConnecting={isConnecting}
        />
      )}
    </div>
  )
}
