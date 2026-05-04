$counters = Get-Counter "\GPU Engine(*)\Utilization Percentage" -ErrorAction SilentlyContinue
if ($counters) {
    $counters.CounterSamples | Select-Object Path, CookedValue | Format-Table -AutoSize
} else {
    Write-Output "No counters found"
}

$mem = Get-Counter "\GPU Adapter Memory(*)\Total Committed" -ErrorAction SilentlyContinue
if ($mem) {
    $mem.CounterSamples | Select-Object Path, CookedValue | Format-Table -AutoSize
}
