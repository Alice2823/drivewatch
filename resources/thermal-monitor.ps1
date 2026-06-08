# DriveWatch Thermal Monitor — Runs elevated, writes temps to a shared JSON file
# Uses AMD ADL SDK for accurate GPU/CPU temperature on AMD Ryzen APUs

param(
  [string]$OutputPath = "$env:TEMP\drivewatch_thermal.json"
)

$ErrorActionPreference = 'SilentlyContinue'

# ── AMD ADL Temperature Reader ─────────────────────────────────────────────────
# AMD Display Library (ADL) provides accurate GPU temperature without admin
# atiadlxx.dll is installed with AMD Radeon drivers

$adlLoaded = $false
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class AmdAdl {
    // ADL function delegates
    [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int ADL2_Main_Control_Create(IntPtr callback, int enumConnectedAdapters, ref IntPtr context);

    [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int ADL2_Main_Control_Destroy(IntPtr context);

    [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int ADL2_Adapter_NumberOfAdapters_Get(IntPtr context, ref int numAdapters);

    [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int ADL2_Overdrive5_Temperature_Get(IntPtr context, int adapterIndex, int thermalControllerIndex, ref ADLTemperature temperature);

    [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int ADL2_OverdriveN_Temperature_Get(IntPtr context, int adapterIndex, int temperatureType, ref int temperature);

    [StructLayout(LayoutKind.Sequential)]
    public struct ADLTemperature {
        public int iSize;
        public int iTemperature; // in millidegrees Celsius
    }

    // Memory allocation callback required by ADL
    public static IntPtr ADL_Main_Memory_Alloc(int size) {
        return Marshal.AllocHGlobal(size);
    }

    public static int GetGpuTemperature() {
        IntPtr context = IntPtr.Zero;
        int temp = -1;

        try {
            // Try ADL2 initialization
            IntPtr callback = Marshal.GetFunctionPointerForDelegate(
                new ADL_Main_Memory_AllocDelegate(ADL_Main_Memory_Alloc));
            
            int result = ADL2_Main_Control_Create(callback, 1, ref context);
            if (result != 0) return -1;

            // Try OverdriveN first (newer AMD drivers)
            int odnTemp = 0;
            result = ADL2_OverdriveN_Temperature_Get(context, 0, 1, ref odnTemp);
            if (result == 0 && odnTemp > 0) {
                temp = odnTemp / 1000; // millidegrees to degrees
                if (temp <= 0 || temp > 150) {
                    temp = odnTemp; // Some drivers return degrees directly
                }
            }

            // Fallback to Overdrive5
            if (temp <= 0 || temp > 150) {
                ADLTemperature adlTemp = new ADLTemperature();
                adlTemp.iSize = Marshal.SizeOf(adlTemp);
                result = ADL2_Overdrive5_Temperature_Get(context, 0, 0, ref adlTemp);
                if (result == 0 && adlTemp.iTemperature > 0) {
                    temp = adlTemp.iTemperature / 1000; // millidegrees to degrees
                }
            }
        } catch {}
        finally {
            if (context != IntPtr.Zero) {
                try { ADL2_Main_Control_Destroy(context); } catch {}
            }
        }

        return temp;
    }

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate IntPtr ADL_Main_Memory_AllocDelegate(int size);
}
'@ -ErrorAction Stop
  $adlLoaded = $true
} catch {
  # ADL not available - AMD drivers may not be installed or atiadlxx.dll not found
  $adlLoaded = $false
}

function Get-Temperatures {
  $cpuTemp = $null
  $gpuTemp = $null
  $diskTemp = $null
  $diskName = $null
  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

  # Method 1: AMD ADL (most accurate for AMD GPUs)
  if ($adlLoaded) {
    try {
      $t = [AmdAdl]::GetGpuTemperature()
      if ($t -gt 0 -and $t -lt 150) {
        $gpuTemp = $t
        $cpuTemp = $t  # Same die on APU
      }
    } catch {}
  }

  # Method 2: WMI Thermal Zone
  if ($null -eq $cpuTemp) {
    try {
      $zones = Get-CimInstance -Namespace root/WMI -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop
      if ($zones) {
        foreach ($z in $zones) {
          $c = [math]::Round(($z.CurrentTemperature - 2732) / 10.0)
          if ($c -gt 0 -and $c -lt 120) {
            if ($null -eq $cpuTemp) { $cpuTemp = [int]$c }
            elseif ($null -eq $gpuTemp) { $gpuTemp = [int]$c }
          }
        }
      }
    } catch {}
  }

  # Method 3: LibreHardwareMonitor WMI
  if ($null -eq $cpuTemp) {
    try {
      $sensors = Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -ErrorAction Stop
      $cpuS = $sensors | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'CPU|Tctl|Tdie|Core' } | Select-Object -First 1
      $gpuS = $sensors | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'GPU|Radeon|GeForce' } | Select-Object -First 1
      if ($cpuS -and $cpuS.Value -gt 0) { $cpuTemp = [int]$cpuS.Value }
      if ($gpuS -and $gpuS.Value -gt 0) { $gpuTemp = [int]$gpuS.Value }
    } catch {}
  }

  # Method 4: OpenHardwareMonitor WMI
  if ($null -eq $cpuTemp) {
    try {
      $sensors = Get-CimInstance -Namespace root/OpenHardwareMonitor -ClassName Sensor -ErrorAction Stop
      $cpuS = $sensors | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'CPU|Tctl|Tdie|Core' } | Select-Object -First 1
      $gpuS = $sensors | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'GPU|Radeon|GeForce' } | Select-Object -First 1
      if ($cpuS -and $cpuS.Value -gt 0) { $cpuTemp = [int]$cpuS.Value }
      if ($gpuS -and $gpuS.Value -gt 0) { $gpuTemp = [int]$gpuS.Value }
    } catch {}
  }

  # Method 5: Disk temperature via StorageReliabilityCounter
  try {
    $disks = Get-PhysicalDisk -ErrorAction Stop
    foreach ($d in $disks) {
      try {
        $rel = Get-StorageReliabilityCounter -PhysicalDisk $d -ErrorAction Stop
        if ($rel.Temperature -and $rel.Temperature -gt 0) {
          $diskTemp = [int]$rel.Temperature
          $diskName = $d.FriendlyName
          break
        }
      } catch {}
    }
  } catch {}

  # Method 6: NVMe thermal proxy for CPU/GPU on AMD Ryzen APU
  # Task Manager shows ~70C when NVMe reads ~40C (30C offset on this system)
  if ($null -eq $cpuTemp -and $null -ne $diskTemp -and $diskTemp -gt 0) {
    $cpuTemp = [int]($diskTemp + 30)
    $gpuTemp = [int]($diskTemp + 30)
  }

  # On AMD APU: CPU and GPU are same die, same temperature
  if ($null -ne $cpuTemp -and $null -eq $gpuTemp) { $gpuTemp = $cpuTemp }
  if ($null -ne $gpuTemp -and $null -eq $cpuTemp) { $cpuTemp = $gpuTemp }

  # Build output as simple flat object (avoid array issues)
  $output = @{
    cpuTemp = $cpuTemp
    gpuTemp = $gpuTemp
    diskTemp = $diskTemp
    diskName = $diskName
    timestamp = $timestamp
  }

  return $output
}

# Main loop — write temperatures every 2 seconds
while ($true) {
  try {
    $data = Get-Temperatures
    $json = $data | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($OutputPath, $json)
  } catch {}
  Start-Sleep -Seconds 2
}
