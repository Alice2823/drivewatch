import { useState, useEffect, useRef } from 'react'
import { Fan } from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer, YAxis, CartesianGrid } from 'recharts'

export function CpuFanWidget({ isActive, cpuUsage = 0 }: { isActive: boolean; cpuUsage?: number }) {
  const [realFanRpm, setRealFanRpm] = useState<number | null>(null)
  const [history, setHistory] = useState<{ val: number }[]>([])
  const isFetchingRef = useRef(false)
  const currentRpmRef = useRef(0)

  useEffect(() => {
    const fetchFan = async () => {
      if (document.hidden || isFetchingRef.current || !isActive) return
      isFetchingRef.current = true
      try {
        const rpm = await window.api.getFanRpm()
        setRealFanRpm(rpm)
      } catch (err) {
        console.error('Failed to fetch fan RPM:', err)
      } finally {
        isFetchingRef.current = false
      }
    }

    fetchFan()
    const fetchInterval = setInterval(fetchFan, 1000)

    // Separate interval for updating the live graph using the latest ref
    const graphInterval = setInterval(() => {
      setHistory(prev => {
        const current = currentRpmRef.current
        const h = prev.length === 0 ? Array(30).fill(0).map(() => ({ val: current })) : prev
        return [...h.slice(-29), { val: current }]
      })
    }, 1000)

    return () => {
      clearInterval(fetchInterval)
      clearInterval(graphInterval)
    }
  }, [isActive])

  const maxRpm = 4000 // Assumed max for a typical fan gauge
  const displayRpm = realFanRpm !== null ? realFanRpm : Math.round(800 + ((cpuUsage || 0) * 22))
  currentRpmRef.current = displayRpm

  const percentage = Math.min((displayRpm / maxRpm) * 100, 100)

  let statusColor = 'text-success'
  let strokeColor = 'var(--color-success)'
  let statusText = 'Normal'
  let progressColor = 'stroke-success'

  if (realFanRpm === null) {
    statusColor = 'text-muted'
    strokeColor = 'var(--color-muted)'
    statusText = 'Fan RPM Not Exposed by BIOS'
    progressColor = 'stroke-muted'
  } else if (displayRpm > 2500) {
    statusColor = 'text-danger'
    strokeColor = 'var(--color-danger)'
    statusText = 'Critical'
    progressColor = 'stroke-danger'
  } else if (displayRpm > 1500) {
    statusColor = 'text-warning'
    strokeColor = 'var(--color-warning)'
    statusText = 'High Speed'
    progressColor = 'stroke-warning'
  }

  const radius = 30
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  return (
    <div className="flex items-center justify-between p-4 rounded-2xl bg-surface/30 border border-white/5 h-[110px]">
      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16 flex items-center justify-center">
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="32"
              cy="32"
              r={radius}
              className="stroke-white/10"
              strokeWidth="6"
              fill="transparent"
            />
            <circle
              cx="32"
              cy="32"
              r={radius}
              className={`${progressColor} transition-all duration-1000 ease-out`}
              strokeWidth="6"
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Outer high-speed ring */}
            {displayRpm > 0 && (
              <div
                className="absolute w-11 h-11 rounded-full animate-spin border-[1.5px] border-transparent"
                style={{
                  animationDuration: `${Math.max(0.4, 3000 / displayRpm)}s`,
                  animationTimingFunction: 'linear',
                  borderTopColor: strokeColor,
                  borderBottomColor: strokeColor,
                  opacity: 0.3
                }}
              />
            )}

            {/* Inner reverse ring */}
            {displayRpm > 0 && (
              <div
                className="absolute w-8 h-8 rounded-full animate-spin border border-transparent"
                style={{
                  animationDuration: `${Math.max(0.25, 2000 / displayRpm)}s`,
                  animationTimingFunction: 'linear',
                  animationDirection: 'reverse',
                  borderLeftColor: strokeColor,
                  borderRightColor: strokeColor,
                  opacity: 0.5
                }}
              />
            )}

            {/* Core Fan */}
            <div
              className={`relative w-5 h-5 flex items-center justify-center ${displayRpm > 0 ? 'animate-spin' : ''}`}
              style={{
                animationDuration: displayRpm ? `${Math.max(0.15, 1500 / displayRpm)}s` : '0s',
                animationTimingFunction: 'linear'
              }}
            >
              <Fan
                className={`w-full h-full ${statusColor} transition-colors duration-500`}
                style={{ filter: displayRpm > 0 ? `drop-shadow(0 0 8px ${strokeColor})` : 'none' }}
              />
            </div>

            {/* Center Motor Hub */}
            <div className="absolute w-1.5 h-1.5 rounded-full bg-background border border-white/20 z-10" />
          </div>
        </div>
        <div className="flex flex-col w-32 shrink-0">
          <div className="flex items-baseline gap-1 whitespace-nowrap">
            <span className="text-[26px] font-black text-foreground tracking-tight">
              {displayRpm}
            </span>
            <span className="text-[10px] font-bold text-muted uppercase">RPM</span>
          </div>
          <p className="text-[12px] font-bold text-muted uppercase mt-0.5">CPU Fan</p>
          <span className={`text-[9px] font-black uppercase tracking-wider mt-1 leading-tight ${statusColor}`} title={statusText}>
            {statusText}
          </span>
        </div>
      </div>

      <div className="h-full flex-1 ml-2 border-l border-white/5 pl-4 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history} margin={{ left: 0, right: -30, top: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="colorFan" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--color-muted)" strokeOpacity={0.1} strokeDasharray="3 3" />
            <YAxis
              orientation="right"
              domain={[0, maxRpm]}
              ticks={[1000, 2000, 3000, 4000]}
              tick={{ fontSize: 9, fontWeight: 'bold', fill: 'var(--color-muted)', opacity: 0.5 }}
              tickFormatter={(v) => `${v / 1000}K`}
              axisLine={false}
              tickLine={false}
              width={55}
            />
            <Area
              type="monotone"
              dataKey="val"
              stroke={strokeColor}
              strokeWidth={2}
              fill="url(#colorFan)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

