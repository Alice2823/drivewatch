try {
    $counters = Get-Counter "\GPU Engine(*)\Utilization Percentage" -ErrorAction SilentlyContinue
    if ($counters) {
        $samples = $counters.CounterSamples | Where-Object { $_.Path -like "*engtype_3D*" }
        $total3d = ($samples | Measure-Object -Property CookedValue -Sum).Sum
        Write-Output "3D Load: $total3d"
    } else {
        Write-Output "No counters found"
    }
} catch {
    Write-Output "Error: $_"
}
