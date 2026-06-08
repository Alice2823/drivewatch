const { PowerShellHost } = require('./temp_ps/psHost.js');
async function run() {
  const ps = PowerShellHost.getInstance('test');
  const script = `
$ErrorActionPreference = 'Stop'
try {
  if (-not ([System.Management.Automation.PSTypeName]'DRWReader').Type) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DRWReader {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Auto)]
  public static extern IntPtr CreateFile(string lpFileName, uint dwAccess, uint dwShare, IntPtr sec, uint dwCreate, uint dwFlags, IntPtr hTemplate);
}
'@
  }
} catch {
  Write-Output "ADD TYPE ERROR: $_"
}
Write-Output '{"test":1}'
`;
  const out = await ps.execute(script, 10000);
  console.log('OUT:', out);
  process.exit(0);
}
run();
