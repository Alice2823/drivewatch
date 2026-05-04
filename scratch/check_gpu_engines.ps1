$stats = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine
$total3d = ($stats | Where-Object { $_.Name -like "*engtype_3D*" } | Measure-Object -Property UtilizationPercentage -Sum).Sum
$totalVideo = ($stats | Where-Object { $_.Name -like "*engtype_Video*" } | Measure-Object -Property UtilizationPercentage -Sum).Sum
$totalCompute = ($stats | Where-Object { $_.Name -like "*engtype_Compute*" } | Measure-Object -Property UtilizationPercentage -Sum).Sum

Write-Output "3D Sum: $total3d"
Write-Output "Video Sum: $totalVideo"
Write-Output "Compute Sum: $totalCompute"
