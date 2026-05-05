import React, { useState } from 'react'
import { ChevronRight, Folder, HardDrive } from 'lucide-react'

interface StorageNode {
  name: string
  path: string
  size: number
  type: 'file' | 'directory'
  children?: StorageNode[]
}

interface FolderTreeProps {
  nodes: StorageNode[]
  currentPath: string
  onNavigate: (path: string) => void
  onExpand: (path: string) => void
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const TreeItem: React.FC<{ 
  node: StorageNode; 
  depth: number; 
  onNavigate: (path: string) => void; 
  onExpand: (path: string) => void;
  currentPath: string 
}> = ({ node, depth, onNavigate, onExpand, currentPath }) => {
  const [isOpen, setIsOpen] = useState(false)
  const isActive = currentPath === node.path
  const isSelected = currentPath.startsWith(node.path)

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    const nextOpen = !isOpen
    setIsOpen(nextOpen)
    if (nextOpen && (!node.children || node.children.length === 0)) {
      onExpand(node.path)
    }
  }
  return (
    <div className="flex flex-col relative">
      <button
        onClick={() => {
          onNavigate(node.path)
          if (!isOpen) {
            setIsOpen(true)
            onExpand(node.path)
          }
        }}
        className={`flex items-center gap-3 py-2 px-3 rounded-xl transition-all duration-200 text-left group relative z-10 active:scale-[0.98] hover:scale-[1.01] ${
          isActive 
            ? 'bg-primary/15 text-primary border border-primary/30 shadow-[0_0_15px_rgba(6,182,212,0.1)]' 
            : 'hover:bg-surface/50 text-muted hover:text-foreground border border-transparent'
        }`}
        style={{ marginLeft: `${depth * 24}px` }}
      >
        {isActive && <div className="absolute left-0 w-1 h-5 bg-primary rounded-r-full shadow-[0_0_10px_var(--color-primary)]" />}
        <div 
          onClick={handleToggle}
          className="p-1 hover:bg-white/10 rounded-md transition-colors"
        >
          <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-90 text-primary' : 'text-muted/40 group-hover:text-muted/80'}`} />
        </div>
        <Folder className={`w-4 h-4 transition-colors ${isActive ? 'text-primary drop-shadow-md' : 'text-primary/40 group-hover:text-primary/80'}`} />
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-[13px] font-bold truncate leading-tight tracking-wide">{node.name}</span>
          <span className="text-[9px] font-black text-muted/50 uppercase tracking-widest">{formatBytes(node.size)}</span>
        </div>
      </button>
      
      {isOpen && (
        <div className="flex flex-col mt-1 relative animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="absolute left-4 top-0 bottom-0 w-[1px] bg-white/10" style={{ left: `${depth * 24 + 23}px` }} />
          <div className="flex flex-col pl-1">
            {node.children ? (
              node.children.filter(c => c.type === 'directory').length > 0 ? (
                node.children
                  .filter(c => c.type === 'directory')
                  .map(child => (
                    <TreeItem key={child.path} node={child} depth={depth + 1} onNavigate={onNavigate} onExpand={onExpand} currentPath={currentPath} />
                  ))
              ) : (
                <div className="py-2 px-8 text-[9px] font-bold text-muted/30 uppercase italic" style={{ marginLeft: `${depth * 24 + 12}px` }}>
                  No subfolders
                </div>
              )
            ) : (
              <div className="py-2 px-8 text-[9px] font-bold text-muted/30 uppercase italic animate-pulse" style={{ marginLeft: `${depth * 24 + 12}px` }}>
                Loading...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export const FolderTree: React.FC<FolderTreeProps> = ({ nodes, onNavigate, onExpand, currentPath }) => {
  return (
    <div className="w-72 flex flex-col gap-3 overflow-y-auto pr-4 border-r border-white/5 scrollbar-thin scrollbar-thumb-white/10">
      <div className="flex items-center justify-between mb-4 px-2">
        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted">File System</h4>
        <div className="w-8 h-1 bg-primary/20 rounded-full" />
      </div>
      
      {nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center opacity-20">
           <HardDrive className="w-10 h-10 mb-2" />
           <span className="text-[10px] font-bold uppercase tracking-widest">No volumes active</span>
        </div>
      ) : (
        nodes.map((node) => (
          <TreeItem key={node.path} node={node} depth={0} onNavigate={onNavigate} onExpand={onExpand} currentPath={currentPath} />
        ))
      )}
    </div>
  )
}
