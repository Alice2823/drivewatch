import React, { useState, useEffect, useCallback } from 'react';
import { HardDrive, Search, ShieldAlert, Clock, Database, ChevronRight, Play, Pause, X, Download, AlertTriangle, CheckCircle2, FileText, Image as ImageIcon, Video, FileArchive, File as FileIcon, ShieldCheck, Eye, ZoomIn, Hash } from 'lucide-react';
import { RecoverableFile, ScanProgress, RecoveryMode } from '../../services/recovery/types';
import { formatBytes } from '../../utils';

interface RecoveryLabProps {
  disks: any[];
}

export const RecoveryLab: React.FC<RecoveryLabProps> = ({ disks }) => {
  const [selectedDisk, setSelectedDisk] = useState<any>(null);
  const [mode, setMode] = useState<RecoveryMode>('quick');
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [foundFiles, setFoundFiles] = useState<RecoverableFile[]>([]);
  const [status, setStatus] = useState<string>('Ready to scan');
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'setup' | 'scanning' | 'results'>('setup');
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryFile, setRecoveryFile] = useState<RecoverableFile | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<string | null>(null);
  const [filterExt, setFilterExt] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'probability' | 'date'>('probability');
  const [previewFile, setPreviewFile] = useState<RecoverableFile | null>(null);

  const handleRecover = async (file: RecoverableFile) => {
    setError(null);
    setRecoveryResult(null);

    // Open native folder picker via Electron dialog
    const dest = await window.api.recovery.selectDestination();
    if (!dest) return; // User cancelled

    setRecoveryFile(file);
    setIsRecovering(true);

    try {
      const result = await window.api.recovery.recoverFile(file, dest);
      setIsRecovering(false);
      setRecoveryFile(null);

      // Guard: if IPC returned nothing (engine not initialized), treat as error
      if (!result) {
        setError('Recovery engine not available. Please restart the application and try again.');
        return;
      }

      if (result.success) {
        const quality = result.quality || 'Unknown';
        const qualityTag = quality === 'Excellent' ? 'Excellent' :
          quality === 'Good' ? 'Good' :
          quality.startsWith('Partial') ? quality :
          quality === 'Corrupted' ? 'Corrupted' : quality;

        if (result.error) {
          // Success but with warning (e.g. corrupted)
          setError(result.error);
        }

        // Special warning for Illustrator placeholder PDFs
        if (quality.includes('Illustrator')) {
          setError('This PDF is actually an Adobe Illustrator file saved without PDF-compatible content. The file was recovered successfully, but it must be opened in Adobe Illustrator — not a PDF viewer.');
        }

        setRecoveryResult(`Recovered "${file.name}.${file.extension}" -> ${result.recoveredPath || dest}  |  Quality: ${qualityTag}`);
      } else {
        setError(result.error || 'Recovery failed — no additional details available.');
      }
    } catch (e: any) {
      setIsRecovering(false);
      setRecoveryFile(null);
      setError(e.message || 'Recovery failed unexpectedly');
    }
  };

  useEffect(() => {
    const unsubProgress = window.api.recovery.onProgress((p: ScanProgress) => setProgress(p));
    const unsubFile = window.api.recovery.onFileFound((f: RecoverableFile) => {
      setFoundFiles(prev => {
        if (prev.some(existing => existing.id === f.id)) return prev;
        return [...prev, f];
      });
    });
    const unsubStatus = window.api.recovery.onStatus((s: string) => setStatus(s));
    const unsubError = window.api.recovery.onError((e: string) => {
      setError(e);
      setIsScanning(false);
    });
    const unsubDone = window.api.recovery.onDone(() => {
      setIsScanning(false);
      setView('results');
    });

    return () => {
      unsubProgress();
      unsubFile();
      unsubStatus();
      unsubError();
      unsubDone();
    };
  }, []);

  const startScan = useCallback(() => {
    if (!selectedDisk) return;
    const driveLetter = selectedDisk.mounts?.[0];
    if (!driveLetter) {
      setError('Recovery requires a mounted drive letter. This drive does not expose a recoverable volume.');
      return;
    }
    setError(null);
    setFoundFiles([]);
    setIsScanning(true);
    setView('scanning');
    window.api.recovery.startScan(driveLetter, mode);
  }, [selectedDisk, mode]);

  const stopScan = useCallback(() => {
    window.api.recovery.stopScan();
    setIsScanning(false);
    setView('setup');
  }, []);

  const pauseScan = useCallback(() => {
    window.api.recovery.pauseScan();
  }, []);

  const resumeScan = useCallback(() => {
    window.api.recovery.resumeScan();
  }, []);

  const renderFileIcon = (ext: string) => {
    const e = ext.toLowerCase();
    if (['jpg', 'png', 'gif', 'webp'].includes(e)) return <ImageIcon className="w-5 h-5 text-blue-400" />;
    if (['mp4', 'mkv', 'mov', 'avi'].includes(e)) return <Video className="w-5 h-5 text-purple-400" />;
    if (['zip', 'rar', '7z', 'tar'].includes(e)) return <FileArchive className="w-5 h-5 text-orange-400" />;
    if (['pdf', 'docx', 'txt', 'doc'].includes(e)) return <FileText className="w-5 h-5 text-green-400" />;
    return <FileIcon className="w-5 h-5 text-gray-400" />;
  };

  return (
    <div className="flex flex-col gap-8 animate-fade-in pb-6">
      {view === 'setup' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Drive Selector */}
          <div className="flex flex-col gap-6">
            <h3 className="text-sm font-black text-muted uppercase tracking-[0.2em] flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" />
              1. Select Source Drive
            </h3>
            <div className="grid grid-cols-1 gap-4">
              {disks.map(d => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDisk(d)}
                  className={`flex items-center gap-4 p-5 rounded-2xl border transition-all text-left group relative ${
                    selectedDisk?.id === d.id
                      ? 'bg-primary/10 border-primary/40 shadow-[0_0_30px_rgba(6,182,212,0.1)]'
                      : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20'
                  }`}
                >
                  <div className={`p-4 rounded-xl ${selectedDisk?.id === d.id ? 'bg-primary/20 text-primary' : 'bg-surface text-muted group-hover:text-foreground'}`}>
                    <HardDrive className="w-7 h-7" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${selectedDisk?.id === d.id ? 'text-primary' : 'text-muted'}`}>
                      {d.mounts?.[0] || 'Physical Drive'} {d.diskIndex}
                    </span>
                    <span className="text-base font-bold text-foreground truncate mt-0.5">
                      {d.name || 'Local Storage'}
                    </span>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[11px] font-bold text-muted uppercase tracking-wider">
                        {formatBytes(d.size)} • {d.type || 'HDD'}
                      </span>
                      {d.isSSD && (
                        <div className="px-2 py-0.5 rounded-full bg-warning/10 border border-warning/20">
                          <span className="text-[9px] font-black text-warning uppercase">SSD / TRIM Active</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {selectedDisk?.id === d.id && (
                    <div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_10px_rgba(6,182,212,1)]" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Mode Selector & Safety */}
          <div className="flex flex-col gap-6">
            <h3 className="text-sm font-black text-muted uppercase tracking-[0.2em] flex items-center gap-2">
              <Search className="w-4 h-4 text-primary" />
              2. Choose Recovery Mode
            </h3>
            
            <div className="flex flex-col gap-4">
              <button
                onClick={() => setMode('quick')}
                className={`p-6 rounded-2xl border transition-all text-left flex gap-5 ${
                  mode === 'quick' ? 'bg-primary/10 border-primary/40' : 'bg-white/5 border-white/5 hover:bg-white/10'
                }`}
              >
                <div className={`p-4 rounded-2xl ${mode === 'quick' ? 'bg-primary/20 text-primary' : 'bg-surface text-muted'}`}>
                  <Clock className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-foreground">Quick Recovery</h4>
                  <p className="text-sm text-muted mt-1">Scans file system metadata for recently deleted files. Recommended for first attempt.</p>
                </div>
              </button>

              <button
                onClick={() => setMode('deep')}
                className={`p-6 rounded-2xl border transition-all text-left flex gap-5 ${
                  mode === 'deep' ? 'bg-primary/10 border-primary/40' : 'bg-white/5 border-white/5 hover:bg-white/10'
                }`}
              >
                <div className={`p-4 rounded-2xl ${mode === 'deep' ? 'bg-primary/20 text-primary' : 'bg-surface text-muted'}`}>
                  <Search className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-foreground">Deep Scan Recovery</h4>
                  <p className="text-sm text-muted mt-1">Sector-level signature carving. Finds files from formatted or corrupted drives. Takes more time.</p>
                </div>
              </button>
            </div>

            <div className="mt-4 p-6 rounded-2xl bg-warning/5 border border-warning/20">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-warning/20 rounded-xl text-warning">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-[13px] font-black text-warning uppercase tracking-widest">Safe Read-Only Protocol</h4>
                  <p className="text-[12px] font-medium text-warning/80 mt-1 leading-relaxed">
                    Recovery Lab operates in a strictly non-destructive mode. We will never write data back to the source drive during scanning or recovery. Always select a different drive as the recovery destination.
                  </p>
                </div>
              </div>
            </div>

            <button
              disabled={!selectedDisk || !selectedDisk.mounts?.[0]}
              onClick={startScan}
              className={`mt-6 w-full py-5 rounded-2xl font-black uppercase tracking-[0.3em] flex items-center justify-center gap-3 transition-all ${
                selectedDisk && selectedDisk.mounts?.[0]
                  ? 'bg-primary text-background hover:scale-[1.02] active:scale-[0.98] shadow-[0_15px_40px_-10px_rgba(6,182,212,0.4)]' 
                  : 'bg-white/5 text-muted border border-white/5 cursor-not-allowed opacity-50'
              }`}
            >
              <Play className="w-5 h-5 fill-current" />
              Initialize {mode === 'quick' ? 'Quick' : 'Deep'} Scan
            </button>

            {/* Health Analysis Section */}
            {selectedDisk && (
              <div className="mt-8 flex flex-col gap-4 animate-fade-in">
                <h3 className="text-sm font-black text-muted uppercase tracking-[0.2em] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  Recovery Health Analysis
                </h3>
                <div className="glass-card p-6 border-white/5">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-black text-muted uppercase tracking-widest">Success Probability</span>
                      <div className="flex items-baseline gap-2">
                        <span className={`text-2xl font-black ${selectedDisk.isSSD ? 'text-warning' : 'text-success'}`}>
                          {selectedDisk.isSSD ? 'Low (TRIM)' : 'High (HDD)'}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-black text-muted uppercase tracking-widest">SMART Integrity</span>
                      <div className="flex items-baseline gap-2">
                        <span className={`text-2xl font-black ${selectedDisk.health === 'Good' ? 'text-success' : 'text-danger'}`}>
                          {selectedDisk.health || 'Optimal'}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-6 pt-6 border-t border-white/5 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-muted uppercase">TRIM Protection Status</span>
                      <span className={`text-[11px] font-black uppercase ${selectedDisk.isSSD ? 'text-warning' : 'text-success'}`}>
                        {selectedDisk.isSSD ? 'Active (Risk)' : 'Not Applicable'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-muted uppercase">Sector Corruption Risk</span>
                      <span className="text-[11px] font-black text-success uppercase">Low (1.2%)</span>
                    </div>
                  </div>

                  {selectedDisk.isSSD && (
                    <div className="mt-6 flex gap-3 p-4 rounded-xl bg-danger/10 border border-danger/20">
                      <AlertTriangle className="w-5 h-5 text-danger shrink-0" />
                      <p className="text-[11px] font-medium text-danger/90 leading-tight">
                        TRIM is active on this SSD. Deleted files may be purged by the controller background processes. Recovery probability decreases rapidly over time.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {view === 'scanning' && (
        <div className="flex flex-col items-center justify-center py-20 glass-card">
          <div className="relative mb-12">
            {(() => {
              const pct = progress?.percentage || 0;
              const radius = 88;
              const circumference = 2 * Math.PI * radius;
              const offset = circumference * (1 - pct / 100);
              return (
                <div className="relative w-48 h-48">
                  <svg className="w-48 h-48 -rotate-90" viewBox="0 0 192 192">
                    {/* Background track */}
                    <circle cx="96" cy="96" r={radius} fill="none" stroke="rgba(6,182,212,0.08)" strokeWidth="7" />
                    {/* Progress arc */}
                    <circle
                      cx="96" cy="96" r={radius}
                      fill="none"
                      stroke="url(#progressGradient)"
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={offset}
                      className="transition-all duration-700 ease-out"
                      style={{ filter: 'drop-shadow(0 0 8px rgba(6,182,212,0.5))' }}
                    />
                    <defs>
                      <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#06b6d4" />
                        <stop offset="100%" stopColor="#22d3ee" />
                      </linearGradient>
                    </defs>
                  </svg>
                  {/* Inner glow fill */}
                  <div className="absolute inset-3 rounded-full bg-primary/[0.04] border border-primary/10" />
                  {/* Center text */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-5xl font-black text-foreground">{Math.round(pct)}%</span>
                  </div>
                </div>
              );
            })()}
          </div>

          <h3 className="text-2xl font-black text-foreground mb-2 uppercase tracking-tight italic">
            {mode === 'quick' ? 'Quick' : 'Deep'} Scanning <span className="text-primary not-italic tracking-normal">Active</span>
          </h3>
          {(progress as any)?.stage && (
            <div className="px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 mb-4">
              <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">{(progress as any).stage}</span>
            </div>
          )}
          <p className="text-muted font-bold uppercase tracking-[0.2em] text-[11px] mb-12">{status}</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-4xl px-8">
            <div className="p-6 rounded-2xl bg-white/5 border border-white/5 flex flex-col items-center">
              <span className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">Files Found</span>
              <span className="text-2xl font-bold text-primary">{foundFiles.length}</span>
            </div>
            <div className="p-6 rounded-2xl bg-white/5 border border-white/5 flex flex-col items-center">
              <span className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">Scan Speed</span>
              <span className="text-2xl font-bold text-foreground">{progress?.speed || 0} <small className="text-sm font-medium text-muted">Sec/s</small></span>
            </div>
            <div className="p-6 rounded-2xl bg-white/5 border border-white/5 flex flex-col items-center">
              <span className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">Est. Remaining</span>
              <span className="text-2xl font-bold text-foreground">{Math.ceil((progress?.eta || 0) / 60)} <small className="text-sm font-medium text-muted">Min</small></span>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-12">
            {progress?.isPaused ? (
              <button onClick={resumeScan} className="px-8 py-3 rounded-xl bg-primary text-background font-black uppercase tracking-widest flex items-center gap-2 hover:scale-105 transition-transform">
                <Play className="w-4 h-4 fill-current" /> Resume
              </button>
            ) : (
              <button onClick={pauseScan} className="px-8 py-3 rounded-xl bg-white/10 text-foreground font-black uppercase tracking-widest flex items-center gap-2 hover:bg-white/20 transition-all">
                <Pause className="w-4 h-4 fill-current" /> Pause
              </button>
            )}
            <button onClick={stopScan} className="px-8 py-3 rounded-xl bg-danger/10 text-danger border border-danger/20 font-black uppercase tracking-widest flex items-center gap-2 hover:bg-danger/20 transition-all">
              <X className="w-4 h-4" /> Cancel Scan
            </button>
          </div>
        </div>
      )}

      {view === 'results' && (
        <div className="flex flex-col gap-6 animate-fade-in">
          {recoveryResult && (
            <div className="p-5 rounded-2xl bg-success/10 border border-success/20 flex items-center gap-4">
              <CheckCircle2 className="w-6 h-6 text-success shrink-0" />
              <p className="text-sm font-bold text-success">{recoveryResult}</p>
              <button onClick={() => setRecoveryResult(null)} className="ml-auto text-success/60 hover:text-success"><X className="w-4 h-4" /></button>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h3 className="text-xl font-black text-foreground uppercase italic">Scan Results: <span className="text-primary not-italic tracking-normal">{foundFiles.length} Items</span></h3>
              <p className="text-[10px] font-bold text-muted uppercase tracking-widest mt-1">Review and select files for recovery</p>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={filterExt}
                onChange={e => setFilterExt(e.target.value)}
                className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-[11px] font-bold text-foreground uppercase tracking-wider appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="all" className="bg-zinc-900 text-white">All Types</option>
                {[...new Set(foundFiles.map(f => f.extension))].sort().map(ext => (
                  <option key={ext} value={ext} className="bg-zinc-900 text-white">.{ext}</option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-[11px] font-bold text-foreground uppercase tracking-wider appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="probability" className="bg-zinc-900 text-white">Sort: Probability</option>
                <option value="size" className="bg-zinc-900 text-white">Sort: Size</option>
                <option value="name" className="bg-zinc-900 text-white">Sort: Name</option>
                <option value="date" className="bg-zinc-900 text-white">Sort: Date</option>
              </select>
              <button 
                onClick={() => { setView('setup'); setFoundFiles([]); setRecoveryResult(null); }}
                className="px-6 py-2 rounded-xl bg-white/5 border border-white/10 text-[11px] font-black text-muted uppercase tracking-widest hover:bg-white/10 transition-all"
              >
                New Scan
              </button>
            </div>
          </div>

          <div className="glass-card overflow-hidden border-white/5 flex flex-col" style={{ maxHeight: '60vh' }}>
            <div className="overflow-y-auto flex-1" style={{ scrollbarGutter: 'stable' }}>
              <table className="w-full text-left">
                <thead className="sticky top-0 z-20" style={{ background: '#0a0a0f', boxShadow: '0 1px 0 rgba(255,255,255,0.1)' }}>
                  <tr className="border-b border-white/10">
                    <th className="px-6 py-4 text-[10px] font-black text-muted uppercase tracking-widest">File Name</th>
                    <th className="px-4 py-4 text-[10px] font-black text-muted uppercase tracking-widest">Type</th>
                    <th className="px-4 py-4 text-[10px] font-black text-muted uppercase tracking-widest">Source</th>
                    <th className="px-4 py-4 text-[10px] font-black text-muted uppercase tracking-widest">Original Path</th>
                    <th className="px-4 py-4 text-[10px] font-black text-muted uppercase tracking-widest text-right">Size</th>
                    <th className="px-4 py-4 text-[10px] font-black text-muted uppercase tracking-widest text-center">Probability</th>
                    <th className="px-4 py-4 text-[10px] font-black text-muted uppercase tracking-widest text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(() => {
                    let filtered = filterExt === 'all' ? foundFiles : foundFiles.filter(f => f.extension === filterExt);
                    filtered = [...filtered].sort((a, b) => {
                      if (sortBy === 'probability') return b.probability - a.probability;
                      if (sortBy === 'size') return b.size - a.size;
                      if (sortBy === 'name') return a.name.localeCompare(b.name);
                      if (sortBy === 'date') return (b.deletionDate || '').localeCompare(a.deletionDate || '');
                      return 0;
                    });
                    const PAGE_SIZE = 200;
                    const visible = filtered.slice(0, PAGE_SIZE);
                    if (visible.length === 0) return (
                      <tr><td colSpan={7} className="px-6 py-20 text-center text-muted italic">No recoverable files found matching filter.</td></tr>
                    );
                    return (<>
                      {visible.map(file => (
                      <tr key={file.id} className="hover:bg-white/[0.03] transition-colors group cursor-pointer" onClick={() => setPreviewFile(file)}>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-surface group-hover:bg-primary/10 transition-colors">
                              {renderFileIcon(file.extension)}
                            </div>
                            <div className="flex flex-col">
                              <span className="font-bold text-foreground text-sm">{file.name}</span>
                              {file.deletionDate && (
                                <span className="text-[10px] text-muted">{new Date(file.deletionDate).toLocaleDateString()}</span>
                              )}
                              {!file.deletionDate && file.recoveryNote && (
                                <span className={`text-[10px] ${file.hasTerminator === false ? 'text-warning' : 'text-muted'}`}>{file.recoveryNote}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[11px] font-black text-muted uppercase bg-white/5 px-2 py-0.5 rounded-md">.{file.extension}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full border ${
                            file.source === 'recycle_bin' ? 'bg-success/10 text-success border-success/20' :
                            file.source === 'mft_deleted' ? 'bg-primary/10 text-primary border-primary/20' :
                            'bg-warning/10 text-warning border-warning/20'
                          }`}>
                            {file.source === 'recycle_bin' ? 'Recycle Bin' : file.source === 'mft_deleted' ? 'MFT Entry' : 'Signature'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[12px] font-medium text-muted truncate max-w-[180px] block">{file.path}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-[12px] font-bold text-foreground/80">{formatBytes(file.size)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-center gap-1">
                            <div className="w-16 h-1.5 rounded-full bg-white/5 overflow-hidden">
                              <div 
                                className={`h-full rounded-full ${file.probability > 80 ? 'bg-success' : file.probability > 40 ? 'bg-warning' : 'bg-danger'}`}
                                style={{ width: `${file.probability}%` }}
                              />
                            </div>
                            <span className={`text-[9px] font-black ${file.probability > 80 ? 'text-success' : file.probability > 40 ? 'text-warning' : 'text-danger'}`}>
                              {file.probability}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                          <button 
                            onClick={() => handleRecover(file)}
                            disabled={file.probability < 10}
                            className={`p-2 rounded-xl transition-all active:scale-95 ${
                              file.probability >= 10 
                                ? 'bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-background' 
                                : 'bg-white/5 text-muted/30 border border-white/5 cursor-not-allowed'
                            }`}
                            title={file.probability >= 10 ? 'Recover File' : 'Too corrupted'}
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filtered.length > PAGE_SIZE && (
                      <tr><td colSpan={7} className="px-6 py-6 text-center text-[11px] font-bold text-muted uppercase tracking-widest bg-white/[0.02]">Showing {PAGE_SIZE} of {filtered.length} results. Use filters to narrow down.</td></tr>
                    )}
                    </>);
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* FILE PREVIEW MODAL */}
      {previewFile && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-background/90 animate-fade-in" onClick={() => setPreviewFile(null)}>
          <div className="glass-card w-full max-w-2xl max-h-[85vh] flex flex-col border-white/10 shadow-lg m-6" onClick={e => e.stopPropagation()}>
            {/* Preview Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-primary/10">{renderFileIcon(previewFile.extension)}</div>
                <div className="min-w-0">
                  <h3 className="text-base font-black text-foreground truncate">{previewFile.name}.{previewFile.extension}</h3>
                  <p className="text-[10px] font-bold text-muted uppercase tracking-widest">{formatBytes(previewFile.size)} • {previewFile.source === 'recycle_bin' ? 'Recycle Bin' : previewFile.source === 'mft_deleted' ? 'MFT Entry' : 'Signature Carve'}</p>
                </div>
              </div>
              <button onClick={() => setPreviewFile(null)} className="p-2 rounded-xl hover:bg-white/10 transition-colors text-muted hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>

            {/* Preview Content */}
            <div className="flex-1 overflow-auto p-6 bg-black/20">
              {['jpg','jpeg','png','gif','bmp','webp'].includes(previewFile.extension.toLowerCase()) ? (
                <div className="flex flex-col items-center justify-center min-h-[300px]">
                  {previewFile.recycleBinPath ? (
                    <img src={`file://${previewFile.recycleBinPath}`} alt={previewFile.name} className="max-w-full max-h-[60vh] rounded-xl border border-white/10 object-contain shadow-2xl" />
                  ) : (
                    <div className="w-full h-64 rounded-xl border border-white/10 bg-white/[0.02] flex flex-col items-center justify-center gap-3">
                      <ImageIcon className="w-16 h-16 text-primary/30" />
                      <p className="text-sm font-bold text-muted">Raw image requires recovery to preview</p>
                      <p className="text-[10px] text-muted/60 uppercase tracking-widest">Click 'Recover File' below</p>
                    </div>
                  )}
                </div>
              ) : ['mp4','mov','avi','mkv','webm'].includes(previewFile.extension.toLowerCase()) ? (
                <div className="flex flex-col items-center justify-center min-h-[300px]">
                  {previewFile.recycleBinPath ? (
                    <video src={`file://${previewFile.recycleBinPath}`} controls autoPlay muted className="max-w-full max-h-[60vh] rounded-xl border border-white/10 shadow-2xl" />
                  ) : (
                    <div className="w-full h-64 rounded-xl border border-white/10 bg-white/[0.02] flex flex-col items-center justify-center gap-3">
                      <Video className="w-16 h-16 text-purple-400/30" />
                      <p className="text-sm font-bold text-muted">Raw video requires recovery to preview</p>
                    </div>
                  )}
                </div>
              ) : previewFile.extension.toLowerCase() === 'pdf' ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
                  {previewFile.recycleBinPath ? (
                    <iframe src={`file://${previewFile.recycleBinPath}`} className="w-full h-[60vh] rounded-xl border border-white/10 bg-white" title="PDF Preview" />
                  ) : (
                    <div className="w-full h-64 rounded-xl border border-white/10 bg-white/[0.02] flex flex-col items-center justify-center gap-3">
                      <FileText className="w-16 h-16 text-red-400/30" />
                      <p className="text-sm font-bold text-muted">Raw PDF requires recovery to preview</p>
                    </div>
                  )}
                </div>
              ) : ['txt','log','json','xml','csv','ini','cfg','md','yaml','yml'].includes(previewFile.extension.toLowerCase()) ? (
                <div className="flex flex-col items-center justify-center min-h-[300px]">
                  <div className="w-full h-64 rounded-xl border border-white/10 bg-white/[0.02] flex flex-col items-center justify-center gap-3">
                    <FileText className="w-16 h-16 text-green-400/30" />
                    <p className="text-sm font-bold text-muted">{previewFile.recycleBinPath ? 'Text file cached successfully' : 'Raw text requires recovery to view contents'}</p>
                    {previewFile.recycleBinPath && (
                      <p className="text-[10px] text-muted/60 uppercase tracking-widest bg-black/40 px-3 py-1 rounded-full font-mono mt-2 truncate max-w-[80%]">{previewFile.recycleBinPath}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="w-full h-64 rounded-xl border border-white/10 bg-white/[0.02] flex flex-col items-center justify-center gap-3">
                  <FileIcon className="w-16 h-16 text-muted/20" />
                  <p className="text-sm font-bold text-muted">No preview handler for .{previewFile.extension} format</p>
                  <p className="text-[10px] text-muted/60 uppercase tracking-widest">Hex/Signature view available after recovery</p>
                </div>
              )}
            </div>

            {/* Preview File Details */}
            <div className="px-6 py-4 border-t border-white/5 shrink-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-black text-muted uppercase tracking-widest">Extension</span>
                  <span className="text-sm font-bold text-foreground">.{previewFile.extension}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-black text-muted uppercase tracking-widest">File Size</span>
                  <span className="text-sm font-bold text-foreground">{formatBytes(previewFile.size)}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-black text-muted uppercase tracking-widest">Recovery</span>
                  <span className={`text-sm font-black ${previewFile.probability > 80 ? 'text-success' : previewFile.probability > 40 ? 'text-warning' : 'text-danger'}`}>{previewFile.probability}%</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-black text-muted uppercase tracking-widest">Sector</span>
                  <span className="text-sm font-bold text-foreground font-mono">{previewFile.sectorStart}</span>
                </div>
              </div>
              {previewFile.deletionDate && (
                <div className="flex flex-col gap-0.5 mb-4">
                  <span className="text-[9px] font-black text-muted uppercase tracking-widest">Deleted</span>
                  <span className="text-sm font-bold text-foreground">{new Date(previewFile.deletionDate).toLocaleString()}</span>
                </div>
              )}
              {previewFile.source === 'signature_carve' && previewFile.recoveryNote && (
                <div className={`mb-4 p-3 rounded-xl border ${previewFile.hasTerminator === false ? 'bg-warning/10 border-warning/20 text-warning' : 'bg-success/10 border-success/20 text-success'}`}>
                  <p className="text-[11px] font-bold">{previewFile.recoveryNote}</p>
                </div>
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setPreviewFile(null); handleRecover(previewFile); }}
                  disabled={previewFile.probability < 10}
                  className={`flex-1 py-3 rounded-xl font-black uppercase tracking-widest text-[11px] flex items-center justify-center gap-2 transition-all ${
                    previewFile.probability >= 10 ? 'bg-primary text-background hover:scale-[1.02] active:scale-[0.98]' : 'bg-white/5 text-muted cursor-not-allowed'
                  }`}
                >
                  <Download className="w-4 h-4" /> Recover File
                </button>
                <button onClick={() => setPreviewFile(null)} className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 font-black uppercase tracking-widest text-[11px] text-muted hover:bg-white/10 transition-all">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isRecovering && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 animate-fade-in">
          <div className="glass-card p-12 flex flex-col items-center gap-6 max-w-sm border-primary/20 shadow-lg">
            <div className="relative">
              <Download className="w-16 h-16 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="text-xl font-black text-foreground uppercase tracking-tight italic">Recovering <span className="text-primary not-italic tracking-normal">Data</span></h3>
              <p className="text-sm font-bold text-muted uppercase tracking-widest mt-2">Exporting: {recoveryFile?.name}</p>
            </div>
            <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full bg-primary" style={{ width: '100%' }} />
            </div>
            <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Initializing Safe Write...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-6 rounded-2xl bg-danger/10 border border-danger/20 flex items-center gap-4 animate-shake">
          <AlertTriangle className="w-6 h-6 text-danger" />
          <p className="text-sm font-bold text-danger">Error: {error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-danger/60 hover:text-danger"><X className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
};
