import React from 'react'
import { Database, HardDrive, Layers, ShieldCheck, AlertTriangle } from 'lucide-react'
import { CircularProgress } from '../../CircularProgress'
import type { NASStorageAnalytics, NASSMARTData, NASHealthAnalysis } from '../../../services/NASMonitoring/types'
import { formatNASBytes, formatNASTemp, formatPowerOnHours, getHealthColor, getHealthBgColor } from '../../../services/NASMonitoring/utils/formatters'

interface Props {
  storage: NASStorageAnalytics
  smart?: NASSMARTData
  health?: NASHealthAnalysis
}

export const NASStoragePanel: React.FC<Props> = ({ storage, smart, health }) => {
  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Storage Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Database className="w-5 h-5" />} label="Total Capacity" value={formatNASBytes(storage.totalCapacity)} accent="primary" />
        <StatCard icon={<HardDrive className="w-5 h-5" />} label="Used Space" value={formatNASBytes(storage.usedSpace)} accent="warning" />
        <StatCard icon={<Layers className="w-5 h-5" />} label="Free Space" value={formatNASBytes(storage.freeSpace)} accent="success" />
        <StatCard icon={<ShieldCheck className="w-5 h-5" />} label="RAID Type" value={storage.raidType} accent={storage.raidStatus === 'optimal' ? 'success' : 'warning'} />
      </div>

      {/* Storage Usage Bar */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-black text-muted uppercase tracking-[0.2em]">Storage Utilization</h4>
          <span className={`text-lg font-black ${storage.usagePercent > 85 ? 'text-[#ef4444]' : storage.usagePercent > 65 ? 'text-warning' : 'text-success'}`}>
            {storage.usagePercent}%
          </span>
        </div>
        <div className="w-full h-3 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ease-out ${
              storage.usagePercent > 85 ? 'bg-[#ef4444]' : storage.usagePercent > 65 ? 'bg-warning' : 'bg-primary'
            }`}
            style={{ width: `${storage.usagePercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-[10px] font-bold text-muted uppercase tracking-wider">{formatNASBytes(storage.usedSpace)} used</span>
          <span className="text-[10px] font-bold text-muted uppercase tracking-wider">{formatNASBytes(storage.freeSpace)} free</span>
        </div>

        {/* Volume Breakdown */}
        {storage.volumes.length > 0 && (
          <div className="mt-6 pt-6 border-t border-white/5 flex flex-col gap-3">
            <span className="text-[10px] font-black text-muted uppercase tracking-widest">Volumes</span>
            {storage.volumes.map((vol, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
                <div className="flex items-center gap-3">
                  <Layers className="w-4 h-4 text-primary" />
                  <div>
                    <span className="text-sm font-bold text-foreground">{vol.name}</span>
                    <span className="text-[10px] text-muted ml-2 font-bold uppercase">{vol.filesystem}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[11px] font-bold text-muted">{formatNASBytes(vol.usedSize)} / {formatNASBytes(vol.totalSize)}</span>
                  <div className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                    vol.status === 'healthy' ? 'bg-success/10 text-success border border-success/20' : 'bg-warning/10 text-warning border border-warning/20'
                  }`}>{vol.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* RAID Status */}
        <div className="mt-4 flex items-center gap-3">
          <span className="text-[10px] font-black text-muted uppercase tracking-widest">RAID Status</span>
          <div className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${
            storage.raidStatus === 'optimal'
              ? 'bg-success/10 text-success border border-success/20'
              : storage.raidStatus === 'degraded'
              ? 'bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/20'
              : 'bg-warning/10 text-warning border border-warning/20'
          }`}>
            {storage.raidStatus}
          </div>
          <span className="text-[10px] font-bold text-muted">{storage.diskCount} Disks</span>
        </div>
      </div>

      {/* SMART Data */}
      <div className="glass-card p-6">
        <h4 className="text-sm font-black text-muted uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          Physical Disk Monitoring
        </h4>
        
        {!smart?.available || smart.disks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center bg-white/[0.02] border border-white/5 rounded-2xl border-dashed">
             <div className="p-4 rounded-full bg-primary/10 border border-primary/20 mb-4">
               <HardDrive className="w-8 h-8 text-primary" />
             </div>
             <p className="text-xs font-black text-foreground uppercase tracking-widest">Connect via SSH to view physical disks</p>
             <p className="text-[11px] text-muted font-bold mt-2 max-w-md leading-relaxed">
               SMB connections only provide logical volume data. To view individual disk temperatures, SMART health graphs, and hardware telemetry, disconnect and reconnect using the SSH protocol.
             </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {smart.disks.map(disk => (
              <div key={disk.diskId} className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 flex gap-5 items-center hover:bg-white/[0.04] transition-colors">
                {/* Disk Health Graph */}
                <div className="shrink-0">
                  <CircularProgress 
                    value={disk.healthPercent} 
                    label="HEALTH" 
                    colorClass={disk.healthPercent > 75 ? 'text-success' : disk.healthPercent > 50 ? 'text-warning' : 'text-[#ef4444]'} 
                    size={70} 
                  />
                </div>
                
                {/* Disk Info & Stats */}
                <div className="flex flex-col gap-3 flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 truncate">
                      <HardDrive className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-sm font-black text-foreground truncate uppercase tracking-wide">{disk.diskName}</span>
                      {disk.isSSD && <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 shrink-0">SSD</span>}
                    </div>
                    <HealthBadge level={disk.healthLevel} />
                  </div>
                  
                  <span className="text-[10px] font-bold text-muted truncate uppercase tracking-widest">{disk.model} {disk.serial ? `• ${disk.serial}` : ''}</span>
                  
                  <div className="grid grid-cols-2 gap-5 mt-1">
                    {/* Temperature Bar */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-muted">
                        <span>Temperature</span>
                        <span className={disk.temperature && disk.temperature > 50 ? 'text-[#ef4444]' : disk.temperature && disk.temperature > 40 ? 'text-warning' : 'text-success'}>
                          {formatNASTemp(disk.temperature)}
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all duration-1000 ${disk.temperature && disk.temperature > 50 ? 'bg-[#ef4444]' : disk.temperature && disk.temperature > 40 ? 'bg-warning' : 'bg-success'}`} 
                          style={{ width: `${Math.min(100, Math.max(0, ((disk.temperature || 0) / 70) * 100))}%` }} 
                        />
                      </div>
                    </div>

                    {/* Power On Hours Bar */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-muted">
                        <span>Power On</span>
                        <span className="text-foreground/80">{formatPowerOnHours(disk.powerOnHours)}</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div 
                          className="h-full rounded-full bg-primary/40 transition-all duration-1000" 
                          style={{ width: `${Math.min(100, ((disk.powerOnHours || 0) / 40000) * 100)}%` }} 
                        />
                      </div>
                    </div>
                  </div>

                  {/* Warnings */}
                  {disk.reallocatedSectors > 0 && (
                    <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-white/5">
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-warning/5 border border-warning/10">
                        <AlertTriangle className="w-3 h-3 text-warning" />
                        <span className="text-[10px] font-bold text-warning uppercase tracking-widest">{disk.reallocatedSectors} reallocated sectors</span>
                      </div>
                    </div>
                  )}

                  {/* Disk I/O Throughput Graph */}
                  {disk.throughputHistory && disk.throughputHistory.length > 0 && (
                    <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-white/5">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black text-muted uppercase tracking-widest">Throughput (Live)</span>
                        <div className="flex gap-3 text-[9px] font-black uppercase">
                          <span className="text-primary">R: {formatNASBytes(disk.readSpeed || 0)}/s</span>
                          <span className="text-warning">W: {formatNASBytes(disk.writeSpeed || 0)}/s</span>
                        </div>
                      </div>
                      <div className="h-8 w-full bg-black/20 rounded-md overflow-hidden relative">
                        {/* Read Sparkline */}
                        <div className="absolute inset-0">
                          <Sparkline data={disk.throughputHistory.map(p => p.download)} color="#06b6d4" opacity={0.6} />
                        </div>
                        {/* Write Sparkline */}
                        <div className="absolute inset-0">
                          <Sparkline data={disk.throughputHistory.map(p => p.upload)} color="#f59e0b" opacity={0.6} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Health Insights */}
      {health && health.insights.length > 0 && (
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-black text-muted uppercase tracking-[0.2em] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              Health Analysis
            </h4>
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-black ${health.score > 70 ? 'text-success' : health.score > 40 ? 'text-warning' : 'text-[#ef4444]'}`}>{health.score}</span>
              <span className="text-[10px] font-bold text-muted uppercase">/100</span>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {health.insights.map(insight => (
              <div key={insight.id} className={`p-4 rounded-xl border flex items-start gap-3 ${
                insight.severity === 'critical' ? 'bg-[#ef4444]/5 border-[#ef4444]/15' :
                insight.severity === 'warning' ? 'bg-warning/5 border-warning/15' :
                'bg-success/5 border-success/15'
              }`}>
                {insight.severity === 'critical' ? <AlertTriangle className="w-4 h-4 text-[#ef4444] shrink-0 mt-0.5" /> :
                 insight.severity === 'warning' ? <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" /> :
                 <ShieldCheck className="w-4 h-4 text-success shrink-0 mt-0.5" />}
                <div>
                  <span className={`text-[11px] font-black uppercase tracking-wider ${
                    insight.severity === 'critical' ? 'text-[#ef4444]' : insight.severity === 'warning' ? 'text-warning' : 'text-success'
                  }`}>{insight.title}</span>
                  <p className="text-[11px] font-medium text-muted mt-1 leading-relaxed">{insight.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Sub-components ----

function Sparkline({ data, color, opacity = 1 }: { data: number[], color: string, opacity?: number }) {
  if (!data || data.length < 2) return null
  // Increase max floor slightly to prevent giant spikes on tiny writes
  const max = Math.max(...data, 1024 * 1024) 
  const width = 100
  const height = 100
  const points = data.map((d, i) => `${(i / (data.length - 1)) * width},${100 - (d / max) * height}`).join(' ')
  return (
    <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100" style={{ opacity }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  const accentClass = accent === 'primary' ? 'bg-primary/10 text-primary border-primary/20'
    : accent === 'success' ? 'bg-success/10 text-success border-success/20'
    : accent === 'warning' ? 'bg-warning/10 text-warning border-warning/20'
    : 'bg-white/5 text-muted border-white/10'
  return (
    <div className="glass-card p-5 flex flex-col gap-3">
      <div className={`p-2.5 rounded-xl w-fit border ${accentClass}`}>{icon}</div>
      <div>
        <span className="text-[10px] font-black text-muted uppercase tracking-widest">{label}</span>
        <div className="text-xl font-black text-foreground mt-1">{value}</div>
      </div>
    </div>
  )
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[8px] font-black text-muted uppercase tracking-widest">{label}</span>
      <span className={`text-sm font-black ${color}`}>{value}</span>
    </div>
  )
}

function HealthBadge({ level }: { level: string }) {
  const cls = level === 'healthy' ? 'bg-success/10 text-success border-success/20'
    : level === 'warning' ? 'bg-warning/10 text-warning border-warning/20'
    : level === 'critical' ? 'bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/20'
    : 'bg-white/5 text-muted border-white/10'
  return (
    <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider border ${cls}`}>
      {level}
    </span>
  )
}
