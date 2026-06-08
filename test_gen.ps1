
$ErrorActionPreference = 'Stop'
$devicePath = '\\.\PhysicalDrive0'
$diskIndex = 0

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
      bool seekOk = SetFilePointerEx(handle, offset, out newFilePointer, 0);
      if (!seekOk || newFilePointer != offset) {
        res.Win32Error = (uint)Marshal.GetLastWin32Error();
        res.HResult = Marshal.GetHRForLastWin32Error();
        return res;
      }

      uint read = 0;
      bool ok = ReadFile(handle, buffer, bytesToRead, out read, IntPtr.Zero);
      res.BytesRead = read;
      if (ok && read > 0) {
        res.Success = true;
      } else {
        res.Win32Error = (uint)Marshal.GetLastWin32Error();
        res.HResult = Marshal.GetHRForLastWin32Error();
      }
    } catch (Exception ex) {
      res.Win32Error = 13; // ERROR_INVALID_DATA
      res.HResult = ex.HResult;
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
  $outBuffer = [DWRawDisk]::VirtualAlloc([IntPtr]::Zero, [UIntPtr]8, 0x3000, 0x04)
  if ($outBuffer -eq [IntPtr]::Zero) { return 0 }

  $bytesReturned = [uint32]0
  $ok = [DWRawDisk]::DeviceIoControl($handle, 0x0007405C, [IntPtr]::Zero, 0, $outBuffer, 8, [ref]$bytesReturned, [IntPtr]::Zero)
  $length = 0L
  if ($ok -and $bytesReturned -ge 8) {
    $length = [Runtime.InteropServices.Marshal]::ReadInt64($outBuffer)
  }
  [void][DWRawDisk]::VirtualFree($outBuffer, [UIntPtr]0, 0x8000)
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
      if ($diskObj.SectorSize) {
        $logicalSectorSize = $diskObj.SectorSize
      }
      if ($diskObj.PhysicalSectorSize) {
        $physicalSectorSize = $diskObj.PhysicalSectorSize
      }
    }
  } else {
    if ($devicePath -match '([A-Za-z]):') {
      $driveLetter = $Matches[1]
      $vol = Get-Volume -DriveLetter $driveLetter -ErrorAction SilentlyContinue
      if ($vol -and $vol.SectorSize) {
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
  [Console]::Out.WriteLine("[RAW_IO_FALLBACK]")
  [Console]::Out.WriteLine("fallbackActivationReason=" + $createFileError)
  [Console]::Out.WriteLine("win32Error=" + $win32Err)
  [Console]::Out.WriteLine("")
  [Console]::Out.Flush()

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

Write-RawIoStart -device $devicePath -path $devicePath -admin ($admin.ToString()) -pid $workerPid -workerStarted "True" -handleCreated ($handleCreated.ToString()) -createFileError $createFileError -win32Err $win32Err

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

  # Detailed log: [RAW_IO_READ_BEGIN]
  [Console]::Out.WriteLine("[RAW_IO_READ_BEGIN]")
  [Console]::Out.WriteLine("logicalSectorSize=" + $logicalSectorSize)
  [Console]::Out.WriteLine("physicalSectorSize=" + $physicalSectorSize)
  [Console]::Out.WriteLine("currentOffset=" + $offset)
  [Console]::Out.WriteLine("alignedReadSize=" + $bytesRequested)
  [Console]::Out.WriteLine("bytesRequested=" + $bytesRequested)
  [Console]::Out.WriteLine("")
  [Console]::Out.Flush()

  if ($handleValid -and $connected -and $bytesRequested -gt 0) {
    # Sector size alignment validation based on physicalSectorSize (for NO_BUFFERING AF drive compatibility)
    $alignedOffset = $offset
    $alignedBytes = $bytesRequested

    if (($offset % $physicalSectorSize) -ne 0) {
      $alignedOffset = [Math]::Floor($offset / $physicalSectorSize) * $physicalSectorSize
      $diff = $offset - $alignedOffset
      $alignedBytes = [uint32]([Math]::Ceiling(($bytesRequested + $diff) / $physicalSectorSize) * $physicalSectorSize)
    }

    if (($alignedBytes % $physicalSectorSize) -ne 0) {
      $alignedBytes = [uint32]([Math]::Ceiling($alignedBytes / $physicalSectorSize) * $physicalSectorSize)
    }

    $buffer = [DWRawDisk]::VirtualAlloc([IntPtr]::Zero, [UIntPtr]$alignedBytes, 0x3000, 0x04)
    if ($buffer -eq [IntPtr]::Zero) {
      $win32Error = Get-Win32Error
      $hresult = -2147024882 # E_OUTOFMEMORY
      
      [Console]::Out.WriteLine("[RAW_IO_READ_FAIL]")
      [Console]::Out.WriteLine("failingOffset=" + $alignedOffset)
      [Console]::Out.WriteLine("failingBytes=" + $alignedBytes)
      [Console]::Out.WriteLine("win32Error=" + $win32Error)
      [Console]::Out.WriteLine("hresult=" + $hresult)
      [Console]::Out.WriteLine("")
      [Console]::Out.Flush()
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

          [Console]::Out.WriteLine("[RAW_IO_READ_FAIL]")
          [Console]::Out.WriteLine("failingOffset=" + $alignedOffset)
          [Console]::Out.WriteLine("failingBytes=" + $alignedBytes)
          [Console]::Out.WriteLine("win32Error=" + $win32Error)
          [Console]::Out.WriteLine("hresult=" + $hresult)
          [Console]::Out.WriteLine("")
          [Console]::Out.Flush()
        }
      }

      if ($validationPassed) {
        # Perform robust, exception-wrapped C# direct read
        $res = [DWRawDisk]::ReadDiskDirect($handle, $alignedOffset, $buffer, $alignedBytes)
        $readSuccess = $res.Success
        $bytesRead = $res.BytesRead
        $win32Error = $res.Win32Error
        $hresult = $res.HResult

        if ($readSuccess) {
          [Console]::Out.WriteLine("[RAW_IO_READ_SUCCESS]")
          [Console]::Out.WriteLine("currentOffset=" + $alignedOffset)
          [Console]::Out.WriteLine("bytesRead=" + $bytesRead)
          [Console]::Out.WriteLine("")
          [Console]::Out.Flush()
        } else {
          [Console]::Out.WriteLine("[RAW_IO_READ_FAIL]")
          [Console]::Out.WriteLine("failingOffset=" + $res.FailingOffset)
          [Console]::Out.WriteLine("failingBytes=" + $res.FailingBytes)
          [Console]::Out.WriteLine("win32Error=" + $res.Win32Error)
          [Console]::Out.WriteLine("hresult=" + $res.HResult)
          [Console]::Out.WriteLine("")
          [Console]::Out.Flush()
          $fallbackReason = "Direct unbuffered read failed (Win32 Error $win32Error)"
        }
      }

      # Self-Healing Fallback Activation
      if (($readSuccess -eq $false -or -not $validationPassed) -and $noBuffering -eq $true) {
        [void][DWRawDisk]::CloseHandle($handle)
        $noBuffering = $false
        $flags = $FILE_FLAG_SEQUENTIAL_SCAN
        $handle = [DWRawDisk]::CreateFile($devicePath, $GENERIC_READ, $FILE_SHARE_ALL, [IntPtr]::Zero, $OPEN_EXISTING, $flags, [IntPtr]::Zero)
        $handleValid = Test-Handle $handle

        [Console]::Out.WriteLine("[RAW_IO_FALLBACK]")
        [Console]::Out.WriteLine("fallbackActivationReason=" + $fallbackReason)
        [Console]::Out.WriteLine("win32Error=" + $win32Error)
        [Console]::Out.WriteLine("")
        [Console]::Out.Flush()

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
            [Console]::Out.WriteLine("[RAW_IO_RECOVERED]")
            [Console]::Out.WriteLine("currentOffset=" + $alignedOffset)
            [Console]::Out.WriteLine("bytesRead=" + $bytesRead)
            [Console]::Out.WriteLine("")
            [Console]::Out.Flush()

            [Console]::Out.WriteLine("[RAW_IO_READ_SUCCESS]")
            [Console]::Out.WriteLine("currentOffset=" + $alignedOffset)
            [Console]::Out.WriteLine("bytesRead=" + $bytesRead)
            [Console]::Out.WriteLine("readLatency=" + $readLatency)
            [Console]::Out.WriteLine("")
            [Console]::Out.Flush()
          } else {
            [Console]::Out.WriteLine("[RAW_IO_READ_FAIL]")
            [Console]::Out.WriteLine("failingOffset=" + $res.FailingOffset)
            [Console]::Out.WriteLine("failingBytes=" + $res.FailingBytes)
            [Console]::Out.WriteLine("win32Error=" + $res.Win32Error)
            [Console]::Out.WriteLine("hresult=" + $res.HResult)
            [Console]::Out.WriteLine("")
            [Console]::Out.Flush()
          }
        }
      }

      [void][DWRawDisk]::VirtualFree($buffer, [UIntPtr]0, 0x8000)
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
