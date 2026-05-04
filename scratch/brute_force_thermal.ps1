$sets = Get-Counter -ListSet *
foreach ($set in $sets) {
    if ($set.CounterSetName -match "Thermal|Temp|Processor|Memory|GPU") {
        try {
            $c = Get-Counter $set.Paths -ErrorAction SilentlyContinue
            if ($c) {
                foreach ($sample in $c.CounterSamples) {
                    if ($sample.CookedValue -gt 25 -and $sample.CookedValue -lt 110) {
                        Write-Output "FOUND: $($sample.Path) = $($sample.CookedValue)"
                    }
                }
            }
        } catch {}
    }
}
