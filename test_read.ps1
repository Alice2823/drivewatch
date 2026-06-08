Continue = 'Stop'
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
} catch { Write-Host  }
try {
   = "\\.\PhysicalDrive1"
   = [DRWReader]::CreateFile(,[uint32]0x80000000L,3,[IntPtr]::Zero,3,0,[IntPtr]::Zero)
  if ( -eq [IntPtr](-1) -or  -eq [IntPtr]::Zero) {
    Write-Output '{"ok":false,"ms":0,"retries":0,"err":"access_denied"}'
    exit
  }
   = [long]0 * 512L
  [void][DRWReader]::SetFilePointerEx(, , [IntPtr]::Zero, 0)
   = New-Object byte[] (64 * 512)
   = [uint32]0
   = [System.Diagnostics.Stopwatch]::StartNew()
   = [DRWReader]::ReadFile(, , [uint32].Length, [ref], [IntPtr]::Zero)
  .Stop()
  [void][DRWReader]::CloseHandle()
  Write-Output "{\"ok\":,\"ms\":,\"retries\":0,\"read\":}"
} catch {
  Write-Output "{\"ok\":false,\"ms\":0,\"retries\":0,\"err\":\"exception\"}"
  Write-Host 
}
