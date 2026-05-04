$sets = Get-Counter -ListSet *
foreach ($s in $sets) {
    try {
        $paths = $s.Paths
        foreach ($p in $paths) {
            if ($p -like "*Temp*") {
                Write-Output $p
            }
        }
    } catch {}
}
