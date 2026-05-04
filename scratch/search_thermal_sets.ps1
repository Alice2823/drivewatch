$sets = Get-Counter -ListSet *
foreach ($s in $sets) {
    if ($s.CounterSetName -like "*Thermal*") {
        Write-Output $s.CounterSetName
    }
}
