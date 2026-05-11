import { execSync } from 'child_process'
import { stopMonitoring, resumeMonitoring } from './diskService'
import { StorageScanner } from './scanner/storageScanner'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { app } from 'electron'

const logPath = path.join(app.getPath('userData'), 'drivewatch_logs.txt')
function log(msg: string): void {
  const ts = new Date().toISOString()
  try { fs.appendFileSync(logPath, `[${ts}] [DeviceEjectService] ${msg}\n`) } catch { /* */ }
  console.log(`[DeviceEjectService] ${msg}`)
}

export class DeviceEjectService {
  private static isEjecting = false

  public static async safelyEjectDrive(driveLetter: string, diskIndex: number): Promise<{ success: boolean; error?: string }> {
    if (this.isEjecting) {
      return { success: false, error: 'An eject operation is already in progress.' }
    }
    
    this.isEjecting = true
    log(`Starting hardware eject pipeline for Disk ${diskIndex} (Letter: ${driveLetter})`)

    try {
      // 1. Stop all active monitoring processes
      log(`Stopping internal monitoring and releasing handles...`)
      stopMonitoring()

      // Allow OS to settle after stopping monitors
      await new Promise(r => setTimeout(r, 1000))

      if (process.platform === 'darwin') {
        // macOS Eject Logic
        log(`Executing macOS diskutil eject sequence...`)
        try {
          // diskIndex on macOS usually maps to /dev/diskN
          execSync(`diskutil eject disk${diskIndex}`)
          log(`Hardware eject successful via diskutil.`)
          setTimeout(resumeMonitoring, 3000)
          return { success: true }
        } catch (err: any) {
          log(`diskutil eject failed: ${err.message}`)
          resumeMonitoring()
          return { success: false, error: err.message }
        }
      }

      // 2. Perform PowerShell Native Eject (Windows)
      log(`Executing native PowerShell eject sequence...`)
      
      const script = `
$ErrorActionPreference = "Stop"
$idx = ${diskIndex}

try {
    # Step 1: Identify disk
    $disk = Get-Disk -Number $idx -ErrorAction SilentlyContinue
    if (-not $disk) { Write-Output "Success: Disk already removed"; exit 0 }
    
    if ($disk.BusType -notmatch "USB|SD|MMC") {
        Write-Output "Error: Cannot safely eject an internal drive"
        exit 1
    }

    $wmiDisk = Get-WmiObject Win32_DiskDrive | Where-Object { $_.Index -eq $idx }
    if (-not $wmiDisk) { Write-Output "Error: Cannot find WMI Disk"; exit 1 }

    # Step 2: C# Native Eject via CM_Request_Device_EjectW
    $csharp = @"
using System;
using System.Runtime.InteropServices;

public class UsbEjector {
    [DllImport("setupapi.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int CM_Locate_DevNode(out uint pdnDevInst, string pDeviceID, int ulFlags);
    
    [DllImport("setupapi.dll", SetLastError = true)]
    public static extern int CM_Get_Parent(out uint pdnDevInst, uint dnDevInst, int ulFlags);
    
    [DllImport("setupapi.dll", SetLastError = true)]
    public static extern int CM_Request_Device_EjectW(uint dnDevInst, out int pVetoType, IntPtr pszVetoName, int ulNameLength, int ulFlags);
    
    public static string Eject(string deviceId) {
        uint devInst;
        int ret = CM_Locate_DevNode(out devInst, deviceId, 0);
        if (ret != 0) return "Locate failed: " + ret;
        
        int veto;
        ret = CM_Request_Device_EjectW(devInst, out veto, IntPtr.Zero, 0, 0);
        if (ret == 0) return "Success";
        
        uint parentInst;
        if (CM_Get_Parent(out parentInst, devInst, 0) == 0) {
            ret = CM_Request_Device_EjectW(parentInst, out veto, IntPtr.Zero, 0, 0);
            if (ret == 0) return "Success";
        }
        return "Eject failed. Code: " + ret;
    }
}
"@

    Add-Type -TypeDefinition $csharp -Language CSharp
    
    $res = [UsbEjector]::Eject($wmiDisk.PNPDeviceID)
    
    if ($res -eq "Success") {
        Write-Output "Success: Native API eject completed"
        exit 0
    }

    # Step 3: Fallback Forced Dismount (if locked)
    $partitions = Get-Partition -DiskNumber $idx -ErrorAction SilentlyContinue
    $vols = $partitions | Get-Volume -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter }
    
    foreach ($v in $vols) {
        $letter = "$($v.DriveLetter):"
        mountvol $letter /L | Out-Null
        Remove-PartitionAccessPath -DiskNumber $idx -PartitionNumber $v.PartitionNumber -AccessPath "$letter\\" -ErrorAction SilentlyContinue
        Dismount-Volume -DriveLetter $v.DriveLetter -Confirm:$false -Force -ErrorAction SilentlyContinue
    }

    Set-Disk -Number $idx -IsOffline $true -ErrorAction SilentlyContinue
    Write-Output "Success: Disk forced offline"
} catch {
    Write-Output "Error: $($_.Exception.Message)"
}
`

      let result = ''
      const ps1Path = path.join(os.tmpdir(), `drivewatch_eject_${Date.now()}.ps1`)
      try {
        fs.writeFileSync(ps1Path, script, 'utf8')
        result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1Path}"`, { 
          encoding: 'utf8',
          windowsHide: true 
        }).trim()
      } catch (e: any) {
        log(`PowerShell execution failed: ${e.message}`)
        if (e.stdout) result = e.stdout.toString().trim()
        if (!result) result = `Error: ${e.message}`
      } finally {
        try { fs.unlinkSync(ps1Path) } catch { /* ignore */ }
      }

      log(`Eject Result: ${result}`)

      if (result.includes('Success')) {
        log(`Hardware eject successful.`)
        // Keep monitoring stopped for a moment to prevent UI jumping
        setTimeout(resumeMonitoring, 3000)
        return { success: true }
      } else {
        log(`Hardware eject failed. Restoring monitoring.`)
        resumeMonitoring()
        return { success: false, error: result.replace('Error: ', '') }
      }

    } catch (err: any) {
      log(`Critical exception during eject: ${err.message}`)
      resumeMonitoring()
      return { success: false, error: err.message }
    } finally {
      this.isEjecting = false
    }
  }
}
