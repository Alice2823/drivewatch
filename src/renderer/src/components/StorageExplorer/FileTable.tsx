import React from 'react'
import { Folder, File, HardDrive } from 'lucide-react'

interface StorageNode {
  name: string
  path: string
  size: number
  type: 'file' | 'directory'
  lastModified?: number
  fileCount?: number
}

interface FileTableProps {
  files: StorageNode[]
  onNavigate: (path: string) => void
  onSelect: (path: string) => void
  selectedPaths: Set<string>
  isLoading: boolean
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export const FileTable: React.FC<FileTableProps> = ({ files, onNavigate, onSelect, selectedPaths, isLoading }) => {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-surface/10 rounded-2xl border border-white/5 shadow-inner">
      {/* List Header */}
      <div className="flex items-center px-6 py-4 border-b border-white/10 bg-background/95 backdrop-blur-md z-10 sticky top-0">
        <div className="w-12 text-center text-[10px] font-black uppercase tracking-widest text-muted">#</div>
        <div className="flex-1 text-[10px] font-black uppercase tracking-widest text-muted pl-4">Item Name</div>
        <div className="w-32 text-[10px] font-black uppercase tracking-widest text-muted">Total Size</div>
        <div className="w-40 text-[10px] font-black uppercase tracking-widest text-muted">Last Modified</div>
      </div>

      {/* List Body */}
      <div className="flex-1 overflow-auto flex flex-col p-2 gap-1.5">
        {isLoading ? (
          <div className="flex flex-col gap-1.5 p-1">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex items-center px-4 py-3 rounded-xl border border-transparent bg-white/[0.01]">
                <div className="w-12 flex justify-center shrink-0">
                  <div className="w-4 h-4 rounded border border-white/5 bg-white/[0.03] animate-pulse" style={{ animationDuration: '3s' }} />
                </div>
                <div className="flex-1 flex items-center gap-4 pl-4 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.03] shrink-0 animate-pulse" style={{ animationDuration: '3s', animationDelay: '0.2s' }} />
                  <div className="flex flex-col gap-2 min-w-0 flex-1">
                    <div className="w-1/3 h-3.5 bg-white/[0.03] rounded animate-pulse" style={{ animationDuration: '3s', animationDelay: '0.4s' }} />
                    <div className="w-1/4 h-2 bg-white/[0.02] rounded animate-pulse" style={{ animationDuration: '3s', animationDelay: '0.6s' }} />
                  </div>
                </div>
                <div className="w-32 shrink-0 flex flex-col justify-center gap-2">
                  <div className="w-16 h-3.5 bg-white/[0.03] rounded animate-pulse" style={{ animationDuration: '3s', animationDelay: '0.5s' }} />
                  <div className="w-20 h-1 bg-white/[0.02] rounded-full animate-pulse" style={{ animationDuration: '3s', animationDelay: '0.7s' }} />
                </div>
                <div className="w-40 shrink-0">
                  <div className="w-24 h-3 bg-white/[0.02] rounded animate-pulse" style={{ animationDuration: '3s', animationDelay: '0.8s' }} />
                </div>
              </div>
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-32">
            <div className="flex flex-col items-center gap-4 opacity-40">
              <Folder className="w-12 h-12 text-muted" />
              <span className="text-xs font-bold text-muted uppercase tracking-widest italic text-center px-8">Directory contains no data</span>
            </div>
          </div>
        ) : (
          files.map((file) => {
            const isSelected = selectedPaths.has(file.path);
            
            // Calculate size visually - make large files pop with warning/accent colors
            const sizeInGB = file.size / (1024 * 1024 * 1024);
            const sizePercent = Math.min((sizeInGB / 5) * 100, 100); // 5GB max scale
            const sizeColor = sizeInGB > 2 ? 'bg-accent shadow-[0_0_8px_rgba(236,72,153,0.4)]' 
                            : sizeInGB > 0.5 ? 'bg-warning shadow-[0_0_8px_rgba(245,158,11,0.4)]' 
                            : 'bg-primary shadow-[0_0_5px_rgba(6,182,212,0.4)]';

            return (
              <div
                key={file.path}
                onClick={() => onSelect(file.path)}
                onDoubleClick={() => file.type === 'directory' && onNavigate(file.path)}
                className={`flex items-center px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer group active:scale-[0.98] border ${
                  isSelected 
                    ? 'bg-primary/10 border-primary/40 shadow-[0_0_20px_rgba(6,182,212,0.1)]' 
                    : 'bg-surface/5 border-transparent hover:border-white/10 hover:bg-surface/30 hover:-translate-y-[1px]'
                }`}
              >
                {/* Checkbox Col */}
                <div className="w-12 flex justify-center shrink-0">
                  <div className={`w-4 h-4 rounded border transition-all duration-200 flex items-center justify-center ${
                    isSelected ? 'bg-primary border-primary scale-110' : 'border-white/10 group-hover:border-primary/40'
                  }`}>
                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                </div>

                {/* Name Col */}
                <div className="flex-1 flex items-center gap-4 pl-4 min-w-0">
                  <div className={`p-2.5 rounded-xl transition-all duration-300 ${
                    file.type === 'directory' 
                      ? 'bg-primary/5 text-primary group-hover:bg-primary/10 group-hover:shadow-[0_0_10px_rgba(6,182,212,0.15)]' 
                      : 'bg-surface/10 text-muted group-hover:bg-surface/20'
                  }`}>
                    {file.type === 'directory' ? <Folder className="w-5 h-5" /> : <File className="w-5 h-5" />}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className={`text-[13px] font-bold truncate transition-colors tracking-wide ${sizeInGB > 1 ? 'text-foreground' : 'text-foreground/90'} group-hover:text-primary`}>
                      {file.name}
                    </span>
                    {file.type === 'directory' && (
                      <span className="text-[10px] text-muted font-bold uppercase tracking-widest mt-0.5 opacity-60">
                        {file.fileCount !== undefined ? `${file.fileCount.toLocaleString()} items` : 'Analyzing...'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Size Col */}
                <div className="w-32 shrink-0 flex flex-col justify-center">
                  <span className={`text-[13px] font-black tracking-tight ${sizeInGB > 1 ? 'text-foreground' : 'text-foreground/80'}`}>
                    {formatBytes(file.size)}
                  </span>
                  <div className="w-20 h-1 bg-black/40 rounded-full mt-2 overflow-hidden border border-white/5">
                    <div 
                      className={`h-full transition-all duration-700 ${sizeColor}`} 
                      style={{ width: `${Math.max(sizePercent, 2)}%` }} 
                    />
                  </div>
                </div>

                {/* Date Col */}
                <div className="w-40 shrink-0 text-[11px] font-bold text-muted uppercase tracking-[0.1em] opacity-60">
                  {file.lastModified ? new Date(file.lastModified).toLocaleDateString() : '--'}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
