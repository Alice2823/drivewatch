$sets = Get-Counter -ListSet *
foreach ($set in $sets) {
    $paths = $set.Paths | Where-Object { $_ -match "Temperature" }
    if ($paths) {
        try {
            $c = Get-Counter $paths -ErrorAction SilentlyContinue
            if ($c) {
                foreach ($sample in $c.CounterSamples) {
                    Write-Output "FOUND: $($sample.Path) = $($sample.CookedValue)"
                }
            }
        } catch {}
    }
}
