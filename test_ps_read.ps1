$ErrorActionPreference = 'Stop'
try {
  if (-not ([System.Management.Automation.PSTypeName]'DRWReader').Type) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DRWReader {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Auto)]
  public static extern IntPtr CreateFile(string lpFileName, uint dwAccess, uint dwShare, IntPtr sec, uint dwCreate, uint dwFlags, IntPtr hTemplate);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool ReadFile(IntPtr hFile, byte[] buf, uint nRead, ref uint read, IntPtr ovr);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")]
  public static extern bool SetFilePointerEx(IntPtr hFile, long dist, IntPtr newPos, uint method);
}
'@
  }
} catch { Write-Host $_ }
try {
  $path = "\\.\PhysicalDrive1"
  $h = [DRWReader]::CreateFile($path,[uint32]0x80000000L,3,[IntPtr]::Zero,3,0,[IntPtr]::Zero)
  if ($h -eq [IntPtr](-1) -or $h -eq [IntPtr]::Zero) {
    Write-Output '{"ok":false,"ms":0,"retries":0,"err":"access_denied"}'
    exit
  }
  $offset = [long]0 * 512L
  [void][DRWReader]::SetFilePointerEx($h, $offset, [IntPtr]::Zero, 0)
  $buf = New-Object byte[] (64 * 512)
  $read = [uint32]0
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $ok = [DRWReader]::ReadFile($h, $buf, [uint32]$buf.Length, [ref]$read, [IntPtr]::Zero)
  $sw.Stop()
  [void][DRWReader]::CloseHandle($h)
  Write-Output "{`"ok`":$($ok.ToString().ToLower()),`"ms`":$($sw.ElapsedMilliseconds),`"retries`":0,`"read`":$read}"
} catch {
  Write-Output "{`"ok`":false,`"ms`":0,`"retries`":0,`"err`":`"exception`"}"
  Write-Host $_
}
