import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { FolderTree } from './FolderTree'
import { FileTable } from './FileTable'
import { CleanupSuggestions } from './CleanupSuggestions'
import { HardDrive, Search, Trash2, ArrowLeft, RefreshCw, AlertTriangle, ChevronRight } from 'lucide-react'

interface StorageNode {
  name: string
  path: string
  size: number
  type: 'file' | 'directory'
  lastModified?: number
  fileCount?: number
  children?: StorageNode[]
}

interface StorageExplorerProps {
  disks: any[]
}

export const StorageExplorer: React.FC<StorageExplorerProps> = ({ disks }) => {
  const [currentPath, setCurrentPath] = useState<string>('')
  const [viewFiles, setViewFiles] = useState<StorageNode[]>([])
  const [treeNodes, setTreeNodes] = useState<StorageNode[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isDone, setIsDone] = useState(false)
  const [scanProgress, setScanProgress] = useState({ total: 0, processed: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Initialize or update drives from disks data without resetting children
  useEffect(() => {
    if (disks.length > 0) {
      setTreeNodes(prev => {
        const driveNodes: StorageNode[] = []
        
        disks.forEach(disk => {
          if (disk.mounts) {
            disk.mounts.forEach(mount => {
              if (!mount) return
              let path = mount
              if (path.length === 2 && path[1] === ':') path += '\\'
              
              const existing = prev.find(p => p.path === path)
              driveNodes.push({
                name: mount,
                path: path,
                size: existing?.size || disk.size || 0,
                type: 'directory',
                children: existing?.children
              })
            })
          }
        })
        
        // Sort to keep order consistent
        return driveNodes.sort((a, b) => a.path.localeCompare(b.path))
      })
      
      // Set initial path if none
      if (!currentPath) {
        const first = disks[0]?.mounts?.[0]
        if (first) {
          let p = first
          if (p.length === 2 && p[1] === ':') p += '\\'
          setCurrentPath(p)
        }
      }
    }
  }, [disks])

  const loadFolderData = useCallback(async (path: string) => {
    const results = await window.api.storage.list(path)
    
    // Update tree with discovered children
    setTreeNodes(prev => {
      const updateNode = (nodes: StorageNode[]): StorageNode[] => {
        let changed = false
        const nextNodes = nodes.map(n => {
          if (n.path === path) {
            changed = true
            // Merge children to preserve any sub-children already in the tree
            const mergedChildren = results.map(nc => {
              const existing = (n.children || []).find(ec => ec.path === nc.path)
              return existing ? { ...nc, ...existing } : nc
            })
            return { ...n, children: mergedChildren }
          }
          // Check if path is a subpath of n.path
          const prefix = n.path.endsWith('\\') || n.path.endsWith('/') ? n.path : n.path + '\\'
          if (path.startsWith(prefix)) {
            const updatedChildren = updateNode(n.children || [])
            if (updatedChildren !== n.children) {
              changed = true
              return { ...n, children: updatedChildren }
            }
          }
          return n
        })
        return changed ? nextNodes : nodes
      }
      return updateNode(prev)
    })
    
    return results
  }, [])

  // Fetch immediate contents when path changes
  useEffect(() => {
    if (!currentPath) return
    
    const load = async () => {
      setIsLoading(true)
      const results = await loadFolderData(currentPath)
      setViewFiles(results)
      setIsLoading(false)
    }
    load()
  }, [currentPath, loadFolderData])

  // Listen for background scan updates
  useEffect(() => {
    const cleanup = window.api.storage.onProgress((node: any) => {
      // Update progress if stats are available
      if (node.totalItems !== undefined) {
        setScanProgress({ total: node.totalItems, processed: node.processedItems || 0 })
      }

      // Update tree nodes recursively
      setTreeNodes(prev => {
        const updateNode = (nodes: StorageNode[]): StorageNode[] => {
          let changed = false
          const nextNodes = nodes.map(n => {
            if (n.path === node.path) {
              changed = true
              // Merge properties and children
              const mergedChildren = (node.children || []).map(nc => {
                const existing = (n.children || []).find(ec => ec.path === nc.path)
                return existing ? { ...nc, ...existing } : nc
              })
              return { ...n, ...node, children: mergedChildren }
            }
            // Check if node.path is a subpath of n.path
            const prefix = n.path.endsWith('\\') || n.path.endsWith('/') ? n.path : n.path + '\\'
            if (node.path.startsWith(prefix)) {
              const updatedChildren = updateNode(n.children || [])
              if (updatedChildren !== n.children) {
                changed = true
                return { ...n, children: updatedChildren }
              }
            }
            return n
          })
          return changed ? nextNodes : nodes
        }
        return updateNode(prev)
      })

      // Update current view if this node is the one we are looking at OR a child of it
      if (node.path === currentPath) {
        setViewFiles(node.children || [])
      } else {
        setViewFiles(prev => prev.map(f => f.path === node.path ? { ...f, ...node } : f))
      }
    })

    const cleanupDone = window.api.storage.onDone(() => {
      setIsScanning(false)
      setIsDone(true)
      setScanProgress({ total: 0, processed: 0 })
      setTimeout(() => setIsDone(false), 3000)
    })

    return () => {
      cleanup()
      cleanupDone()
    }
  }, [currentPath])

  const handleNavigate = (path: string) => {
    setCurrentPath(path)
    setSelectedPaths(new Set())
    setScanProgress({ total: 0, processed: 0 })
  }

  const handleScan = () => {
    if (!currentPath) return
    setIsScanning(true)
    setScanProgress({ total: 0, processed: 0 })
    window.api.storage.scan(currentPath)
  }

  const handleDelete = async () => {
    if (selectedPaths.size === 0) return
    if (!confirm(`Are you sure? Moving ${selectedPaths.size} items to Recycle Bin cannot be easily undone.`)) return
    
    const results = await window.api.storage.delete(Array.from(selectedPaths))
    if (results.success) {
      // Refresh current view
      const updated = await window.api.storage.list(currentPath)
      setViewFiles(updated)
      setSelectedPaths(new Set())
    }
  }

  const filteredFiles = useMemo(() => {
    if (!searchQuery) return viewFiles
    return viewFiles.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
  }, [viewFiles, searchQuery])

  const breadcrumbs = useMemo(() => {
    return currentPath.split(/[\\/]/).filter(Boolean)
  }, [currentPath])

  return (
    <div className="flex flex-col h-[calc(100vh-160px)] animate-fade-in gap-6">
      {/* Header / Toolbar */}
      <div className="flex items-center justify-between bg-surface/30 p-5 rounded-3xl border border-white/5 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-6 flex-1 min-w-0">
          <button 
            onClick={() => {
              const parts = currentPath.split(/[\\/]/).filter(Boolean)
              if (parts.length > 1) {
                handleNavigate(parts.slice(0, -1).join('\\') + (currentPath.includes('\\') ? '\\' : '/'))
              }
            }}
            className="p-3 hover:bg-white/10 rounded-2xl text-muted transition-all active:scale-95"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          
          <div className="flex flex-col min-w-0 flex-1">
             <div className="flex items-center gap-2 text-[10px] font-black text-muted uppercase tracking-[0.2em] mb-1">
               <HardDrive className="w-3 h-3" />
               Current Path
             </div>
             <div className="flex items-center gap-1.5 overflow-hidden">
                {breadcrumbs.map((part, i) => (
                  <React.Fragment key={i}>
                    <span className="text-sm font-bold text-foreground/80 hover:text-primary cursor-pointer transition-colors truncate">
                      {part}
                    </span>
                    {i < breadcrumbs.length - 1 && <ChevronRight className="w-3 h-3 text-muted/30 shrink-0" />}
                  </React.Fragment>
                ))}
             </div>
             
             {/* Progress Bar */}
             {isScanning && scanProgress.total > 0 && (
               <div className="mt-2 flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-1 duration-500">
                 <div className="flex items-center justify-between">
                   <span className="text-[9px] font-black text-primary uppercase tracking-[0.1em] animate-pulse">
                     Analyzing Structure... {Math.round((scanProgress.processed / scanProgress.total) * 100)}%
                   </span>
                   <span className="text-[9px] font-bold text-muted/60">
                     {scanProgress.processed} / {scanProgress.total} Folders
                   </span>
                 </div>
                 <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                   <div 
                     className="h-full bg-primary shadow-[0_0_10px_rgba(6,182,212,0.5)] transition-all duration-300"
                     style={{ width: `${(scanProgress.processed / scanProgress.total) * 100}%` }}
                   />
                 </div>
               </div>
             )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative group max-w-[360px] flex-1">
            <div className="absolute inset-0 bg-primary/10 blur-2xl rounded-3xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-700" />
            <div className="relative flex items-center bg-black/45 border border-white/10 rounded-[1.25rem] pl-5 pr-3 py-2.5 transition-all duration-500 group-focus-within:border-primary/40 group-focus-within:bg-black/60 group-focus-within:shadow-[0_0_30px_rgba(var(--color-primary-rgb),0.1)] shadow-inner">
              <Search className="w-4 h-4 text-muted/50 group-focus-within:text-primary transition-all duration-500 group-focus-within:scale-110 shrink-0" />
              <input 
                type="text"
                placeholder="Search directory..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none focus:outline-none text-sm ml-3.5 w-full placeholder:text-muted/20 font-medium text-foreground/90 min-w-0"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-2 h-10">
            <button 
              onClick={handleScan}
              disabled={isScanning}
              className={`flex items-center gap-2 px-5 h-full rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
                isScanning 
                  ? 'bg-primary/20 text-primary border border-primary/30 animate-pulse' 
                  : isDone
                    ? 'bg-success/20 text-success border border-success/30 shadow-[0_0_15px_rgba(34,197,94,0.2)]'
                    : 'bg-primary text-white hover:shadow-xl hover:shadow-primary/20 active:scale-95'
              }`}
            >
              {isScanning ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Analyzing
                </>
              ) : isDone ? (
                <div className="flex items-center gap-2 animate-in zoom-in-95 duration-300">
                  <HardDrive className="w-3.5 h-3.5" />
                  Done
                </div>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  Deep Scan
                </>
              )}
            </button>

            <button 
              onClick={() => setShowSuggestions(!showSuggestions)}
              className={`flex items-center gap-2 px-5 h-full rounded-2xl text-xs font-black uppercase tracking-widest border transition-all ${
                showSuggestions 
                  ? 'bg-warning/10 border-warning/30 text-warning' 
                  : 'border-white/10 text-muted hover:border-white/20 active:scale-95'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Smart Tips
            </button>

            {selectedPaths.size > 0 && (
              <button 
                onClick={handleDelete}
                className="flex items-center gap-2 px-5 h-full bg-accent text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:shadow-xl hover:shadow-accent/20 transition-all active:scale-95"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Cleanup ({selectedPaths.size})
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-8 flex-1 overflow-hidden">
        <FolderTree 
          nodes={treeNodes} 
          currentPath={currentPath} 
          onNavigate={handleNavigate} 
          onExpand={loadFolderData} 
        />
        
        <div className="flex-1 flex flex-col overflow-hidden">
          {showSuggestions ? (
            <CleanupSuggestions drivePath={currentPath.split(/[\\/]/)[0] + (currentPath.includes('\\') ? '\\' : '/')} />
          ) : (
            <FileTable 
              files={filteredFiles} 
              onNavigate={handleNavigate}
              onSelect={(path) => {
                const next = new Set(selectedPaths)
                if (next.has(path)) next.delete(path)
                else next.add(path)
                setSelectedPaths(next)
              }}
              selectedPaths={selectedPaths}
              isLoading={isLoading}
            />
          )}
        </div>
      </div>
    </div>
  )
}
