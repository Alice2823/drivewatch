$results = @{}

# 1. Check CIMV2 Perf Counters
try {
    $cimv2 = Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction SilentlyContinue
    $results["CIMV2_ThermalZone"] = if ($cimv2) { $cimv2 | ForEach-Object { $_.Temperature } } else { "Not found" }
} catch { $results["CIMV2_ThermalZone"] = "Error: $($_.Exception.Message)" }

# 2. Check for ANY MSAcpi classes in root/wmi
try {
    $classes = Get-CimClass -Namespace root/wmi -ClassName *Thermal* -ErrorAction SilentlyContinue
    $results["WMI_Thermal_Classes"] = if ($classes) { $classes.ClassName } else { "None found" }
} catch { $results["WMI_Thermal_Classes"] = "Error: $($_.Exception.Message)" }

# 3. Check for NVIDIA-SMI
try {
    $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    $results["NVIDIA_SMI_Available"] = if ($smi) { "Yes" } else { "No" }
} catch { $results["NVIDIA_SMI_Available"] = "Error" }

# 4. Check for AMD ADL (Generic check)
try {
    $amd = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "AMD|Radeon" }
    $results["AMD_GPU_Detected"] = if ($amd) { $amd.Name } else { "No" }
} catch { $results["AMD_GPU_Detected"] = "Error" }

$results | ConvertTo-Json
