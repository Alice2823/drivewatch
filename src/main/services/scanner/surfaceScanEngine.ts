import { EventEmitter } from 'events'
import { spawn, ChildProcessWithoutNullStreams, execSync } from 'child_process'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { runSmartScan } from './smartScan'
import { saveScanResult, clearScanResult } from './scanResultStore'

const SECTOR_SIZE = 512
const SECTORS_PER_CHUNK = 2048
const READ_BYTES = SECTOR_SIZE * SECTORS_PER_CHUNK
const PROGRESS_BATCH = 16
const MAX_BLOCKS = 4096

const HEALTHY_THRESHOLD_MS = 50
const WEAK_THRESHOLD_MS = 150
const UNREADABLE_THRESHOLD_MS = 500
const INTEGRITY_FAILURE_MESSAGE = 'Scan integrity failure: no physical IO detected'
const DISCONNECT_MESSAGE = 'Drive disconnected during scan'

export type ScanMode = 'quick' | 'full' | 'smart'
export type ScanExecutionMode = 'REAL_SCAN' | 'SIMULATION_MODE'
export type BlockStatus = 0 | 1 | 2 | 3 | 4

export interface RealIoTelemetry {
  device: string
  handleValid: boolean
  deviceConnected: boolean
  sector: number
  offset: number
  bytesRequested: number
  bytesRead: number
  readLatency: number
  readSuccess: boolean
  throughputMBs: number
  ioActivityBytes: number | null
  win32Error: number
  noBuffering: boolean
}

export interface ScanProgress {
  percent: number
  currentLba: number
  totalLbas: number
  readSpeedMBs: number
  etaSec: number
  errorCount: number
  slowCount: number
  blocks: BlockStatus[]
  totalBlocks: number
  temperature: number | null
  healthPct: number | null
  executionMode: ScanExecutionMode
  realIo: boolean
  actualBytesRead: number
  lastReadBytes: number
  lastReadLatencyMs: number
  ioTelemetry: RealIoTelemetry | null
  realIoStatus: 'DIRECT_IO' | 'BUFFERED_FALLBACK' | 'READING' | 'FAILED' | 'DISCONNECTED' | null
}

export interface ScanResult {
  success: boolean
  cancelled: boolean
  errorCount: number
  slowCount: number
  totalChunks: number
  durationSec: number
  error?: string
  executionMode: ScanExecutionMode
  realIo: boolean
  actualBytesRead: number
}

export interface DriveDescriptor {
  diskIndex: number
  name: string
  type: string
  sizeLba: number
  temperature: number | null
}

interface RawReaderReady {
  type: 'ready'
  device: string
  diskIndex: number
  handleValid: boolean
  deviceConnected: boolean
  sizeBytes: number
  sizeLba: number
  noBuffering: boolean
  error?: string
  win32Error?: number
}

interface RawReaderLine extends RealIoTelemetry {
  type: 'read'
  id: string
}

type RawReaderMessage = RawReaderReady | RawReaderLine | { type: 'closed' } | { type: 'error'; id?: string; error: string }

const activeScans = new Map<number, SurfaceScanSession>()

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function psSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function createBlockMap(totalChunks: number): BlockStatus[] {
  return new Array(Math.min(totalChunks, MAX_BLOCKS)).fill(0 as BlockStatus)
}

function chunkToBlock(chunkIdx: number, totalChunks: number, totalBlocks: number): number {
  if (totalChunks <= 0 || totalBlocks <= 0) return 0
  return clamp(Math.floor((chunkIdx / totalChunks) * totalBlocks), 0, totalBlocks - 1)
}

function mergeStatus(current: BlockStatus, next: BlockStatus): BlockStatus {
  if (next === 3 || current === 3) return 3
  if (next === 2 || current === 2) return 2
  if (next === 1 || current === 1) return 1
  if (next === 4 || current === 4) return 4
  return 0
}

function setBlockStatus(blocks: BlockStatus[], chunkIdx: number, totalChunks: number, status: BlockStatus): void {
  const idx = chunkToBlock(chunkIdx, totalChunks, blocks.length)
  blocks[idx] = mergeStatus(blocks[idx] ?? 0, status)
}

export function decodeWin32Error(code: number): string {
  switch (code) {
    case 2: return 'ERROR_FILE_NOT_FOUND (2): The system cannot find the file specified.'
    case 3: return 'ERROR_PATH_NOT_FOUND (3): The system cannot find the path specified.'
    case 5: return 'ERROR_ACCESS_DENIED (5): Access is denied. Administrator privileges required.'
    case 21: return 'ERROR_NOT_READY (21): The device is not ready.'
    case 32: return 'ERROR_SHARING_VIOLATION (32): Sharing violation. The physical drive is locked by another process.'
    case 55: return 'ERROR_DEV_NOT_EXIST (55): The specified device is no longer available.'
    case 87: return 'ERROR_INVALID_PARAMETER (87): Invalid parameter. Alignment/buffer size mismatch under FILE_FLAG_NO_BUFFERING.'
    case 1117: return 'ERROR_IO_DEVICE (1117): The request could not be performed because of an I/O device error.'
    case 1167: return 'ERROR_DEVICE_NOT_CONNECTED (1167): The device is not connected.'
    default: return `Win32 Error (${code})`
  }
}

export function normalizeDevicePath(pathStr: string): string {
  let p = pathStr.trim()
  if (p.endsWith('\\') && p.length > 3 && !p.startsWith('\\\\?\\Volume')) {
    p = p.slice(0, -1)
  }
  if (/^[A-Za-z]:$/.test(p)) {
    p = `\\\\.\\${p}`
  } else if (/^[A-Za-z]:\\$/.test(p)) {
    p = `\\\\.\\${p.slice(0, 2)}`
  } else if (/^\d+$/.test(p)) {
    p = `\\\\.\\PhysicalDrive${p}`
  } else if (/^PhysicalDrive\d+$/i.test(p)) {
    p = `\\\\.\\${p}`
  }
  return p
}

export function checkIsAdmin(): boolean {
  try {
    if (process.platform === 'win32') {
      execSync('net session', { stdio: 'ignore' })
      return true
    }
  } catch {}
  return false
}

function logRawIo(msg: string): void {
  const ts = new Date().toISOString()
  try {
    const logPath = path.join(app.getPath('userData'), 'drivewatch_logs.txt')
    fs.appendFileSync(logPath, `[${ts}] ${msg}\n`)
  } catch {}
  console.log(msg)
}

function formatRealIoLog(t: RealIoTelemetry): string {
  return `[REAL_IO]
device=${t.device}
handleValid=${t.handleValid}
deviceConnected=${t.deviceConnected}
sector=${t.sector}
offset=${t.offset}
bytesRequested=${t.bytesRequested}
bytesRead=${t.bytesRead}
readLatency=${t.readLatency.toFixed(2)}
readSuccess=${t.readSuccess}
throughputMBs=${t.throughputMBs.toFixed(2)}`
}

