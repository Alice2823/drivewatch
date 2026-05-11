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
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/10 rounded-2xl text-primary border border-primary/20">
              <Server className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-black text-foreground uppercase tracking-tight">
                {activeView === 'device' && selectedDevice ? selectedDevice.name : 'NAS Disk Monitoring'}
              </h3>
              <p className="text-[10px] font-bold text-muted uppercase tracking-widest">
                {activeView === 'device' ? 'Device Dashboard' : 'Network Storage Discovery'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {activeView === 'overview' && (
            <button onClick={scanNetwork} disabled={state.isScanning}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl font-black uppercase tracking-widest text-[11px] transition-all ${
                state.isScanning
                  ? 'bg-white/5 text-muted border border-white/5 cursor-wait'
                  : 'bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 hover:border-primary/40'
              }`}>
              {state.isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {state.isScanning ? 'Scanning...' : 'Scan Network'}
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
            <div className="flex flex-col items-center justify-center p-16 glass-card border-dashed border-white/10">
              {state.isScanning ? (
                <>
                  <div className="relative mb-6">
                    <Server className="w-16 h-16 text-primary/30" />
                    <div className="absolute -top-1 -right-1">
                      <Loader2 className="w-6 h-6 text-primary animate-spin" />
                    </div>
                  </div>
                  <p className="text-sm font-black text-muted uppercase tracking-widest mb-2">Scanning Network...</p>
                  <p className="text-[11px] text-muted/60 font-medium">Probing local network for NAS devices</p>
                </>
              ) : (
                <>
                  <Server className="w-16 h-16 text-primary/20 mb-6" />
                  <p className="text-sm font-black text-muted uppercase tracking-widest mb-2">No NAS Devices Found</p>
                  <p className="text-[11px] text-muted/60 font-medium text-center max-w-sm">
                    Click "Scan Network" to discover NAS devices on your local network. Supports TrueNAS, Synology, QNAP, and SMB shares.
                  </p>
                  <button onClick={scanNetwork}
                    className="mt-6 flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-background font-black uppercase tracking-widest text-[11px] hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-[0_10px_30px_-10px_rgba(6,182,212,0.4)]">
                    <Search className="w-4 h-4" /> Scan Network
                  </button>
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
