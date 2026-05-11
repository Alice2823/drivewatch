import React from 'react'
import { Server, Wifi, WifiOff, ChevronRight, Clock } from 'lucide-react'
import type { NASDevice, NASConnectionStatus } from '../../../services/NASMonitoring/types'
import { formatLatency, getVendorLabel } from '../../../services/NASMonitoring/utils/formatters'

interface Props {
  device: NASDevice
  connection?: NASConnectionStatus
  onSelect: (device: NASDevice) => void
  isSelected: boolean
}

export const NASDeviceCard: React.FC<Props> = ({ device, connection, onSelect, isSelected }) => {
  const isOnline = device.status === 'online'
  const isConnected = connection?.state === 'connected'

  return (
    <button
      onClick={() => onSelect(device)}
      className={`w-full flex items-center gap-4 p-5 rounded-2xl border transition-all text-left group relative overflow-hidden ${
        isSelected
          ? 'bg-primary/10 border-primary/40 shadow-[0_0_30px_rgba(6,182,212,0.1)]'
          : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20'
      }`}
    >
      {isSelected && <div className="absolute left-0 top-[15%] bottom-[15%] w-[4px] bg-primary rounded-r-full" />}
      <div className={`p-4 rounded-xl transition-colors ${
        isSelected ? 'bg-primary/20 text-primary' : 'bg-surface text-muted group-hover:text-foreground'
      }`}>
        <Server className="w-7 h-7" />
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${
          isSelected ? 'text-primary' : 'text-muted'
        }`}>
          {getVendorLabel(device.vendor)}
        </span>
        <span className="text-base font-bold text-foreground truncate mt-0.5">{device.name}</span>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-[11px] font-bold text-muted uppercase tracking-wider">{device.ip}</span>
          <div className="flex items-center gap-1.5">
            {isOnline ? (
              <Wifi className="w-3 h-3 text-success" />
            ) : (
              <WifiOff className="w-3 h-3 text-[#ef4444]" />
            )}
            <span className={`text-[9px] font-black uppercase ${isOnline ? 'text-success' : 'text-[#ef4444]'}`}>
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          {isConnected && (
            <div className="px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
              <span className="text-[9px] font-black text-primary uppercase">Connected</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1 text-muted">
          <Clock className="w-3 h-3" />
          <span className="text-[10px] font-bold">{formatLatency(device.latencyMs)}</span>
        </div>
        <ChevronRight className={`w-4 h-4 transition-transform ${
          isSelected ? 'text-primary translate-x-1' : 'text-muted/40 group-hover:translate-x-1'
        }`} />
      </div>
    </button>
  )
}
