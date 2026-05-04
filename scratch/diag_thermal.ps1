$results = @{}

# 1. MSAcpi_ThermalZoneTemperature
try {
    $wmi = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue
    if (-not $wmi) { $wmi = Get-WmiObject -Namespace root/wmi -Class MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue }
    $results["MSAcpi_ThermalZoneTemperature"] = if ($wmi) { $wmi | ForEach-Object { $_.CurrentTemperature } } else { "Not found" }
} catch { $results["MSAcpi_ThermalZoneTemperature"] = "Error: $($_.Exception.Message)" }

# 2. Performance Counters
$counters = @(
    "\\Thermal Zone Information(*)\\Temperature",
    "\\Thermal Zone Information(*)\\High Precision Temperature",
    "\\MPTF Information(*)\\Temperature",
    "\\Thermal Zone Information(ThermalZone0)\\Temperature",
    "\\Thermal Zone Information(ThermalZone1)\\Temperature"
)
foreach ($c in $counters) {
    try {
        $perf = Get-Counter $c -ErrorAction SilentlyContinue
        $results[$c] = if ($perf) { $perf.CounterSamples.CookedValue } else { "Not found" }
    } catch { $results[$c] = "Error: $($_.Exception.Message)" }
}

# 3. Win32_TemperatureProbe
try {
    $probe = Get-CimInstance Win32_TemperatureProbe -ErrorAction SilentlyContinue
    $results["Win32_TemperatureProbe"] = if ($probe) { $probe | ForEach-Object { $_.CurrentReading } } else { "Not found" }
} catch { $results["Win32_TemperatureProbe"] = "Error: $($_.Exception.Message)" }

$results | ConvertTo-Json
