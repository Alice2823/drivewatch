import React, { useMemo } from 'react'
import { ArrowUp, ArrowDown, Signal } from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts'
import type { NASTransferStats } from '../../../services/NASMonitoring/types'
import { formatSpeed, getConnectionQualityLabel, getConnectionQualityColor } from '../../../services/NASMonitoring/utils/formatters'

interface Props {
  stats: NASTransferStats
}

export const NASTransferMonitor: React.FC<Props> = ({ stats }) => {
  const chartData = useMemo(() => {
    if (!stats.history || stats.history.length === 0) {
      return Array(60).fill(0).map(() => ({ upload: 0, download: 0 }))
    }
    return stats.history.map(p => ({
      upload: p.upload / (1024 * 1024),
      download: p.download / (1024 * 1024)
    }))
  }, [stats.history])

  const maxY = useMemo(() => {
    const max = Math.max(...chartData.map(d => Math.max(d.upload, d.download)), 1)
    return Math.ceil(max / 10) * 10 + 10
  }, [chartData])

  const qualityColorClass = getConnectionQualityColor(stats.connectionQuality)

  return (
    <div className="glass-card p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h4 className="text-sm font-black text-muted uppercase tracking-[0.2em] flex items-center gap-2">
          <Signal className="w-4 h-4 text-primary" />
          Live Transfer Monitor
        </h4>
        <div className="flex items-center gap-2">
          <Signal className={`w-3.5 h-3.5 ${qualityColorClass}`} />
          <span className={`text-[10px] font-black uppercase tracking-widest ${qualityColorClass}`}>
            {getConnectionQualityLabel(stats.connectionQuality)}
          </span>
        </div>
      </div>

      {/* Speed Indicators */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
          <div className="p-3 rounded-xl bg-success/10 border border-success/20">
            <ArrowUp className="w-5 h-5 text-success" />
          </div>
          <div>
            <span className="text-[9px] font-black text-muted uppercase tracking-widest">Upload</span>
            <div className="text-xl font-black text-success">{formatSpeed(stats.uploadSpeed)}</div>
          </div>
        </div>
        <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
          <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
            <ArrowDown className="w-5 h-5 text-primary" />
          </div>
          <div>
            <span className="text-[9px] font-black text-muted uppercase tracking-widest">Download</span>
            <div className="text-xl font-black text-primary">{formatSpeed(stats.downloadSpeed)}</div>
          </div>
        </div>
      </div>

      {/* Throughput Graph */}
      <div className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ left: 0, right: 40, top: 5, bottom: 0 }}>
            <defs>
              <linearGradient id="nasUploadGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="nasDownloadGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis
              orientation="right"
              domain={[0, maxY]}
              tick={{ fontSize: 9, fontWeight: 'bold', fill: 'rgba(255,255,255,0.4)' }}
              axisLine={false}
              tickLine={false}
              width={45}
              tickFormatter={(v: number) => `${Math.round(v)}`}
            />
            <Area type="monotone" dataKey="upload" stroke="#10b981" strokeWidth={2} fill="url(#nasUploadGradient)" isAnimationActive={false} />
            <Area type="monotone" dataKey="download" stroke="#06b6d4" strokeWidth={2} fill="url(#nasDownloadGradient)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-3">
        <div className="flex items-center gap-2">
          <div className="w-3 h-1 rounded-full bg-success" />
          <span className="text-[9px] font-black text-muted uppercase tracking-widest">Upload (MB/s)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-1 rounded-full bg-primary" />
          <span className="text-[9px] font-black text-muted uppercase tracking-widest">Download (MB/s)</span>
        </div>
      </div>

      {/* Connection Stats */}
      <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
        <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Latency: {Math.round(stats.latencyMs)}ms</span>
        <span className="text-[10px] font-bold text-muted uppercase tracking-wider">{stats.history.length} data points</span>
      </div>
    </div>
  )
}