function isDisconnectTelemetry(t: RealIoTelemetry): boolean {
  return !t.handleValid || !t.deviceConnected || t.win32Error === 21 || t.win32Error === 55 || t.win32Error === 1167
}

function buildRawReaderScript(diskIndex: number, devicePath: string): string {
  return `
$ErrorActionPreference = 'Stop'
$devicePath = ${psSingleQuoted(devicePath)}
$diskIndex = ${diskIndex}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public struct ReadResult {
  public bool Success;
  public uint BytesRead;
  public uint Win32Error;
  public int HResult;
  public long FailingOffset;
  public uint FailingBytes;
}

public static class DWRawDisk {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateFile(string fileName, UInt32 desiredAccess, UInt32 shareMode, IntPtr securityAttributes, UInt32 creationDisposition, UInt32 flagsAndAttributes, IntPtr templateFile);

  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr handle);

  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool SetFilePointerEx(IntPtr handle, Int64 distanceToMove, out Int64 newFilePointer, UInt32 moveMethod);

  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool ReadFile(IntPtr handle, IntPtr buffer, UInt32 bytesToRead, out UInt32 bytesRead, IntPtr overlapped);

  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool DeviceIoControl(IntPtr handle, UInt32 ioControlCode, IntPtr inBuffer, UInt32 inBufferSize, IntPtr outBuffer, UInt32 outBufferSize, out UInt32 bytesReturned, IntPtr overlapped);

  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr VirtualAlloc(IntPtr address, UIntPtr size, UInt32 allocationType, UInt32 protect);

  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool VirtualFree(IntPtr address, UIntPtr size, UInt32 freeType);

  public static ReadResult ReadDiskDirect(IntPtr handle, long offset, IntPtr buffer, uint bytesToRead) {
    ReadResult res = new ReadResult();
    res.Success = false;
    res.BytesRead = 0;
    res.Win32Error = 0;
    res.HResult = 0;
    res.FailingOffset = offset;
    res.FailingBytes = bytesToRead;

    try {
      long newFilePointer = 0;
      bool seekOk = false;
      try {
        seekOk = SetFilePointerEx(handle, offset, out newFilePointer, 0);
      } catch (Exception seekEx) {
        res.Win32Error = (uint)Marshal.GetLastWin32Error();
        if (res.Win32Error == 0) res.Win32Error = 1;
        res.HResult = seekEx.HResult;
        res.FailingOffset = offset;
        res.FailingBytes = bytesToRead;
        return res;
      }

      if (!seekOk || newFilePointer != offset) {
        res.Win32Error = (uint)Marshal.GetLastWin32Error();
        if (res.Win32Error == 0) res.Win32Error = 131;
        res.HResult = Marshal.GetHRForLastWin32Error();
        res.FailingOffset = offset;
        res.FailingBytes = bytesToRead;
        return res;
      }

      uint read = 0;
      bool ok = false;
      try {
        ok = ReadFile(handle, buffer, bytesToRead, out read, IntPtr.Zero);
        res.BytesRead = read;
      } catch (Exception rfEx) {
        res.Win32Error = (uint)Marshal.GetLastWin32Error();
        if (res.Win32Error == 0) res.Win32Error = 1117;
        res.HResult = rfEx.HResult;
        res.FailingOffset = offset;
        res.FailingBytes = bytesToRead;
        return res;
      }

      if (ok && read > 0) {
        res.Success = true;
      } else {
        res.Win32Error = (uint)Marshal.GetLastWin32Error();
        if (res.Win32Error == 0) res.Win32Error = 1117;
        res.HResult = Marshal.GetHRForLastWin32Error();
        res.FailingOffset = offset;
        res.FailingBytes = bytesToRead;
      }
    } catch (Exception ex) {
      res.Win32Error = (uint)Marshal.GetLastWin32Error();
      if (res.Win32Error == 0) res.Win32Error = 13;
      res.HResult = ex.HResult;
      res.FailingOffset = offset;
      res.FailingBytes = bytesToRead;
    }
    return res;
  }
}
'@

function Write-JsonLine($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 8))
  [Console]::Out.Flush()
}

function Test-Handle([IntPtr]$handle) {
  return ($handle -ne [IntPtr]::Zero -and $handle -ne [IntPtr](-1))
}

function Get-Win32Error {
  return [Runtime.InteropServices.Marshal]::GetLastWin32Error()
}

function Get-DiskLength([IntPtr]$handle) {
  $outBuffer = [DWRawDisk]::VirtualAlloc([IntPtr]::Zero, ([UIntPtr]::new(8)), 0x3000, 0x04)
  if ($outBuffer -eq [IntPtr]::Zero) { return 0 }

  $bytesReturned = [uint32]0
  $ok = [DWRawDisk]::DeviceIoControl($handle, 0x0007405C, [IntPtr]::Zero, 0, $outBuffer, 8, [ref]$bytesReturned, [IntPtr]::Zero)
  $length = 0L
  if ($ok -and $bytesReturned -ge 8) {
    $length = [Runtime.InteropServices.Marshal]::ReadInt64($outBuffer)
  }
  [void][DWRawDisk]::VirtualFree($outBuffer, ([UIntPtr]::new(0)), 0x8000)
  return $length
}

function Test-DeviceConnected([IntPtr]$handle, [int]$index) {
  if (-not (Test-Handle $handle)) { return $false }
  if ((Get-DiskLength $handle) -le 0) { return $false }
  return $true
}

function Get-ProcessReadBytes {
  try {
    $proc = Get-Process -Id $PID -ErrorAction Stop
    if ($null -ne $proc.IOReadBytes) { return [int64]$proc.IOReadBytes }
  } catch {}
  return $null
}

function Write-RawIoStart($device, $path, $admin, $workerPid, $workerStarted, $handleCreated, $createFileError, $win32Err) {
  [Console]::Out.WriteLine("[RAW_IO_START]")
  [Console]::Out.WriteLine("device=" + $device)
  [Console]::Out.WriteLine("path=" + $path)
  [Console]::Out.WriteLine("admin=" + $admin)
  [Console]::Out.WriteLine("pid=" + $workerPid)
  [Console]::Out.WriteLine("workerStarted=" + $workerStarted)
  [Console]::Out.WriteLine("handleCreated=" + $handleCreated)
  [Console]::Out.WriteLine("createFileError=" + $createFileError)
  [Console]::Out.WriteLine("win32Error=" + $win32Err)
  [Console]::Out.WriteLine("logicalSectorSize=" + $logicalSectorSize)
  [Console]::Out.WriteLine("physicalSectorSize=" + $physicalSectorSize)
  [Console]::Out.WriteLine("")
  [Console]::Out.Flush()
}

function Write-RawIoConfig($sectorSize, $alignment, $bufferSize, $flags, $noBuffering, $overlapped) {
  [Console]::Out.WriteLine("[RAW_IO_CONFIG]")
  [Console]::Out.WriteLine("sectorSize=" + $sectorSize)
  [Console]::Out.WriteLine("alignment=" + $alignment)
  [Console]::Out.WriteLine("bufferSize=" + $bufferSize)
  [Console]::Out.WriteLine("flags=" + $flags)
  [Console]::Out.WriteLine("noBuffering=" + $noBuffering)
  [Console]::Out.WriteLine("overlapped=" + $overlapped)
  [Console]::Out.WriteLine("")
  [Console]::Out.Flush()
}

function Write-RawIoRead($bytesRequested, $bytesRead, $success, $error) {
  [Console]::Out.WriteLine("[RAW_IO_READ]")
  [Console]::Out.WriteLine("bytesRequested=" + $bytesRequested)
  [Console]::Out.WriteLine("bytesRead=" + $bytesRead)
  [Console]::Out.WriteLine("success=" + $success)
  [Console]::Out.WriteLine("error=" + $error)
  [Console]::Out.WriteLine("")
  [Console]::Out.Flush()
}

function Write-RawIoExit($reason, $exception, $stack, $workerExitCode) {
  [Console]::Out.WriteLine("[RAW_IO_EXIT]")
  [Console]::Out.WriteLine("reason=" + $reason)
  [Console]::Out.WriteLine("exception=" + $exception)
  [Console]::Out.WriteLine("stack=" + $stack)
  [Console]::Out.WriteLine("workerExitCode=" + $workerExitCode)
  [Console]::Out.WriteLine("")
  [Console]::Out.Flush()
}

function Write-RawIoFallback($reason, $err, $logicalSectorSize, $physicalSectorSize, $offset, $alignedBytes) {
  [Console]::Out.WriteLine("[RAW_IO_FALLBACK]")
  [Console]::Out.WriteLine("fallbackActivationReason=" + $reason)
  [Console]::Out.WriteLine("win32Error=" + $err)
  [Console]::Out.WriteLine("logicalSectorSize=" + $logicalSectorSize)
  [Console]::Out.WriteLine("physicalSectorSize=" + $physicalSectorSize)
  [Console]::Out.WriteLine("currentOffset=" + $offset)
  [Console]::Out.WriteLine("alignedReadSize=" + $alignedBytes)
  [Console]::Out.WriteLine("")
  [Console]::Out.Flush()
}

function Write-RawIoReadBegin($logicalSectorSize, $physicalSectorSize, $offset, $alignedBytes, $bytesRequested) {
  [Console]::Out.WriteLine("[RAW_IO_READ_BEGIN]")
  [Console]::Out.WriteLine("logicalSectorSize=" + $logicalSectorSize)
  [Console]::Out.WriteLine("physicalSectorSize=" + $physicalSectorSize)
  [Console]::Out.WriteLine("currentOffset=" + $offset)
  [Console]::Out.WriteLine("alignedReadSize=" + $alignedBytes)
  [Console]::Out.WriteLine("bytesRequested=" + $bytesRequested)
  [Console]::Out.WriteLine("")
  [Console]::Out.Flush()
}

function Write-RawIoReadSuccess($offset, $bytesRead, $logicalSectorSize, $physicalSectorSize) {
  [Console]::Out.WriteLine("[RAW_IO_READ_SUCCESS]")
  [Console]::Out.WriteLine("currentOffset=" + $offset)
  [Console]::Out.WriteLine("bytesRead=" + $bytesRead)
  [Console]::Out.WriteLine("logicalSectorSize=" + $logicalSectorSize)
  [Console]::Out.WriteLine("physicalSectorSize=" + $physicalSectorSize)
  [Console]::Out.WriteLine("")
  [Console]::Out.Flush()
}

function Write-RawIoReadFail($offset, $bytes, $err, $hr, $logicalSectorSize, $physicalSectorSize) {
  [Console]::Out.WriteLine("[RAW_IO_READ_FAIL]")
  [Console]::Out.WriteLine("failingOffset=" + $offset)
  [Console]::Out.WriteLine("failingBytes=" + $bytes)
  [Console]::Out.WriteLine("win32Error=" + $err)
  [Console]::Out.WriteLine("hresult=" + $hr)
  [Console]::Out.WriteLine("logicalSectorSize=" + $logicalSectorSize)
  [Console]::Out.WriteLine("physicalSectorSize=" + $physicalSectorSize)
  [Console]::Out.WriteLine("")
  [Console]::Out.Flush()
}

function Write-RawIoRecovered($offset, $bytesRead, $logicalSectorSize, $physicalSectorSize) {
  [Console]::Out.WriteLine("[RAW_IO_RECOVERED]")
  [Console]::Out.WriteLine("currentOffset=" + $offset)
  [Console]::Out.WriteLine("bytesRead=" + $bytesRead)
  [Console]::Out.WriteLine("logicalSectorSize=" + $logicalSectorSize)
  [Console]::Out.WriteLine("physicalSectorSize=" + $physicalSectorSize)
  [Console]::Out.WriteLine("")
  [Console]::Out.Flush()
}

$GENERIC_READ = [uint32]0x80000000L
$FILE_SHARE_ALL = [uint32]0x00000007
$OPEN_EXISTING = [uint32]3
$FILE_FLAG_NO_BUFFERING = [uint32]0x20000000
$FILE_FLAG_SEQUENTIAL_SCAN = [uint32]0x08000000

# Query Admin & Process ID
$admin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$workerPid = $PID

# Sector size discovery with compatibility fallback for Advanced Format & NVMe system drives
$logicalSectorSize = 512
$physicalSectorSize = 4096 # Safe physical sector size baseline

try {
  if ($diskIndex -ge 0) {
    $diskObj = Get-Disk -Number $diskIndex -ErrorAction SilentlyContinue
    if ($diskObj) {
      if ($diskObj.SectorSize -gt 0) {
        $logicalSectorSize = $diskObj.SectorSize
      }
      if ($diskObj.PhysicalSectorSize -gt 0) {
        $physicalSectorSize = $diskObj.PhysicalSectorSize
      }
    }
    # Query via WMI/CIM for USB bridge controllers and NVMe drives which may not report physical sector size correctly through Get-Disk
    if ($physicalSectorSize -le 512) {
      $wmiDisk = Get-WmiObject -Class Win32_DiskDrive -Filter "Index=$diskIndex" -ErrorAction SilentlyContinue
      if ($wmiDisk -and $wmiDisk.BytesPerSector -gt 0) {
        $logicalSectorSize = $wmiDisk.BytesPerSector
      }
    }
  } else {
    if ($devicePath -match '([A-Za-z]):') {
      $driveLetter = $Matches[1]
      $vol = Get-Volume -DriveLetter $driveLetter -ErrorAction SilentlyContinue
      if ($vol -and $vol.SectorSize -gt 0) {
        $logicalSectorSize = $vol.SectorSize
        $physicalSectorSize = $vol.SectorSize
      }
    }
  }
} catch {}

# Sanity bounds check
if ($physicalSectorSize -lt $logicalSectorSize) {
  $physicalSectorSize = $logicalSectorSize
}
if ($physicalSectorSize -lt 4096) {
  $physicalSectorSize = 4096
}
$alignment = $physicalSectorSize

# Attempt unbuffered open
$noBuffering = $true
$flags = $FILE_FLAG_NO_BUFFERING -bor $FILE_FLAG_SEQUENTIAL_SCAN
$handle = [DWRawDisk]::CreateFile($devicePath, $GENERIC_READ, $FILE_SHARE_ALL, [IntPtr]::Zero, $OPEN_EXISTING, $flags, [IntPtr]::Zero)
$createFileError = ""
$win32Err = 0
$handleCreated = Test-Handle $handle

if (-not $handleCreated) {
  $win32Err = Get-Win32Error
  $createFileError = "CreateFile with NO_BUFFERING failed (Win32 $win32Err)"

  # Log startup fallback trigger
  Write-RawIoFallback -reason $createFileError -err $win32Err -logicalSectorSize $logicalSectorSize -physicalSectorSize $physicalSectorSize -offset 0 -alignedBytes 0

  # Fallback: Retry buffered mode
  $noBuffering = $false
  $flags = $FILE_FLAG_SEQUENTIAL_SCAN
  $handle = [DWRawDisk]::CreateFile($devicePath, $GENERIC_READ, $FILE_SHARE_ALL, [IntPtr]::Zero, $OPEN_EXISTING, $flags, [IntPtr]::Zero)
  $handleCreated = Test-Handle $handle
  if ($handleCreated) {
    $win32Err = 0
    $createFileError = ""
  } else {
    $win32Err = Get-Win32Error
    $createFileError = "CreateFile buffered fallback failed (Win32 $win32Err)"
  }
}

Write-RawIoStart -device $devicePath -path $devicePath -admin ($admin.ToString()) -workerPid $workerPid -workerStarted "True" -handleCreated ($handleCreated.ToString()) -createFileError $createFileError -win32Err $win32Err

if (-not $handleCreated) {
  Write-JsonLine @{
    type = 'ready'
    device = $devicePath
    diskIndex = $diskIndex
    handleValid = $false
    deviceConnected = $false
    sizeBytes = 0
    sizeLba = 0
    noBuffering = $false
    win32Error = $win32Err
    error = $createFileError
  }
  Write-RawIoExit -reason "CreateFile failed" -exception $createFileError -stack "" -workerExitCode 5
  exit 5
}

$sizeBytes = Get-DiskLength $handle
$deviceConnected = Test-DeviceConnected $handle $diskIndex

Write-RawIoConfig -sectorSize $logicalSectorSize -alignment $alignment -bufferSize (2048 * $logicalSectorSize) -flags $flags -noBuffering ($noBuffering.ToString()) -overlapped "False"

Write-JsonLine @{
  type = 'ready'
  device = $devicePath
  diskIndex = $diskIndex
  handleValid = $true
  deviceConnected = $deviceConnected
  sizeBytes = $sizeBytes
  sizeLba = [int64]($sizeBytes / 512)
  noBuffering = $noBuffering
}

trap {
  $err = $_.Exception.Message
  $stack = $_.ScriptStackTrace
  Write-RawIoExit -reason "Uncaught Exception" -exception $err -stack $stack -workerExitCode 1
  exit 1
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }

  $req = $line | ConvertFrom-Json
  if ($req.cmd -eq 'close') { break }
  if ($req.cmd -ne 'read') { continue }

  $id = [string]$req.id
  $sector = [int64]$req.sector
  $offset = [int64]$req.offset
  $bytesRequested = [uint32]$req.bytesRequested

  $handleValid = Test-Handle $handle
  $connected = if ($handleValid) { Test-DeviceConnected $handle $diskIndex } else { $false }
  $bytesRead = [uint32]0
  $readLatency = 0.0
  $readSuccess = $false
  $win32Error = 0
  $hresult = 0
  $fallbackReason = ""
  $ioBefore = Get-ProcessReadBytes
  $ioAfter = $ioBefore

  $alignedOffset = $offset
  $alignedBytes = $bytesRequested

  if ($handleValid -and $connected -and $bytesRequested -gt 0) {
    if (($offset % $physicalSectorSize) -ne 0) {
      $alignedOffset = [Math]::Floor($offset / $physicalSectorSize) * $physicalSectorSize
      $diff = $offset - $alignedOffset
      $alignedBytes = [uint32]([Math]::Ceiling(($bytesRequested + $diff) / $physicalSectorSize) * $physicalSectorSize)
    }

    if (($alignedBytes % $physicalSectorSize) -ne 0) {
      $alignedBytes = [uint32]([Math]::Ceiling($alignedBytes / $physicalSectorSize) * $physicalSectorSize)
    }
  }

  # Detailed log: [RAW_IO_READ_BEGIN]
  Write-RawIoReadBegin -logicalSectorSize $logicalSectorSize -physicalSectorSize $physicalSectorSize -offset $offset -alignedBytes $alignedBytes -bytesRequested $bytesRequested

  if ($handleValid -and $connected -and $bytesRequested -gt 0) {
    $buffer = [DWRawDisk]::VirtualAlloc([IntPtr]::Zero, ([UIntPtr]::new([uint64]$alignedBytes)), 0x3000, 0x04)
    if ($buffer -eq [IntPtr]::Zero) {
      $win32Error = Get-Win32Error
      $hresult = -2147024882 # E_OUTOFMEMORY
      Write-RawIoReadFail -offset $alignedOffset -bytes $alignedBytes -err $win32Error -hr $hresult -logicalSectorSize $logicalSectorSize -physicalSectorSize $physicalSectorSize
    } else {
      # Before EVERY unbuffered read validate alignment constraints
      $validationPassed = $true
      if ($noBuffering) {
        $offsetValid = ($alignedOffset % $physicalSectorSize) -eq 0
        $sizeValid = ($alignedBytes % $physicalSectorSize) -eq 0
        $bufferValid = ($buffer -ne [IntPtr]::Zero) -and (($buffer.ToInt64() % $physicalSectorSize) -eq 0)

        if (-not ($offsetValid -and $sizeValid -and $bufferValid)) {
          $validationPassed = $false
          $win32Error = 87 # ERROR_INVALID_PARAMETER
          $hresult = -2147024809
          $fallbackReason = "Alignment validation failed: offsetValid=$offsetValid, sizeValid=$sizeValid, bufferValid=$bufferValid"
          Write-RawIoReadFail -offset $alignedOffset -bytes $alignedBytes -err $win32Error -hr $hresult -logicalSectorSize $logicalSectorSize -physicalSectorSize $physicalSectorSize
        }
      }

      if ($validationPassed) {
        # Perform robust, exception-wrapped C# direct read
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $res = [DWRawDisk]::ReadDiskDirect($handle, $alignedOffset, $buffer, $alignedBytes)
        $sw.Stop()
        $readLatency = $sw.Elapsed.TotalMilliseconds
        $readSuccess = $res.Success
        $bytesRead = $res.BytesRead
        $win32Error = $res.Win32Error
        $hresult = $res.HResult

        if ($readSuccess) {
          Write-RawIoReadSuccess -offset $alignedOffset -bytesRead $bytesRead -logicalSectorSize $logicalSectorSize -physicalSectorSize $physicalSectorSize
        } else {
          Write-RawIoReadFail -offset $res.FailingOffset -bytes $res.FailingBytes -err $res.Win32Error -hr $res.HResult -logicalSectorSize $logicalSectorSize -physicalSectorSize $physicalSectorSize
          $fallbackReason = "Direct unbuffered read failed (Win32 Error $win32Error)"
        }
      }

      # Self-Healing Fallback Activation
      if (($readSuccess -eq $false -or -not $validationPassed) -and $noBuffering -eq $true) {
        $fallbackReason = if ($fallbackReason) { $fallbackReason } else { "Direct unbuffered read failed (Win32 Error $win32Error)" }
        [void][DWRawDisk]::CloseHandle($handle)
        $noBuffering = $false
        $flags = $FILE_FLAG_SEQUENTIAL_SCAN
        $handle = [DWRawDisk]::CreateFile($devicePath, $GENERIC_READ, $FILE_SHARE_ALL, [IntPtr]::Zero, $OPEN_EXISTING, $flags, [IntPtr]::Zero)
        $handleValid = Test-Handle $handle

        Write-RawIoFallback -reason $fallbackReason -err $win32Error -logicalSectorSize $logicalSectorSize -physicalSectorSize $physicalSectorSize -offset $alignedOffset -alignedBytes $alignedBytes

        if ($handleValid) {
          # Retry using safe buffered raw I/O
          $sw = [System.Diagnostics.Stopwatch]::StartNew()
          $res = [DWRawDisk]::ReadDiskDirect($handle, $alignedOffset, $buffer, $alignedBytes)
          $sw.Stop()

          $readLatency = $sw.Elapsed.TotalMilliseconds
          $readSuccess = $res.Success
          $bytesRead = $res.BytesRead
          $win32Error = $res.Win32Error
          $hresult = $res.HResult

          if ($readSuccess) {
            Write-RawIoRecovered -offset $alignedOffset -bytesRead $bytesRead -logicalSectorSize $logicalSectorSize -physicalSectorSize $physicalSectorSize
            Write-RawIoReadSuccess -offset $alignedOffset -bytesRead $bytesRead -logicalSectorSize $logicalSectorSize -physicalSectorSize $physicalSectorSize
          } else {
            Write-RawIoReadFail -offset $res.FailingOffset -bytes $res.FailingBytes -err $res.Win32Error -hr $res.HResult -logicalSectorSize $logicalSectorSize -physicalSectorSize $physicalSectorSize
          }
        } else {
          $win32Error = Get-Win32Error
          $hresult = [Runtime.InteropServices.Marshal]::GetHRForLastWin32Error()
          Write-RawIoReadFail -offset $alignedOffset -bytes $alignedBytes -err $win32Error -hr $hresult -logicalSectorSize $logicalSectorSize -physicalSectorSize $physicalSectorSize
        }
      }

      [void][DWRawDisk]::VirtualFree($buffer, ([UIntPtr]::new(0)), 0x8000)
    }
  } else {
    $win32Error = Get-Win32Error
  }

  $ioAfter = Get-ProcessReadBytes
  $ioActivity = $null
  if ($null -ne $ioBefore -and $null -ne $ioAfter) {
    $ioActivity = [Math]::Max(0, [int64]$ioAfter - [int64]$ioBefore)
  } elseif ($readSuccess) {
    $ioActivity = [int64]$bytesRead
  }

  $throughput = 0.0
  if ($readLatency -gt 0 -and $bytesRead -gt 0) {
    $throughput = ([double]$bytesRead / ($readLatency / 1000.0)) / 1048576.0
  }

  Write-RawIoRead -bytesRequested $bytesRequested -bytesRead $bytesRead -success ($readSuccess.ToString()) -error $win32Error

  Write-JsonLine @{
    type = 'read'
    id = $id
    device = $devicePath
    handleValid = $handleValid
    deviceConnected = $connected
    sector = $sector
    offset = $offset
    bytesRequested = [int64]$bytesRequested
    bytesRead = [int64]$bytesRead
    readLatency = [double]$readLatency
    readSuccess = $readSuccess
    throughputMBs = [double]$throughput
    ioActivityBytes = $ioActivity
    win32Error = [int]$win32Error
    noBuffering = $noBuffering
    logicalSectorSize = [int]$logicalSectorSize
    physicalSectorSize = [int]$physicalSectorSize
    alignedReadSize = [int]$alignedBytes
    fallbackReason = $fallbackReason
  }
}

if (Test-Handle $handle) {
  [void][DWRawDisk]::CloseHandle($handle)
}
Write-RawIoExit -reason "Normal Exit" -exception "" -stack "" -workerExitCode 0
Write-JsonLine @{ type = 'closed' }
`
}

