import { parentPort, workerData } from 'worker_threads'
import { promises as fs } from 'fs'
import path from 'path'

interface ScanUpdate {
  type: 'folder-update' | 'done' | 'error'
  path?: string
  size?: number
  fileCount?: number
  files?: any[]
}

const rootPath = path.resolve(workerData.rootPath)
const JUNK_EXTENSIONS = new Set(['.tmp', '.temp', '.log', '.bak', '.old', '.chk', '.thumb', '.db'])
const JUNK_FOLDERS = ['temp', 'tmp', 'cache', 'prefetch']

function isJunk(filePath: string, fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase()
  if (JUNK_EXTENSIONS.has(ext)) return true
  const lowerPath = filePath.toLowerCase()
  return JUNK_FOLDERS.some(f => lowerPath.includes(path.sep + f + path.sep))
}

async function scan(currentPath: string) {
  currentPath = path.resolve(currentPath)
  let totalSize = 0
  let fileCount = 0
  const children: any[] = []

  try {
    const entries = await fs.readdir(currentPath, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)
      try {
        if (entry.isDirectory()) {
          const result = await scan(fullPath)
          totalSize += result.size
          fileCount += result.fileCount
          children.push({
            name: entry.name,
            path: fullPath,
            size: result.size,
            type: 'directory',
            fileCount: result.fileCount
          })
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          const stats = await fs.stat(fullPath)
          totalSize += stats.size
          fileCount++
          children.push({
            name: entry.name,
            path: fullPath,
            size: stats.size,
            type: 'file',
            lastModified: stats.mtimeMs,
            isJunk: isJunk(fullPath, entry.name)
          })
        }
      } catch (err) {
        // Permission denied or locked
      }
    }

    // Send update for this folder
    parentPort?.postMessage({
      type: 'folder-update',
      path: currentPath,
      size: totalSize,
      fileCount,
      files: children
    } as ScanUpdate)

    return { size: totalSize, fileCount }
  } catch (err) {
    return { size: 0, fileCount: 0 }
  }
}

async function run() {
  try {
    await scan(rootPath)
    parentPort?.postMessage({ type: 'done' } as ScanUpdate)
  } catch (err: any) {
    parentPort?.postMessage({ type: 'error', path: err.message } as ScanUpdate)
  }
}

run()
