try {
  $stats = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue
  $maxLoad = 0
  
  if ($stats) {
    $typeSums = @{}
    foreach ($s in $stats) {
      if ($s.Name -match "engtype_(.+)") {
        $type = $matches[1]
        if (-not $typeSums.ContainsKey($type)) { $typeSums[$type] = 0 }
        $typeSums[$type] += $s.UtilizationPercentage
      }
    }
    if ($typeSums.Count -gt 0) {
      $maxLoad = ($typeSums.Values | Measure-Object -Maximum).Maximum
    }
  }

  $mem = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -ErrorAction SilentlyContinue
  $vram = 0
  if ($mem) {
    $vram = ($mem | Measure-Object -Property TotalCommitted -Sum).Sum
  }

  $res = @{ load = [math]::Round($maxLoad); vramUsed = [math]::Round($vram / 1MB) }
  $res | ConvertTo-Json -Compress
} catch { "{}" }
