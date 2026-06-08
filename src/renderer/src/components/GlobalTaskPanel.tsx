/**
 * GlobalTaskPanel — Floating background-scan status panel.
 *
 * Always visible when there are active or recently-finished tasks.
 * Survives page navigation because it lives outside the tab content area.
 */

import React, { useState } from 'react'
import {
  Activity, ChevronDown, ChevronUp, X, Pause, Play,
  CheckCircle, AlertTriangle, RefreshCw, Square, HardDrive
} from 'lucide-react'
import { useScanTaskStore, ScanTask, TaskStatus } from '../stores/useScanTaskStore'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(sec: number): string {
  if (!sec || sec <= 0) return '--'
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

const SCAN_TYPE_LABELS: Record<string, string> = {
  surface: 'Surface Scan',
  stabilizer: 'Sector Repair',
  diagnostics: 'Health Scan',
  smart: 'SMART Scan',
  health: 'Health Check'
}

const SCAN_MODE_LABELS: Record<string, string> = {
  quick: 'Quick',
  full: 'Full',
  smart: 'SMART',
  verify: 'Verify',
  stabilize: 'Stabilize',
  chkdsk: 'CHKDSK'
}

function statusIcon(status: TaskStatus, size = 'w-3.5 h-3.5') {
  switch (status) {
    case 'running':  return <RefreshCw className={`${size} text-primary animate-spin`} />
    case 'paused':   return <Pause className={`${size} text-warning`} />
    case 'done':     return <CheckCircle className={`${size} text-success`} />
    case 'error':    return <AlertTriangle className={`${size} text-danger`} />
    case 'cancelled':return <Square className={`${size} text-muted`} />
    case 'queued':   return <RefreshCw className={`${size} text-muted animate-spin`} />
    default:         return null
  }
}

function statusColor(status: TaskStatus): string {
  switch (status) {
    case 'running':  return 'text-primary'
    case 'paused':   return 'text-warning'
    case 'done':     return 'text-success'
    case 'error':    return 'text-danger'
    case 'cancelled':return 'text-muted'
    default:         return 'text-muted'
  }
}

function progressBarColor(status: TaskStatus): string {
  switch (status) {
    case 'running':  return 'bg-primary'
    case 'paused':   return 'bg-warning'
    case 'done':     return 'bg-success'
    case 'error':    return 'bg-danger'
    default:         return 'bg-muted'
  }
}

// ── Task row ──────────────────────────────────────────────────────────────────

const TaskRow: React.FC<{
  task: ScanTask
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onDismiss: () => void
}> = ({ task, onPause, onResume, onStop, onDismiss }) => {
  const isActive = task.status === 'running' || task.status === 'paused'
  const isFinished = task.status === 'done' || task.status === 'error' || task.status === 'cancelled'

  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl bg-surface/40 border border-white/5 hover:border-white/10 transition-all">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {statusIcon(task.status)}
          <div className="flex flex-col min-w-0">
            <span className="text-[11px] font-black uppercase tracking-wider text-foreground truncate">
              {SCAN_TYPE_LABELS[task.scanType] ?? task.scanType}
              {task.scanMode && task.scanMode !== task.scanType && (
                <span className="text-muted font-bold ml-1">
                  · {SCAN_MODE_LABELS[task.scanMode] ?? task.scanMode}
                </span>
              )}
            </span>
            <div className="flex items-center gap-1.5">
              <HardDrive className="w-2.5 h-2.5 text-muted shrink-0" />
              <span className="text-[10px] text-muted truncate">{task.driveName}</span>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 shrink-0">
          {task.status === 'running' && (
            <button
              onClick={onPause}
              title="Pause"
              className="p-1.5 rounded-lg hover:bg-warning/10 text-muted hover:text-warning transition-all"
            >
              <Pause className="w-3 h-3" />
            </button>
          )}
          {task.status === 'paused' && (
            <button
              onClick={onResume}
              title="Resume"
              className="p-1.5 rounded-lg hover:bg-primary/10 text-muted hover:text-primary transition-all"
            >
              <Play className="w-3 h-3" />
            </button>
          )}
          {isActive && (
            <button
              onClick={onStop}
              title="Stop"
              className="p-1.5 rounded-lg hover:bg-danger/10 text-muted hover:text-danger transition-all"
            >
              <Square className="w-3 h-3" />
            </button>
          )}
          {isFinished && (
            <button
              onClick={onDismiss}
              title="Dismiss"
              className="p-1.5 rounded-lg hover:bg-white/5 text-muted hover:text-foreground transition-all"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${progressBarColor(task.status)}`}
          style={{ width: `${task.progress}%` }}
        />
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between text-[10px] font-bold">
        <span className={statusColor(task.status)}>
          {task.status === 'done' ? 'Complete' :
           task.status === 'error' ? (task.error ?? 'Error') :
           task.status === 'cancelled' ? 'Cancelled' :
           task.status === 'paused' ? 'Paused' :
           `${task.progress}%`}
        </span>
        <div className="flex items-center gap-3 text-muted">
          {task.speedMBs > 0 && <span>{task.speedMBs.toFixed(1)} MB/s</span>}
          {task.status === 'running' && task.etaSec > 0 && <span>ETA {fmtTime(task.etaSec)}</span>}
          {task.status === 'running' && <span>{fmtTime(task.elapsedSec)}</span>}
          {isFinished && task.finishedAt && (
            <span>{fmtTime(Math.round((task.finishedAt - task.startedAt) / 1000))}</span>
          )}
        </div>
      </div>

      {/* Error message */}
      {task.status === 'error' && task.error && (
        <p className="text-[10px] text-danger leading-relaxed line-clamp-2">{task.error}</p>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface GlobalTaskPanelProps {
  onNavigateToTab?: (tab: 'dashboard' | 'scanner' | 'health' | 'cleanup' | 'lifespan' | 'recovery' | 'nas' | 'diagnostics' | 'surface' | 'stabilizer') => void
}

export const GlobalTaskPanel: React.FC<GlobalTaskPanelProps> = ({ onNavigateToTab }) => {
  const { taskList } = useScanTaskStore()
  const [expanded, setExpanded] = useState(true)

  // Show panel only when there are tasks
  const visibleTasks = taskList.filter(
    t => t.status !== 'cancelled' || (t.finishedAt && Date.now() - t.finishedAt < 10_000)
  )
  if (visibleTasks.length === 0) return null

  const activeTasks = visibleTasks.filter(t => t.status === 'running' || t.status === 'paused' || t.status === 'queued')
  const runningCount = activeTasks.filter(t => t.status === 'running').length

  const handlePause = (task: ScanTask) => {
    if (task.scanType === 'surface' && task.diskIndex !== null) {
      window.api.surfaceScan.pause(task.diskIndex)
    } else if (task.scanType === 'stabilizer' && task.diskIndex !== null) {
      window.api.stabilizer.pause(task.diskIndex)
    }
  }

  const handleResume = (task: ScanTask) => {
    if (task.scanType === 'surface' && task.diskIndex !== null) {
      window.api.surfaceScan.resume(task.diskIndex)
    } else if (task.scanType === 'stabilizer' && task.diskIndex !== null) {
      window.api.stabilizer.resume(task.diskIndex)
    }
  }

  const handleStop = (task: ScanTask) => {
    if (task.scanType === 'surface' && task.diskIndex !== null) {
      window.api.surfaceScan.stop(task.diskIndex)
    } else if (task.scanType === 'stabilizer' && task.diskIndex !== null) {
      window.api.stabilizer.stop(task.diskIndex)
    }
  }

  const handleDismiss = (task: ScanTask) => {
    window.api.tasks.remove(task.taskId)
  }

  const handleNavigate = (task: ScanTask) => {
    if (!onNavigateToTab) return
    if (task.scanType === 'surface') onNavigateToTab('surface')
    else if (task.scanType === 'stabilizer') onNavigateToTab('stabilizer')
    else if (task.scanType === 'diagnostics') onNavigateToTab('diagnostics')
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[320px] flex flex-col rounded-2xl border border-white/10 bg-background/95 backdrop-blur-xl shadow-2xl shadow-black/60 overflow-hidden"
      style={{ maxHeight: expanded ? 480 : 'auto' }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center justify-between px-4 py-3 bg-surface/60 border-b border-white/5 hover:bg-surface/80 transition-all"
      >
        <div className="flex items-center gap-2">
          <div className="relative">
            <Activity className="w-4 h-4 text-primary" />
            {runningCount > 0 && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary animate-ping" />
            )}
          </div>
          <span className="text-[11px] font-black uppercase tracking-widest text-foreground">
            Background Scans
          </span>
          {activeTasks.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[9px] font-black">
              {activeTasks.length}
            </span>
          )}
        </div>
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-muted" />
          : <ChevronUp className="w-3.5 h-3.5 text-muted" />}
      </button>

      {/* Task list */}
      {expanded && (
        <div className="flex flex-col gap-2 p-3 overflow-y-auto custom-scrollbar" style={{ maxHeight: 400 }}>
          {visibleTasks
            .sort((a, b) => {
              // Running first, then paused, then finished
              const order: Record<TaskStatus, number> = { running: 0, queued: 1, paused: 2, done: 3, error: 4, cancelled: 5 }
              return (order[a.status] ?? 9) - (order[b.status] ?? 9)
            })
            .map(task => (
              <div key={task.taskId} onClick={() => handleNavigate(task)} className="cursor-pointer">
                <TaskRow
                  task={task}
                  onPause={() => handlePause(task)}
                  onResume={() => handleResume(task)}
                  onStop={() => handleStop(task)}
                  onDismiss={() => handleDismiss(task)}
                />
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
