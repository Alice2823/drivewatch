import { Worker } from 'worker_threads'
import path from 'path'
import { promises as fs } from 'fs'
import { EventEmitter } from 'events'

export interface StorageNode {
  name: string
  path: string
  size: number
  type: 'file' | 'directory'
  lastModified?: number
  isJunk?: boolean
  fileCount?: number
  children?: StorageNode[]
}

export class StorageScanner extends EventEmitter {
  private worker: Worker | null = null
  private nodes: Map<string, StorageNode> = new Map()

  constructor() {
    super()
  }

  /**
   * Fast folder listing for immediate UI updates
   */
  public async listFolder(dirPath: string): Promise<StorageNode[]> {
    // Normalize drive roots (e.g. C: -> C:\)
    if (dirPath.length === 2 && dirPath[1] === ':') {
      dirPath += '\\'
    }
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const results: StorageNode[] = []

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        try {
          // Check if we have it in cache first (with total size)
          const cached = this.nodes.get(fullPath)
          if (cached && cached.type === 'directory') {
            results.push(cached)
            continue
          }

          const stats = await fs.stat(fullPath)
          results.push({
            name: entry.name,
            path: fullPath,
            size: stats.size,
            type: entry.isDirectory() ? 'directory' : 'file',
            lastModified: stats.mtimeMs
          })
        } catch {
          // Permission denied
        }
      }
      return results.sort((a, b) => b.size - a.size)
    } catch (err) {
      console.error('[StorageScanner] listFolder error:', err)
      return []
    }
  }

  /**
   * Deep background scan for total folder sizes
   */
  public scanFolder(dirPath: string) {
    if (this.worker) {
      this.worker.terminate()
    }

    const workerFile = path.join(__dirname, 'storageWorker.js')

    // Normalize drive roots (e.g. C: -> C:\)
    let root = dirPath
    if (root.length === 2 && root[1] === ':') {
      root += '\\'
    }

    try {
      this.worker = new Worker(workerFile, {
        workerData: { rootPath: root }
      })

      this.worker.on('message', (msg) => {
        if (msg.type === 'folder-update') {
          // Fix name for drive roots
          let name = path.basename(msg.path)
          if (!name || name.endsWith(':')) {
            name = msg.path
          }

          const node: StorageNode = {
            name,
            path: msg.path,
            size: msg.size,
            fileCount: msg.fileCount,
            type: 'directory',
            children: msg.files
          }
          this.nodes.set(msg.path, node)
          this.emit('progress', node)
        } else if (msg.type === 'done') {
          this.emit('done')
          this.worker = null
        }
      })

      this.worker.on('error', (err) => {
        console.error('[StorageWorker] Error:', err)
        this.emit('error', err)
        this.worker = null
      })

      this.worker.on('exit', (code) => {
        if (code !== 0) console.error(`[StorageWorker] Stopped with exit code ${code}`)
        this.worker = null
      })
    } catch (err) {
      console.error('[StorageScanner] Failed to start worker:', err)
      this.emit('error', err)
    }
  }

  public stopScan() {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }

  /**
   * Get smart suggestions based on current scan results, optionally filtered by path
   */
  public getSuggestions(filterPath?: string): any {
    const largeUnused: StorageNode[] = []
    const junkFiles: StorageNode[] = []
    
    const now = Date.now()
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000

    const normalizedFilter = filterPath ? (filterPath.length === 2 && filterPath[1] === ':') ? filterPath + '\\' : filterPath : null

    for (const node of this.nodes.values()) {
      // If filtering, only check nodes within the filterPath
      if (normalizedFilter && !node.path.startsWith(normalizedFilter)) {
        continue
      }

      if (node.children) {
        for (const child of node.children) {
          if (child.type === 'file') {
            // Old Large Files (> 500MB, > 90 days)
            if (child.size > 500 * 1024 * 1024 && child.lastModified && (now - child.lastModified) > ninetyDaysMs) {
              largeUnused.push(child)
            }
            // Junk Files
            if (child.isJunk) {
              junkFiles.push(child)
            }
          }
        }
      }
    }

    return {
      largeUnused: largeUnused.sort((a, b) => b.size - a.size).slice(0, 50),
      junkFiles: junkFiles.sort((a, b) => b.size - a.size).slice(0, 100)
    }
  }

  /**
   * Performs real system-wide junk deletion. 
   * If no junk is cached, it performs a targeted scan of known system temp locations.
   */
  public async optimize(): Promise<{ success: boolean; deletedCount: number; freedSpace: number }> {
    const suggestions = this.getSuggestions()
    let targets = suggestions.junkFiles.map(f => f.path)
    
    // If no junk found in current scan, target known Windows junk locations
    if (targets.length === 0) {
      const tempFolders = [
        process.env.TEMP,
        path.join(process.env.SystemRoot || 'C:\\Windows', 'Temp'),
        path.join(process.env.LOCALAPPDATA || '', 'Temp')
      ].filter(Boolean) as string[]

      for (const folder of tempFolders) {
        try {
          const files = await fs.readdir(folder)
          for (const file of files) {
            targets.push(path.join(folder, file))
          }
        } catch (err) { /* ignore restricted folders */ }
      }
    }

    if (targets.length === 0) {
      return { success: false, deletedCount: 0, freedSpace: 0 }
    }

    let freedSpace = 0
    let deletedCount = 0
    const { shell } = require('electron')

    // Batch delete (limit to top 500 for safety and speed)
    const purgeList = targets.slice(0, 500)

    for (const filePath of purgeList) {
      try {
        const stats = await fs.stat(filePath)
        if (stats.isFile()) {
           await shell.trashItem(filePath)
           freedSpace += stats.size
           deletedCount++
        }
      } catch (err) {
        // Skip files that are locked or already gone
      }
    }

    // Clear cache after deletion
    this.nodes.clear()
    
    return {
      success: true,
      deletedCount,
      freedSpace
    }
  }
}
