import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Square, AlertTriangle, CheckCircle2, Terminal, Shield, ChevronDown, Wrench } from 'lucide-react'


import logo from '../assets/logo.png'

interface DriveScannerProps {
  drives: string[]
}

interface ScanResult {
  errors: string[]
  warnings: string[]
  info: string[]
}

export const DriveScanner: React.FC<DriveScannerProps> = React.memo(({ drives }) => {
  const [selectedDrive, setSelectedDrive] = useState<string>('')
  const [isScanning, setIsScanning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [logLines, setLogLines] = useState<string[]>([])
  const [scanComplete, setScanComplete] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  // Check admin status on mount
  useEffect(() => {
    window.api.isAdmin().then(setIsAdmin).catch(() => setIsAdmin(false))
  }, [])

  // Auto-select first drive
  useEffect(() => {
    if (drives.length > 0 && !selectedDrive) {
      setSelectedDrive(drives[0])
    }
  }, [drives, selectedDrive])

  // Subscribe to scan events
  useEffect(() => {
    const cleanupProgress = window.api.onScanProgress((data) => {
      if (data.progress !== undefined) {
        setProgress(data.progress)
      }
    })

    const cleanupOutput = window.api.onScanOutput((data) => {
      if (data.line) {
        setLogLines(prev => [...prev.slice(-200), data.line])
      }
    })

    const cleanupFinished = window.api.onScanFinished((data) => {
      setIsScanning(false)
      setProgress(data.success ? 100 : progress)
      setScanComplete(true)
    })

    return () => {
      cleanupProgress()
      cleanupOutput()
      cleanupFinished()
    }
  }, [])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logLines])

  // Parse results from log lines
  useEffect(() => {
    if (scanComplete && logLines.length > 0) {
      const errors: string[] = []
      const warnings: string[] = []
      const info: string[] = []

      for (const line of logLines) {
        const lower = line.toLowerCase()

        // Explicitly check for bad sectors to handle 0 KB case
        const badSectorsMatch = lower.match(/(\d+(?:,\d+)?)\s*kb in bad sectors/)
        if (badSectorsMatch) {
          const kb = parseInt(badSectorsMatch[1].replace(/,/g, ''), 10)
          if (kb > 0) {
            errors.push(line)
          } else {
            info.push(line)
          }
          continue
        }

        if (lower.includes('no problems found') || lower.includes('no further action is required')) {
          info.push(line)
          continue
        }

        if (lower.includes('[error]') || lower.includes('corrupt') || lower.includes('unrecoverable')) {
          errors.push(line)
        } else if (lower.includes('warning') || lower.includes('repair') || lower.includes('fix')) {
          warnings.push(line)
        } else if (lower.includes('[done]') || lower.includes('[info]')) {
          info.push(line)
        }
      }

      setScanResult({ errors, warnings, info })
    }
  }, [scanComplete, logLines])

  const handleStartScan = useCallback(() => {
    if (!selectedDrive || isScanning) return
    setLogLines([])
    setProgress(0)
    setScanComplete(false)
    setScanResult(null)
    setIsScanning(true)
    window.api.scanDisk(selectedDrive)
  }, [selectedDrive, isScanning])

  const handleFixDisk = useCallback(() => {
    if (!selectedDrive || isScanning) return
    setLogLines([])
    setProgress(0)
    setScanComplete(false)
    setScanResult(null)
    setIsScanning(true)
    window.api.fixDisk(selectedDrive)
  }, [selectedDrive, isScanning])


  const handleStopScan = useCallback(() => {
    if (!selectedDrive) return
    window.api.stopDiskScan(selectedDrive)
    setIsScanning(false)
  }, [selectedDrive])

  const uniqueDrives = [...new Set(drives.filter(Boolean))]

  return (
    <div className="animate-fade-in flex flex-col gap-8">

      {/* Admin Warning */}
      {isAdmin === false && (
        <div className="p-4 rounded-xl border border-warning/30 bg-warning/5 flex items-start gap-3">

          <Shield className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-warning">Administrator Required</p>
            <p className="text-xs text-muted mt-1">
              Drive scanning requires administrator privileges. Please restart DriveWatch as administrator to use this feature.
            </p>
          </div>
        </div>
      )}

      {/* Controls Bar */}
      <div className="glass-card p-6 md:p-8 relative z-50 shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-bold text-muted uppercase tracking-widest">Scanner Configuration</h4>
            <p className="text-xs text-muted/60">Select a volume and choose an action to perform</p>
          </div>

          <div className="flex flex-wrap items-center gap-4">


          {/* Drive Selector */}
          <div className="relative w-full sm:w-auto">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              disabled={isScanning}
              className="flex items-center gap-3 px-6 py-3.5 rounded-xl border border-border bg-card-solid text-foreground text-base font-bold w-full sm:min-w-[180px] justify-between disabled:opacity-50 transition-all hover:border-primary hover:shadow-lg active:scale-[0.98]"

            >
              <span>{selectedDrive || 'Select Drive'}</span>
              <ChevronDown className={`w-4 h-4 text-muted transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-full bg-card-solid border border-border rounded-xl shadow-lg z-50 overflow-hidden">
                {uniqueDrives.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-muted">No drives detected</div>
                ) : (
                  uniqueDrives.map(drive => (
                    <button
                      key={drive}
                      onClick={() => { setSelectedDrive(drive); setDropdownOpen(false) }}
                      className={`w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-surface transition-colors ${
                        selectedDrive === drive ? 'text-primary bg-primary/5' : 'text-foreground'
                      }`}
                    >
                      {drive}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Scan Buttons */}
          {!isScanning ? (
            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <button
                onClick={handleStartScan}
                disabled={!selectedDrive || isAdmin === false}
                className="btn-primary flex justify-center items-center gap-3 px-8 py-3.5 flex-1 sm:flex-none text-base"
              >
                <Search className="w-5 h-5" />
                Start Scan
              </button>

              <button
                onClick={handleFixDisk}
                disabled={!selectedDrive || isAdmin === false}
                className="btn-warning flex justify-center items-center gap-3 px-8 py-3.5 flex-1 sm:flex-none text-base"
              >
                <Wrench className="w-5 h-5" />
                Fix Drive
              </button>

            </div>
          ) : (
            <button
              onClick={handleStopScan}
              className="btn-danger flex justify-center items-center gap-3 px-10 py-3.5 w-full sm:w-auto text-base"
            >
              <Square className="w-5 h-5 fill-current" />
              Stop Scan
            </button>

          )}

        </div>
      </div>

        {/* Progress Bar */}
        {(isScanning || scanComplete) && (
          <div className="mt-5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-muted uppercase tracking-wider">
                {isScanning ? 'Scanning...' : 'Complete'}
              </span>
              <span className="text-sm font-extrabold text-primary">{progress}%</span>
            </div>
            <div className="usage-bar-track">
              <div
                className="usage-bar-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Empty State */}
      {!isScanning && !scanComplete && logLines.length === 0 && (
        <div className="glass-card p-12 flex flex-col items-center justify-center text-center min-h-[400px] relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
          <div className="p-8 rounded-3xl bg-white border border-border mb-8 shadow-2xl relative z-10">
            <img src={logo} alt="DriveWatch" className="w-24 h-24 object-contain" />
          </div>

          <h3 className="text-[24px] font-black text-foreground mb-3 relative z-10 tracking-tight">System Ready for Scan</h3>
          <p className="text-[14px] text-muted max-w-sm">
            Select a drive and start the scanner to verify data integrity and check for bad sectors.
          </p>
        </div>
      )}

      {/* Log Output */}
      {logLines.length > 0 && (
        <div className="glass-card p-4 md:p-6">

          <div className="flex items-center gap-2 mb-4">
            <Terminal className="w-4 h-4 text-muted" />
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-muted">Scan Output</h4>
          </div>
          <div ref={logRef} className="scan-log">
            {logLines.map((line, i) => {
              let lineClass = 'text-foreground/70'
              if (line.startsWith('[ERROR]')) lineClass = 'text-accent font-bold'
              else if (line.startsWith('[DONE]')) lineClass = 'text-success font-bold'
              else if (line.startsWith('[INFO]')) lineClass = 'text-primary'

              return (
                <div key={i} className={lineClass}>
                  {line}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Scan Results Summary */}
      {scanResult && (
        <div className="glass-card p-4 md:p-6">
          <h4 className="text-sm font-extrabold text-foreground mb-4">Scan Results</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Errors */}
            <div className={`p-4 rounded-xl border ${
              scanResult.errors.length > 0
                ? 'border-accent/30 bg-accent/5'
                : 'border-border bg-card-solid'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className={`w-4 h-4 ${scanResult.errors.length > 0 ? 'text-accent' : 'text-muted'}`} />
                <span className="text-xs font-extrabold uppercase tracking-wider text-muted">Errors</span>
              </div>
              <span className={`text-2xl font-black ${scanResult.errors.length > 0 ? 'text-accent' : 'text-foreground/50'}`}>
                {scanResult.errors.length}
              </span>
            </div>

            {/* Warnings */}
            <div className={`p-4 rounded-xl border ${
              scanResult.warnings.length > 0
                ? 'border-warning/30 bg-warning/5'
                : 'border-border bg-card-solid'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className={`w-4 h-4 ${scanResult.warnings.length > 0 ? 'text-warning' : 'text-muted'}`} />
                <span className="text-xs font-extrabold uppercase tracking-wider text-muted">Warnings</span>
              </div>
              <span className={`text-2xl font-black ${scanResult.warnings.length > 0 ? 'text-warning' : 'text-foreground/50'}`}>
                {scanResult.warnings.length}
              </span>
            </div>

            {/* All Clear */}
            <div className={`p-4 rounded-xl border ${
              scanResult.errors.length === 0 && scanResult.warnings.length === 0
                ? 'border-success/30 bg-success/5'
                : 'border-accent/30 bg-accent/5'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {scanResult.errors.length === 0 && scanResult.warnings.length === 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-success" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-accent" />
                )}
                <span className="text-xs font-extrabold uppercase tracking-wider text-muted">Status</span>
              </div>
              <span className={`text-sm font-black ${
                scanResult.errors.length === 0 && scanResult.warnings.length === 0 ? 'text-success' : 'text-accent'
              }`}>
                {scanResult.errors.length === 0 && scanResult.warnings.length === 0
                  ? '✔ No Issues Found'
                  : '❌ Issues Detected'
                }
              </span>
            </div>
          </div>

          {/* Detail lists */}
          {scanResult.errors.length > 0 && (
            <div className="mt-4 p-4 rounded-xl bg-accent/5 border border-accent/20">
              <h5 className="text-xs font-extrabold uppercase tracking-wider text-accent mb-2">Error Details</h5>
              {scanResult.errors.map((e, i) => (
                <p key={i} className="text-xs text-foreground/70 py-1">{e}</p>
              ))}
            </div>
          )}

          {scanResult.warnings.length > 0 && (
            <div className="mt-4 p-4 rounded-xl bg-warning/5 border border-warning/20">
              <h5 className="text-xs font-extrabold uppercase tracking-wider text-warning mb-2">Warnings</h5>
              {scanResult.warnings.map((w, i) => (
                <p key={i} className="text-xs text-foreground/70 py-1">{w}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

DriveScanner.displayName = 'DriveScanner'