class RawDiskReaderProcess {
  private child: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private scriptPath = ''
  private readyResolve: ((ready: RawReaderReady) => void) | null = null
  private readyReject: ((err: Error) => void) | null = null
  private pendingReads = new Map<string, {
    resolve: (line: RawReaderLine) => void
    reject: (err: Error) => void
    timeout: NodeJS.Timeout
  }>()
  private sequence = 0
  public noBufferingActive = true

  constructor(
    private readonly diskIndex: number,
    private readonly devicePath: string
  ) {}

  async start(): Promise<RawReaderReady> {
    if (process.platform !== 'win32') {
      throw new Error('REAL_SCAN requires Windows raw disk APIs.')
    }

    // Note: admin check intentionally removed — the PowerShell worker tries
    // FILE_FLAG_NO_BUFFERING first and automatically falls back to buffered
    // mode if access is denied. We let it attempt and only fail if the handle
    // itself cannot be obtained at all.

    const script = buildRawReaderScript(this.diskIndex, this.devicePath)
    this.scriptPath = path.join(app.getPath('userData'), `dw_raw_reader_${Date.now()}_${Math.floor(Math['random']() * 10000)}.ps1`)
    fs.writeFileSync(this.scriptPath, script, 'utf8')

    this.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], {
      windowsHide: true
    })

    this.child.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString('utf8')
      this.parseLines()
    })

    this.child.stderr.on('data', (chunk: Buffer) => {
      const msg = chunk.toString('utf8').trim()
      if (msg) {
        console.warn(`[SurfaceScanEngine] Raw reader stderr: ${msg}`)
        logRawIo(`[SurfaceScanEngine Stderr]: ${msg}`)
      }
    })

    this.child.on('error', (err) => {
      logRawIo(`[RAW_IO_EXIT]\nreason=Process Error\nexception=${err.message}\nstack=${err.stack || ''}\nworkerExitCode=-1\n`)
      this.rejectAll(err)
    })

    this.child.on('close', (code) => {
      const exitCode = code ?? -1
      logRawIo(`[RAW_IO_EXIT]\nreason=Process Close\nexception=\nstack=\nworkerExitCode=${exitCode}\n`)
      this.rejectAll(new Error(`Raw disk reader exited with code ${exitCode}`))
    })

    return new Promise<RawReaderReady>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyResolve = null
        this.readyReject = null
        reject(new Error('Timed out opening physical device handle.'))
      }, 15000)

      this.readyResolve = (ready) => {
        this.noBufferingActive = ready.noBuffering
        clearTimeout(timer)
        resolve(ready)
      }
      this.readyReject = (err) => {
        clearTimeout(timer)
        reject(err)
      }
    })
  }

  async read(sector: number, offset: number, bytesRequested: number): Promise<RawReaderLine> {
    if (!this.child || this.child.killed) {
      throw new Error('Raw disk reader is not running.')
    }

    const id = `${Date.now()}-${this.sequence++}`
    const payload = JSON.stringify({ cmd: 'read', id, sector, offset, bytesRequested })

    return new Promise<RawReaderLine>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingReads.delete(id)
        reject(new Error('Raw disk read timed out.'))
      }, 12000)

      this.pendingReads.set(id, { resolve, reject, timeout })
      this.child!.stdin.write(`${payload}\n`)
    })
  }

  close(): void {
    try {
      this.child?.stdin.write(`${JSON.stringify({ cmd: 'close' })}\n`)
    } catch {}
    try {
      this.child?.kill()
    } catch {}
    this.child = null

    if (this.scriptPath && fs.existsSync(this.scriptPath)) {
      try {
        fs.unlinkSync(this.scriptPath)
      } catch {}
      this.scriptPath = ''
    }
  }

  private parseLines(): void {
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline !== -1) {
      const rawLine = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (rawLine) {
        const isDiagnostic = rawLine.startsWith('[RAW_IO_') ||
                             rawLine.startsWith('device=') ||
                             rawLine.startsWith('path=') ||
                             rawLine.startsWith('admin=') ||
                             rawLine.startsWith('pid=') ||
                             rawLine.startsWith('workerStarted=') ||
                             rawLine.startsWith('handleCreated=') ||
                             rawLine.startsWith('createFileError=') ||
                             rawLine.startsWith('win32Error=') ||
                             rawLine.startsWith('sectorSize=') ||
                             rawLine.startsWith('alignment=') ||
                             rawLine.startsWith('bufferSize=') ||
                             rawLine.startsWith('flags=') ||
                             rawLine.startsWith('noBuffering=') ||
                             rawLine.startsWith('overlapped=') ||
                             rawLine.startsWith('bytesRequested=') ||
                             rawLine.startsWith('bytesRead=') ||
                             rawLine.startsWith('success=') ||
                             rawLine.startsWith('error=') ||
                             rawLine.startsWith('reason=') ||
                             rawLine.startsWith('exception=') ||
                             rawLine.startsWith('stack=') ||
                             rawLine.startsWith('workerExitCode=') ||
                             rawLine.startsWith('logicalSectorSize=') ||
                             rawLine.startsWith('physicalSectorSize=') ||
                             rawLine.startsWith('currentOffset=') ||
                             rawLine.startsWith('alignedReadSize=') ||
                             rawLine.startsWith('fallbackActivationReason=') ||
                             rawLine.startsWith('failingOffset=') ||
                             rawLine.startsWith('failingBytes=') ||
                             rawLine.startsWith('hresult=') ||
                             rawLine.startsWith('fallbackReason=')

        if (isDiagnostic) {
          logRawIo(rawLine)
        } else {
          this.handleLine(rawLine)
        }
      }
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    let msg: RawReaderMessage
    try {
      msg = JSON.parse(line)
    } catch {
      console.warn(`[SurfaceScanEngine] Ignoring non-JSON raw reader output: ${line}`)
      return
    }

    if (msg.type === 'ready') {
      this.readyResolve?.(msg)
      this.readyResolve = null
      this.readyReject = null
      return
    }

    if (msg.type === 'read') {
      const pending = this.pendingReads.get(msg.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pendingReads.delete(msg.id)
      this.noBufferingActive = msg.noBuffering === true
      pending.resolve(msg)
      return
    }

    if (msg.type === 'error' && msg.id) {
      const pending = this.pendingReads.get(msg.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pendingReads.delete(msg.id)
      pending.reject(new Error(msg.error))
      return
    }
  }

  private rejectAll(err: Error): void {
    this.readyReject?.(err)
    this.readyResolve = null
    this.readyReject = null

    for (const [, pending] of this.pendingReads) {
      clearTimeout(pending.timeout)
      pending.reject(err)
    }
    this.pendingReads.clear()
  }
}

class SurfaceScanSession extends EventEmitter {
  private cancelledFlag = false
  private paused = false
  private rawReader: RawDiskReaderProcess | null = null

  public readonly devicePath: string

  constructor(
    public readonly diskIndex: number,
    public readonly mode: ScanMode,
    public readonly executionMode: ScanExecutionMode,
    public readonly model = '',
    public readonly serial = '',
    devicePath = '',
    public readonly driveType = ''
  ) {
    super()
    this.devicePath = normalizeDevicePath(devicePath || `\\\\.\\PhysicalDrive${diskIndex}`)
  }

  pause(): void { this.paused = true }
  resume(): void { this.paused = false }
  cancel(): void {
    this.cancelledFlag = true
    this.paused = false
    this.rawReader?.close()
  }
  get cancelled(): boolean { return this.cancelledFlag }

  private async waitIfPaused(): Promise<boolean> {
    while (this.paused && !this.cancelledFlag) await sleep(200)
    return this.cancelledFlag
  }

  async run(smart: any | null): Promise<ScanResult> {
    const start = Date.now()
    let errorCount = 0
    let slowCount = 0
    let weakCount = 0
    let chunksDone = 0
    let actualBytesRead = 0
    let lastTelemetry: RealIoTelemetry | null = null
    let totalChunks = 0
    let sizeLba = 0
    const weakSectorsList: { lba: number; status: 2 | 3; readTimeMs: number }[] = []

    const executionMode = this.executionMode
    const isSimulation = executionMode === 'SIMULATION_MODE'

    let healthPct: number | null = null
    if (smart?.available && !smart.unsupported && (smart.attributes?.length ?? 0) > 0) {
      const isSsd = this.driveType === 'SSD'
      if (isSsd) {
        const wearAttr = smart.attributes.find((a: any) => [177, 173, 202, 231, 233].includes(a.id))
        if (wearAttr) {
          healthPct = clamp(Number(wearAttr.value), 0, 100)
        } else {
          healthPct = 100
        }
      } else {
        // HDD Health calculation
        let health = 100
        const reallocated = smart.attributes.find((a: any) => a.id === 5)
        if (reallocated) health -= Math.min(Number(reallocated.raw) * 2, 30)
        
        const pending = smart.attributes.find((a: any) => a.id === 197)
        if (pending && Number(pending.raw) > 0) health -= Math.min(Number(pending.raw) * 5, 50)
        
        const uncorrectable = smart.attributes.find((a: any) => a.id === 198)
        if (uncorrectable && Number(uncorrectable.raw) > 0) health -= Math.min(Number(uncorrectable.raw) * 10, 60)
        
        healthPct = clamp(health, 0, 100)
      }
    }
    const temperature: number | null = smart?.temperature ?? null

    if (this.mode === 'smart') {
      const progress: ScanProgress = {
        percent: 100,
        currentLba: 0,
        totalLbas: 0,
        readSpeedMBs: 0,
        etaSec: 0,
        errorCount: 0,
        slowCount: 0,
        blocks: [],
        totalBlocks: 0,
        temperature,
        healthPct,
        executionMode: 'REAL_SCAN',
        realIo: false,
        actualBytesRead: 0,
        lastReadBytes: 0,
        lastReadLatencyMs: 0,
        ioTelemetry: null,
        realIoStatus: null
      }
      this.emit('progress', progress)
      const result: ScanResult = {
        success: true,
        cancelled: false,
        errorCount: 0,
        slowCount: 0,
        totalChunks: 0,
        durationSec: (Date.now() - start) / 1000,
        executionMode: 'REAL_SCAN',
        realIo: false,
        actualBytesRead: 0
      }
      this.emit('done', result)
      return result
    }

    let realIoStatus: 'DIRECT_IO' | 'BUFFERED_FALLBACK' | 'READING' | 'FAILED' | 'DISCONNECTED' | null = null

    if (!isSimulation) {
      // Admin check removed: the PowerShell worker self-heals from
      // NO_BUFFERING access-denied by falling back to buffered raw I/O.
      this.rawReader = new RawDiskReaderProcess(this.diskIndex, this.devicePath)
      const ready = await this.rawReader.start()
      if (!ready.handleValid) {
        realIoStatus = 'FAILED'
        throw new Error(`REAL_SCAN failed: ${ready.error ?? 'could not open physical device'} for ${this.devicePath} (Win32 ${ready.win32Error ?? 'unknown'}). Run DriveWatch as Administrator.`)
      }
      if (!ready.deviceConnected) {
        realIoStatus = 'DISCONNECTED'
        throw new Error(DISCONNECT_MESSAGE)
      }
      if (!ready.sizeLba || ready.sizeLba <= 0) {
        realIoStatus = 'FAILED'
        throw new Error('REAL_SCAN failed: physical device geometry could not be validated.')
      }
      sizeLba = ready.sizeLba
      realIoStatus = ready.noBuffering ? 'DIRECT_IO' : 'BUFFERED_FALLBACK'
      console.log(`[SurfaceScanEngine] REAL_SCAN opened persistent handle: device=${ready.device} sizeLba=${ready.sizeLba} noBuffering=${ready.noBuffering}`)
    } else {
      sizeLba = 937697985
      console.warn('[SurfaceScanEngine] SIMULATION_MODE requested explicitly. No physical IO will be performed and results are excluded from scoring.')
    }

    totalChunks = Math.ceil(sizeLba / SECTORS_PER_CHUNK)
    const targetSamples = Math.max(1, Math.ceil(totalChunks * 0.01))
    const step = this.mode === 'quick' ? Math.max(1, Math.floor(totalChunks / targetSamples)) : 1
    const sampledChunks = this.mode === 'quick' ? Math.ceil(totalChunks / step) : totalChunks
    const blockMap = createBlockMap(totalChunks)

    const emitProgress = (percent: number, currentLba: number, lastReadBytes: number, lastReadLatencyMs: number) => {
      const elapsedSec = Math.max(0.001, (Date.now() - start) / 1000)
      const readSpeedMBs = executionMode === 'REAL_SCAN'
        ? actualBytesRead / elapsedSec / 1_048_576
        : 0
      const remainingBytes = Math.max(0, (sampledChunks - chunksDone) * READ_BYTES)
      const etaSec = readSpeedMBs > 0 && percent < 100
        ? remainingBytes / (readSpeedMBs * 1_048_576)
        : 0

      this.emit('progress', {
        percent: clamp(Math.round(percent), 0, 100),
        currentLba,
        totalLbas: sizeLba,
        readSpeedMBs: Math.round(readSpeedMBs * 10) / 10,
        etaSec: Math.round(etaSec),
        errorCount,
        slowCount,
        blocks: [...blockMap],
        totalBlocks: blockMap.length,
        temperature,
        healthPct,
        executionMode,
        realIo: executionMode === 'REAL_SCAN',
        actualBytesRead,
        lastReadBytes,
        lastReadLatencyMs,
        ioTelemetry: lastTelemetry,
        realIoStatus
      } as ScanProgress)
    }

    emitProgress(0, 0, 0, 0)

    let repeatedOffsetCount = 0
    let lastOffset: number | null = null
    let noIoIterations = 0
    let consecutiveFailures = 0

    try {
      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx += step) {
        if (this.cancelledFlag) break
        if (await this.waitIfPaused()) break

        const lba = chunkIdx * SECTORS_PER_CHUNK
        const remainingSectors = sizeLba - lba
        if (remainingSectors <= 0) break

        const sectorsThisRead = Math.min(SECTORS_PER_CHUNK, remainingSectors)
        const bytesRequested = sectorsThisRead * SECTOR_SIZE
        const offset = lba * SECTOR_SIZE

        let readSuccess = false
        let readLatency = 0
        let bytesRead = 0
        let status: BlockStatus = 0

        if (isSimulation) {
          await sleep(this.mode === 'quick' ? 2 : 1)
          readSuccess = true
          readLatency = 0
          bytesRead = 0
          status = 1
        } else {
          realIoStatus = 'READING'
          let raw: RawReaderLine
          try {
            raw = await this.rawReader!.read(lba, offset, bytesRequested)
          } catch (err) {
            if (this.cancelledFlag) break
            realIoStatus = 'FAILED'
            emitProgress((chunksDone / sampledChunks) * 100, lba, bytesRead, readLatency)
            throw err
          }
          if (this.cancelledFlag) break

          lastTelemetry = {
            device: raw.device,
            handleValid: raw.handleValid,
            deviceConnected: raw.deviceConnected,
            sector: Number(raw.sector),
            offset: Number(raw.offset),
            bytesRequested: Number(raw.bytesRequested),
            bytesRead: Number(raw.bytesRead),
            readLatency: Number(raw.readLatency),
            readSuccess: raw.readSuccess === true,
            throughputMBs: Number(raw.throughputMBs),
            ioActivityBytes: raw.ioActivityBytes === null || raw.ioActivityBytes === undefined ? null : Number(raw.ioActivityBytes),
            win32Error: Number(raw.win32Error) || 0,
            noBuffering: raw.noBuffering === true
          }
          console.log(formatRealIoLog(lastTelemetry))

          if (isDisconnectTelemetry(lastTelemetry)) {
            realIoStatus = 'DISCONNECTED'
            emitProgress((chunksDone / sampledChunks) * 100, lba, bytesRead, readLatency)
            throw new Error(DISCONNECT_MESSAGE)
          }

          if (!lastTelemetry.noBuffering) {
            realIoStatus = 'BUFFERED_FALLBACK'
            if (this.rawReader) {
              this.rawReader.noBufferingActive = false
            }
          } else {
            realIoStatus = 'DIRECT_IO'
          }

          readSuccess = lastTelemetry.readSuccess
          readLatency = lastTelemetry.readLatency
          bytesRead = lastTelemetry.bytesRead

          if (lastOffset !== null && lastTelemetry.offset === lastOffset) repeatedOffsetCount++
          else repeatedOffsetCount = 0
          lastOffset = lastTelemetry.offset
          if (repeatedOffsetCount >= 3) {
            realIoStatus = 'FAILED'
            emitProgress((chunksDone / sampledChunks) * 100, lba, bytesRead, readLatency)
            throw new Error(INTEGRITY_FAILURE_MESSAGE)
          }

          const ioActivity = lastTelemetry.ioActivityBytes ?? bytesRead
          if (ioActivity <= 0) noIoIterations++
          else noIoIterations = 0
          if (noIoIterations > 3) {
            realIoStatus = 'FAILED'
            emitProgress((chunksDone / sampledChunks) * 100, lba, bytesRead, readLatency)
            throw new Error(INTEGRITY_FAILURE_MESSAGE)
          }

          actualBytesRead += bytesRead
        }

        if (!readSuccess || bytesRead <= 0 || readLatency >= UNREADABLE_THRESHOLD_MS) {
          if (!isSimulation) {
            consecutiveFailures++
          }
          status = 3
          errorCount++
          weakSectorsList.push({ lba, status: 3, readTimeMs: readLatency })

          if (!isSimulation && consecutiveFailures > 5) {
            realIoStatus = 'FAILED'
            emitProgress((chunksDone / sampledChunks) * 100, lba, bytesRead, readLatency)
            throw new Error(`REAL_SCAN aborted: exceeded 5 consecutive read failures. Last failure at LBA ${lba}.`)
          }
        } else {
          if (!isSimulation) {
            consecutiveFailures = 0
          }
          if (readLatency >= HEALTHY_THRESHOLD_MS) {
            status = 2
            slowCount++
            if (readLatency >= WEAK_THRESHOLD_MS) {
              weakCount++
              weakSectorsList.push({ lba, status: 2, readTimeMs: readLatency })
            }
          } else {
            status = 1
          }
        }

        setBlockStatus(blockMap, chunkIdx, totalChunks, status)
        chunksDone++

        if (chunksDone % PROGRESS_BATCH === 0 || chunkIdx + step >= totalChunks) {
          emitProgress((chunksDone / sampledChunks) * 100, lba, bytesRead, readLatency)
        }

        if (temperature !== null && temperature > 65) {
          throw new Error(`Critical temperature: ${temperature}C. Scan stopped.`)
        }
      }
    } finally {
      this.rawReader?.close()
      this.rawReader = null
    }

    const result: ScanResult = {
      success: !this.cancelledFlag,
      cancelled: this.cancelledFlag,
      errorCount,
      slowCount,
      totalChunks: chunksDone,
      durationSec: (Date.now() - start) / 1000,
      executionMode,
      realIo: executionMode === 'REAL_SCAN',
      actualBytesRead
    }

    saveScanResult({
      diskIndex: this.diskIndex,
      model: this.model || undefined,
      serial: this.serial || undefined,
      devicePath: this.devicePath || undefined,
      timestamp: Date.now(),
      totalLbas: sizeLba,
      totalChunks,
      slowCount: executionMode === 'REAL_SCAN' ? weakCount : 0,
      slowCountDisplay: executionMode === 'REAL_SCAN' ? slowCount : 0,
      errorCount: executionMode === 'REAL_SCAN' ? errorCount : 0,
      durationSec: result.durationSec,
      weakSectors: executionMode === 'REAL_SCAN' ? weakSectorsList : [],
      blocks: [...blockMap],
      totalBlocks: blockMap.length,
      scanMode: this.mode,
      isSimulated: executionMode === 'SIMULATION_MODE',
      executionMode,
      actualBytesRead
    })

    console.log(`[SurfaceScanEngine] Saved ${executionMode} result: diskIndex=${this.diskIndex} chunks=${chunksDone} actualBytesRead=${actualBytesRead} weak=${weakCount} errors=${errorCount}`)

    this.emit('done', result)
    return result
  }
}

