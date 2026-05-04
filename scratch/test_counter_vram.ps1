try {
    $c = Get-Counter "\GPU Adapter Memory(*)\Total Committed" -ErrorAction SilentlyContinue
    if ($c) {
        $totalVram = ($c.CounterSamples | Measure-Object -Property CookedValue -Sum).Sum
        Write-Output "VRAM Used: $totalVram"
    } else {
        Write-Output "No VRAM counters found"
    }
} catch {
    Write-Output "Error: $_"
}
