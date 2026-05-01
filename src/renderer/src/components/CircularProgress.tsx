import React from 'react'

interface CircularProgressProps {
  value: number
  label: string
  colorClass: string
  size?: number
  strokeWidth?: number
}

export const CircularProgress: React.FC<CircularProgressProps> = ({ 
  value, 
  label, 
  colorClass, 
  size = 50, 
  strokeWidth = 4 
}) => {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (value / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-1.5 group">
      <div className="relative" style={{ width: size, height: size }}>
        {/* Background Ring */}
        <svg className="w-full h-full -rotate-90 transform">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="transparent"
            className="text-surface border-border opacity-20"
          />
          {/* Progress Ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeDasharray={circumference}
            style={{ 
              strokeDashoffset: offset,
              transition: 'stroke-dashoffset 0.8s ease-out'
            }}
            strokeLinecap="round"
            className={`${colorClass} drop-shadow-[0_0_4px_rgba(var(--color-primary-rgb),0.3)]`}
          />
        </svg>
        {/* Value Text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-black text-foreground/90">{Math.round(value)}%</span>
        </div>
      </div>
      <span className="text-[8px] font-extrabold uppercase tracking-[0.15em] text-muted group-hover:text-foreground/60 transition-colors">
        {label}
      </span>
    </div>
  )
}
