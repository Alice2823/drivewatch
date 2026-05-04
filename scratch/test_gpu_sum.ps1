$counters = Get-Counter "\GPU Engine(*3D)\Utilization Percentage" -ErrorAction SilentlyContinue
if ($counters) {
    $3d = ($counters.CounterSamples | Measure-Object -Property CookedValue -Sum).Sum
} else {
    $3d = 0
}

$countersVid = Get-Counter "\GPU Engine(*Video*)\Utilization Percentage" -ErrorAction SilentlyContinue
if ($countersVid) {
    $vid = ($countersVid.CounterSamples | Measure-Object -Property CookedValue -Sum).Sum
} else {
    $vid = 0
}

$countersCmp = Get-Counter "\GPU Engine(*Compute*)\Utilization Percentage" -ErrorAction SilentlyContinue
if ($countersCmp) {
    $cmp = ($countersCmp.CounterSamples | Measure-Object -Property CookedValue -Sum).Sum
} else {
    $cmp = 0
}

Write-Output "3D: $3d"
Write-Output "Vid: $vid"
Write-Output "Cmp: $cmp"

$maxLoad = 0
if ($3d -gt $maxLoad) { $maxLoad = $3d }
if ($vid -gt $maxLoad) { $maxLoad = $vid }
if ($cmp -gt $maxLoad) { $maxLoad = $cmp }

Write-Output "MaxLoad: $maxLoad"
