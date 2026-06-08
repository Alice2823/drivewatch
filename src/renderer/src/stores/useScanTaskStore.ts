/**
 * useScanTaskStore — Lightweight task registry for the renderer.
 *
 * Uses React's built-in useSyncExternalStore so there is no extra dependency.
 * The store is a plain singleton object; components subscribe via the hook.
 */

import { useSyncExternalStore } from 'react'

// ── Types (mirror main/services/scanTaskManager.ts) ───────────────────────────

export type ScanType = 'surface' | 'stabilizer' | 'diagnostics' | 'smart' | 'health'
export type TaskStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'

export interface ScanTask {
  taskId: string
  driveId: string
  diskIndex: number | null
  driveName: string
  scanType: ScanType
  scanMode: string
  status: TaskStatus
  progress: number
  speedMBs: number
  etaSec: number
  elapsedSec: number
  startedAt: number
  finishedAt: number | null
  logLines: string[]
  telemetry: Record<string, unknown>
  error: string | null
}

// ── Internal store ────────────────────────────────────────────────────────────

type Listener = () => void

let _tasks: Record<string, ScanTask> = {}
const _listeners = new Set<Listener>()

function _notify() {
  for (const l of _listeners) l()
}

function _subscribe(l: Listener) {
  _listeners.add(l)
  return () => _listeners.delete(l)
}

function _getSnapshot(): Record<string, ScanTask> {
  return _tasks
}

// Mutations — always produce a new object reference so React re-renders

function _setList(tasks: ScanTask[]) {
  const map: Record<string, ScanTask> = {}
  for (const t of tasks) map[t.taskId] = t
  _tasks = map
  _notify()
}

function _upsert(task: ScanTask) {
  _tasks = { ..._tasks, [task.taskId]: task }
  _notify()
}

function _patch(taskId: string, patch: Partial<ScanTask>) {
  const existing = _tasks[taskId]
  if (!existing) return
  _tasks = { ..._tasks, [taskId]: { ...existing, ...patch } }
  _notify()
}

function _remove(taskId: string) {
  const next = { ..._tasks }
  delete next[taskId]
  _tasks = next
  _notify()
}

// ── Public hook ───────────────────────────────────────────────────────────────

export function useScanTaskStore() {
  const tasks = useSyncExternalStore(_subscribe, _getSnapshot)
  return {
    tasks,
    taskList: Object.values(tasks),
    activeTasks: Object.values(tasks).filter(
      t => t.status === 'running' || t.status === 'paused' || t.status === 'queued'
    ),
    getTask: (taskId: string) => tasks[taskId],
    getTasksForDisk: (diskIndex: number) =>
      Object.values(tasks).filter(t => t.diskIndex === diskIndex),
    getActiveTaskForDisk: (diskIndex: number, scanType?: ScanType) =>
      Object.values(tasks).find(
        t =>
          t.diskIndex === diskIndex &&
          (scanType ? t.scanType === scanType : true) &&
          (t.status === 'running' || t.status === 'paused' || t.status === 'queued')
      )
  }
}

// ── IPC Bridge — call once at app startup ─────────────────────────────────────

let bridgeInitialised = false

export function initScanTaskBridge() {
  if (bridgeInitialised) return
  bridgeInitialised = true

  // Full list snapshot (sent on reconnect or after any mutation)
  window.api.tasks.onList(tasks => _setList(tasks as ScanTask[]))

  // New task created
  window.api.tasks.onCreated(task => _upsert(task as ScanTask))

  // Progress patch
  window.api.tasks.onProgress(({ taskId, ...patch }) =>
    _patch(taskId, patch as Partial<ScanTask>)
  )

  // Status change
  window.api.tasks.onStatus(({ taskId, status, error }) =>
    _patch(taskId, { status: status as TaskStatus, error })
  )

  // Elapsed tick
  window.api.tasks.onTick(({ taskId, elapsedSec }) =>
    _patch(taskId, { elapsedSec })
  )

  // Task removed
  window.api.tasks.onRemoved(({ taskId }) => _remove(taskId))

  // Request initial snapshot from main process
  window.api.tasks.requestSnapshot()
}
