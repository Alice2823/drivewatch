import { parentPort, workerData } from 'worker_threads'
import { promises as fs } from 'fs'
import path from 'path'
import { exec } from 'child_process'

interface ScanUpdate {
  type: 'folder-update' | 'done' | 'error' | 'stats'
  path?: string
  size?: number
  fileCount?: number
  lastModified?: number
  files?: any[]
  totalItems?: number
  processedItems?: number
  suggestions?: {
    largeUnused: any[]
    junkFiles: any[]
  }
}

const rootPath = path.resolve(workerData.rootPath)
const JUNK_EXTENSIONS = new Set(['.tmp', '.temp', '.log', '.bak', '.old', '.chk', '.thumb', '.db', '.crdownload', '.part'])
const JUNK_FOLDERS = ['temp', 'tmp', 'cache', 'prefetch', 'crashreports', 'logs']

const SKIP_FOLDERS = new Set([
  'System Volume Information',
  '$Recycle.Bin',
  'Windows',
  'Config.Msi',
  '$WinREAgent'
])

function isJunk(filePath: string, fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase()
  if (JUNK_EXTENSIONS.has(ext)) return true
  const lowerPath = filePath.toLowerCase()
  return JUNK_FOLDERS.some(f => lowerPath.includes(path.sep + f + path.sep))
}

/**
 * Uses Robocopy to get folder size extremely fast on Windows
 */
function getFolderSizeNative(dirPath: string): Promise<{ size: number, fileCount: number }> {
  return new Promise((resolve) => {
    const fullCmd = `robocopy "${dirPath}" NULL /L /S /XJ /BYTES /R:0 /W:0 /NP`
    
    const child = exec(fullCmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
      try {
        const lines = (stdout || '').split('\n')
        let size = 0
        let fileCount = 0
        
        for (const line of lines) {
          const bytesMatch = line.match(/Bytes\s+:\s+(\d+)/)
          if (bytesMatch) size = parseInt(bytesMatch[1])
          
          const filesMatch = line.match(/Files\s+:\s+(\d+)/)
          if (filesMatch) fileCount = parseInt(filesMatch[1])
        }
        resolve({ size, fileCount })
      } catch (err) {
        resolve({ size: 0, fileCount: 0 })
      }
    })

    // Set a hard timeout to kill the process if it hangs
    const timer = setTimeout(() => {
      try {
        child.kill()
        resolve({ size: 0, fileCount: 0 })
      } catch { /* ignore */ }
    }, 5000) // 5s timeout per folder

    child.on('exit', () => clearTimeout(timer))
  })
}

