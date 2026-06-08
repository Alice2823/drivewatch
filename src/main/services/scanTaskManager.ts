/**
 * ScanTaskManager — Global background scan registry for DriveWatch.
 *
 * All scan types (surface, stabilizer, health/diagnostics) register tasks here.
 * Tasks survive page navigation because they live in the main process, not in
 * any renderer component.  The renderer subscribes via IPC events and can
 * re-attach at any time to receive the current snapshot + live updates.
 */

import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScanType = 'surface' | 'stabilizer' | 'diagnostics' | 'smart' | 'health'
export type TaskStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'

export interface ScanTask {
  taskId: string
  driveId: string          // "disk_N" or "all"
  diskIndex: number | null
  driveName: string
  scanType: ScanType
  scanMode: string         // 'quick'|'full'|'smart'|'verify'|'stabilize'|'chkdsk' etc.
  status: TaskStatus
  progress: number         // 0–100
  speedMBs: number
  etaSec: number
  elapsedSec: number
  startedAt: number        // Date.now()
  finishedAt: number | null
  logLines: string[]
  telemetry: Record<string, unknown>
  error: string | null
}

// ── Singleton ─────────────────────────────────────────────────────────────────

class ScanTaskManager extends EventEmitter {
  private tasks = new Map<string, ScanTask>()
  private elapsedTimers = new Map<string, NodeJS.Timeout>()

  // ── Task lifecycle ──────────────────────────────────────────────────────────

  createTask(params: {
    taskId: string
    driveId: string
    diskIndex: number | null
    driveName: string
    scanType: ScanType
    scanMode: string
  }): ScanTask {
    const task: ScanTask = {
      ...params,
      status: 'queued',
      progress: 0,
      speedMBs: 0,
      etaSec: 0,
      elapsedSec: 0,
      startedAt: Date.now(),
      finishedAt: null,
      logLines: [],
      telemetry: {},
      error: null
    }
    this.tasks.set(task.taskId, task)
    this._startElapsedTimer(task.taskId)
    this._broadcast('tasks:created', task)
    this._broadcastList()
    return task
  }

  updateProgress(taskId: string, patch: Partial<ScanTask>) {
    const task = this.tasks.get(taskId)
    if (!task) return
    Object.assign(task, patch)
    this._broadcast('tasks:progress', { taskId, ...patch })
  }

  setStatus(taskId: string, status: TaskStatus, error?: string) {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = status
    if (error) task.error = error
    if (status === 'done' || status === 'error' || status === 'cancelled') {
      task.finishedAt = Date.now()
      this._stopElapsedTimer(taskId)
    }
    if (status === 'paused') {
      this._stopElapsedTimer(taskId)
    }
    if (status === 'running') {
      this._startElapsedTimer(taskId)
    }
    this._broadcast('tasks:status', { taskId, status, error: error ?? null })
    this._broadcastList()
  }

  appendLog(taskId: string, line: string) {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.logLines.push(line)
    if (task.logLines.length > 200) task.logLines.shift()
  }

  getTask(taskId: string): ScanTask | undefined {
    return this.tasks.get(taskId)
  }

  getAllTasks(): ScanTask[] {
    return Array.from(this.tasks.values())
  }

  getActiveTasks(): ScanTask[] {
    return this.getAllTasks().filter(t => t.status === 'running' || t.status === 'paused' || t.status === 'queued')
  }

  removeTask(taskId: string) {
    this._stopElapsedTimer(taskId)
    this.tasks.delete(taskId)
    this._broadcast('tasks:removed', { taskId })
    this._broadcastList()
  }

  /** Remove all finished/cancelled/error tasks older than `maxAgeMs` */
  pruneFinished(maxAgeMs = 5 * 60 * 1000) {
    const now = Date.now()
    for (const [id, task] of this.tasks) {
      if (
        (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') &&
        task.finishedAt !== null &&
        now - task.finishedAt > maxAgeMs
      ) {
        this.removeTask(id)
      }
    }
  }

  // ── Broadcast helpers ───────────────────────────────────────────────────────

  private _broadcast(channel: string, payload: unknown) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload)
      }
    }
    this.emit(channel, payload)
  }

  private _broadcastList() {
    const list = this.getAllTasks()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('tasks:list', list)
      }
    }
    this.emit('tasks:list', list)
  }

  /** Send full task list to a specific window (used on renderer reconnect) */
  sendSnapshotTo(win: BrowserWindow) {
    if (!win.isDestroyed()) {
      win.webContents.send('tasks:list', this.getAllTasks())
    }
  }

  // ── Elapsed timer ───────────────────────────────────────────────────────────

  private _startElapsedTimer(taskId: string) {
    this._stopElapsedTimer(taskId)
    const timer = setInterval(() => {
      const task = this.tasks.get(taskId)
      if (!task || task.status !== 'running') return
      task.elapsedSec++
      this._broadcast('tasks:tick', { taskId, elapsedSec: task.elapsedSec })
    }, 1000)
    this.elapsedTimers.set(taskId, timer)
  }

  private _stopElapsedTimer(taskId: string) {
    const t = this.elapsedTimers.get(taskId)
    if (t) { clearInterval(t); this.elapsedTimers.delete(taskId) }
  }
}

export const scanTaskManager = new ScanTaskManager()

// Prune stale finished tasks every 5 minutes
setInterval(() => scanTaskManager.pruneFinished(), 5 * 60 * 1000)
