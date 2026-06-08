try {
    $ohm = Get-WmiObject -namespace "root\OpenHardwareMonitor" -query "SELECT * FROM Sensor WHERE SensorType = 'Fan' AND Name LIKE '%CPU%'" -ErrorAction Stop
    if ($ohm) {
        Write-Output "OHM: $($ohm.Value)"
        exit 0
    }
} catch {}

try {
    $lhm = Get-WmiObject -namespace "root\LibreHardwareMonitor" -query "SELECT * FROM Sensor WHERE SensorType = 'Fan' AND Name LIKE '%CPU%'" -ErrorAction Stop
    if ($lhm) {
        Write-Output "LHM: $($lhm.Value)"
        exit 0
    }
} catch {}

Write-Output "FAIL"