async function scan(currentPath: string) {
  currentPath = path.resolve(currentPath)
  
  try {
    const stats = await fs.stat(currentPath)
    const rootLastModified = stats.mtimeMs
    const entries = await fs.readdir(currentPath, { withFileTypes: true })

    const largeUnused: any[] = []
    const junkFiles: any[] = []
    const now = Date.now()
    const oneDayMs = 24 * 60 * 60 * 1000

    // Common places to look for giants if scanning a drive root, ONLY if they are on the target drive
    const highInterestPaths: string[] = []
    const currentDrive = currentPath.split(':')[0].toUpperCase()
    
    if (currentPath.length <= 3) { // Is drive root
      const userProfile = process.env.USERPROFILE || ''
      if (userProfile && userProfile.toUpperCase().startsWith(currentDrive)) {
        highInterestPaths.push(
          path.join(userProfile, 'Downloads'),
          path.join(userProfile, 'Desktop'),
          path.join(userProfile, 'Documents')
        )
      }
      
      // Drive-specific temp folders
      highInterestPaths.push(path.join(currentPath, '$RECYCLE.BIN'))
      
      if (currentDrive === 'C') {
        highInterestPaths.push(process.env.TEMP || '')
      } else {
        highInterestPaths.push(
          path.join(currentPath, 'Temp'),
          path.join(currentPath, 'Cache'),
          path.join(currentPath, 'Logs')
        )
      }
    }

    // Helper to find large/junk files in a specific folder (shallow or deeper for recycle bin)
    const scanForSuggestions = async (dir: string, depth = 0) => {
      try {
        const files = await fs.readdir(dir, { withFileTypes: true })
        for (const f of files) {
          const fullPath = path.join(dir, f.name)
          if (f.isFile()) {
            const stats = await fs.stat(fullPath).catch(() => null)
            if (stats) {
              const isJunk = f.name.endsWith('.tmp') || 
                             f.name.endsWith('.log') || 
                             f.name.toLowerCase().includes('cache') ||
                             fullPath.toUpperCase().includes('$RECYCLE.BIN') ||
                             f.name.toLowerCase().includes('temp')

              const fileNode = { name: f.name, path: fullPath, size: stats.size, type: 'file', lastModified: stats.mtimeMs, isJunk }
              
              // More sensitive detection: 10MB+ and 1 day+
              if (stats.size > 10 * 1024 * 1024 && (now - stats.mtimeMs) > oneDayMs) largeUnused.push(fileNode)
              if (isJunk) junkFiles.push(fileNode)
            }
          } else if (f.isDirectory() && (dir.toUpperCase().includes('$RECYCLE.BIN') || depth < 1)) {
            // Allow one level deeper for regular high-interest folders, or full depth for Recycle Bin
            await scanForSuggestions(fullPath, depth + 1)
          }
        }
      } catch { /* skip */ }
    }

    // Start suggestion scan
    const suggestionPromise = Promise.all([
      scanForSuggestions(currentPath),
      ...highInterestPaths.filter(Boolean).map(p => scanForSuggestions(p))
    ])

    // 1. Instantly send the list with types
    const initialFiles = entries.map(entry => {
      const isSkipped = SKIP_FOLDERS.has(entry.name)
      return {
        name: entry.name,
        path: path.join(currentPath, entry.name),
        size: 0,
        type: entry.isDirectory() ? 'directory' : 'file',
        lastModified: undefined,
        // If skipped, mark as 0 items immediately to stop 'Analyzing...' state
        fileCount: isSkipped ? 0 : undefined
      }
    })

    parentPort?.postMessage({
      type: 'folder-update',
      path: currentPath,
      size: 0,
      fileCount: initialFiles.length,
      lastModified: rootLastModified,
      files: initialFiles
    } as ScanUpdate)

    // 2. Quickly fetch stats for FILES only
    const updatedFiles = [...initialFiles]
    const fileEntries = updatedFiles.filter(f => f.type === 'file')
    
    const FILE_BATCH = 50
    for (let i = 0; i < fileEntries.length; i += FILE_BATCH) {
      const batch = fileEntries.slice(i, i + FILE_BATCH)
      await Promise.all(batch.map(async (f) => {
        try {
          const s = await fs.stat(f.path)
          f.size = s.size
          f.lastModified = s.mtimeMs
        } catch { /* ignore */ }
      }))
      
      parentPort?.postMessage({
        type: 'folder-update',
        path: currentPath,
        size: updatedFiles.reduce((acc, f) => acc + (f.size || 0), 0),
        fileCount: updatedFiles.length,
        lastModified: rootLastModified,
        files: updatedFiles
      } as ScanUpdate)
    }

    // 3. Size FOLDERS using Robocopy (Parallel and fast)
    const folderEntries = updatedFiles.filter(f => f.type === 'directory')
    const totalToProcess = folderEntries.length
    let processedCount = 0

    // Send initial stats
    parentPort?.postMessage({
      type: 'stats',
      totalItems: totalToProcess,
      processedItems: 0
    } as ScanUpdate)

    const FOLDER_CONCURRENCY = 12
    const queue = [...folderEntries]
    
    const processQueue = async () => {
      while (queue.length > 0) {
        const folder = queue.shift()
        if (!folder) break

        const isSkipped = SKIP_FOLDERS.has(folder.name)

        try {
          if (isSkipped) {
             folder.fileCount = 0
             folder.size = 0
          } else {
            const fsStats = await fs.stat(folder.path).catch(() => null)
            if (fsStats) folder.lastModified = fsStats.mtimeMs
            const result = await getFolderSizeNative(folder.path)
            folder.size = result.size
            folder.fileCount = result.fileCount
          }
          
          processedCount++
          
          // Emit update for this specific folder
          parentPort?.postMessage({
            type: 'folder-update',
            path: folder.path,
            size: folder.size,
            fileCount: folder.fileCount,
            lastModified: folder.lastModified,
            files: [],
            totalItems: totalToProcess,
            processedItems: processedCount
          } as ScanUpdate)
        } catch { 
          folder.fileCount = 0
          processedCount++
        }
      }
    }

    await Promise.all(Array(FOLDER_CONCURRENCY).fill(null).map(() => processQueue()))

    // 4. After sizing everything, look into the top 3 largest folders for even more giants!
    const topFolders = updatedFiles
      .filter(f => f.type === 'directory' && f.size > 100 * 1024 * 1024)
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, 3)

    if (topFolders.length > 0) {
      await Promise.all(topFolders.map(f => scanForSuggestions(f.path)))
    }

    await suggestionPromise // Ensure all smart tips are gathered
    
    const finalTotal = updatedFiles.reduce((acc, f) => acc + (f.size || 0), 0)
    parentPort?.postMessage({
      type: 'folder-update',
      path: currentPath,
      size: finalTotal,
      fileCount: updatedFiles.length,
      lastModified: rootLastModified,
      files: updatedFiles,
      totalItems: totalToProcess,
      processedItems: processedCount,
      suggestions: {
        largeUnused: largeUnused,
        junkFiles: junkFiles
      }
    } as ScanUpdate)

    return { size: finalTotal, fileCount: updatedFiles.length }
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
