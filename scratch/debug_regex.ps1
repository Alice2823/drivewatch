$counters = Get-Counter "\GPU Engine(*)\Utilization Percentage" -ErrorAction SilentlyContinue
if ($counters) {
    Write-Output "Found counters: $($counters.CounterSamples.Count)"
    $sample = $counters.CounterSamples[0]
    Write-Output "Path: $($sample.Path)"
    if ($sample.Path -match "luid_(0x[0-9a-fA-F_]+)_phys_(\d+)_eng_(\d+)_engtype_([^)]+)") {
        Write-Output "Matched!"
        Write-Output "LUID: $($matches[1])"
    } else {
        Write-Output "No match"
    }
} else {
    Write-Output "No counters found"
}