export interface SurfaceScanCallbacks {
  onProgress: (p: ScanProgress) => void
  onDone: (r: ScanResult) => void
  onError: (msg: string) => void
}

export async function startSurfaceScan(
  diskIndex: number,
  mode: ScanMode,
  callbacks: SurfaceScanCallbacks,
  model = '',
  serial = '',
  devicePath = '',
  executionMode: ScanExecutionMode = 'REAL_SCAN'
): Promise<void> {
  const existing = activeScans.get(diskIndex)
  if (existing) {
    existing.cancel()
    activeScans.delete(diskIndex)
    await sleep(300)
  }

  clearScanResult(diskIndex, serial, model, devicePath)

  console.log(`[SurfaceScanEngine] Starting ${mode} scan: diskIndex=${diskIndex} executionMode=${executionMode} model="${model}" serial="${serial}" device="${devicePath || `\\\\.\\PhysicalDrive${diskIndex}`}"`)
  console.log(`[SurfaceScanEngine] Thresholds: Green<${HEALTHY_THRESHOLD_MS}ms Yellow>=${HEALTHY_THRESHOLD_MS}ms Weak>=${WEAK_THRESHOLD_MS}ms Red>=${UNREADABLE_THRESHOLD_MS}ms`)

  const session = new SurfaceScanSession(diskIndex, mode, executionMode, model, serial, devicePath)
  activeScans.set(diskIndex, session)

  session.on('progress', callbacks.onProgress)
  session.on('done', (r: ScanResult) => {
    activeScans.delete(diskIndex)
    callbacks.onDone(r)
  })

  const smart = await runSmartScan(diskIndex).catch(() => null)

  session.run(smart).catch((err) => {
    activeScans.delete(diskIndex)
    const msg = err?.message ?? 'Unknown scan error'
    console.error(`[SurfaceScanEngine] ${msg}`)
    callbacks.onError(msg)
  })
}

export function pauseSurfaceScan(diskIndex: number): void {
  activeScans.get(diskIndex)?.pause()
}

export function resumeSurfaceScan(diskIndex: number): void {
  activeScans.get(diskIndex)?.resume()
}

export function stopSurfaceScan(diskIndex: number): void {
  const scan = activeScans.get(diskIndex)
  if (scan) {
    scan.cancel()
    activeScans.delete(diskIndex)
  }
}

export function isSurfaceScanActive(diskIndex: number): boolean {
  return activeScans.has(diskIndex)
}
