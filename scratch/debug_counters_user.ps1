$c = Get-Counter "\GPU Engine(*)\Utilization Percentage" -ErrorAction SilentlyContinue
if ($c) {
    Write-Output "Count: $($c.CounterSamples.Count)"
    Write-Output "First Path: $($c.CounterSamples[0].Path)"
} else {
    Write-Output "No counters found"
}
