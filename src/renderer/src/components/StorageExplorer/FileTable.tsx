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
    <div className="flex-1 flex flex-col overflow-hidden bg-nav/30 rounded-2xl border border-white/5 shadow-inner">
      <div className="overflow-auto flex-1">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-background/95 backdrop-blur-md z-10">
            <tr className="border-b border-white/10">
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted w-12 text-center">
                #
              </th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted">Item Name</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted w-32">Total Size</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted w-40">Last Modified</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-6 py-32 text-center">
                  <div className="flex flex-col items-center gap-6">
                    <div className="relative">
                      <div className="w-12 h-12 rounded-full border-4 border-primary/10 border-t-primary animate-spin" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-black text-primary uppercase tracking-[0.2em]">Analyzing Cluster</span>
                      <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Populating file hierarchy...</span>
                    </div>
                  </div>
                </td>
              </tr>
            ) : files.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-32 text-center">
                   <div className="flex flex-col items-center gap-4 opacity-40">
                     <Folder className="w-12 h-12 text-muted" />
                     <span className="text-xs font-bold text-muted uppercase tracking-widest italic">Directory contains no data</span>
                   </div>
                </td>
              </tr>
            ) : (
              files.map((file) => (
                <tr 
                  key={file.path}
                  onClick={() => onSelect(file.path)}
                  onDoubleClick={() => file.type === 'directory' && onNavigate(file.path)}
                  className={`group hover:bg-white/5 transition-all cursor-pointer ${selectedPaths.has(file.path) ? 'bg-primary/10 border-l-2 border-l-primary' : ''}`}
                >
                  <td className="px-6 py-4">
                    <div 
                      className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${
                        selectedPaths.has(file.path) ? 'bg-primary border-primary' : 'border-white/20 group-hover:border-primary/50'
                      }`}
                    >
                      {selectedPaths.has(file.path) && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${file.type === 'directory' ? 'bg-primary/10 text-primary' : 'bg-surface text-muted'}`}>
                        {file.type === 'directory' ? (
                          <Folder className="w-4 h-4" />
                        ) : (
                          <File className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-bold text-foreground/90 truncate group-hover:text-primary transition-colors">{file.name}</span>
                        {file.type === 'directory' && (
                          <span className="text-[10px] text-muted font-bold uppercase tracking-wider">
                            {file.fileCount !== undefined ? `${file.fileCount.toLocaleString()} items` : 'Analyzing...'}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                       <span className="text-sm font-black text-foreground/80 tracking-tight">
                         {formatBytes(file.size)}
                       </span>
                       <div className="w-20 h-1 bg-white/5 rounded-full mt-1 overflow-hidden">
                          <div 
                            className="h-full bg-primary/50" 
                            style={{ width: `${Math.min((file.size / (1024 * 1024 * 1024)) * 10, 100)}%` }} 
                          />
                       </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-[11px] font-bold text-muted uppercase tracking-[0.1em]">
                    {file.lastModified ? new Date(file.lastModified).toLocaleDateString() : '--'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
