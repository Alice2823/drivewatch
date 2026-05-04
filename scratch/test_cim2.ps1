try {
  $stats = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue
  $maxLoad = 0
  
  if ($stats) {
    $typeSums = @{}
    foreach ($s in $stats) {
      if ($s.Name -match "luid_(0x[0-9a-fA-F_]+)_.*engtype_(.+)") {
        $key = "$($matches[1])_$($matches[2])"
        if (-not $typeSums.ContainsKey($key)) { $typeSums[$key] = 0 }
        $typeSums[$key] += $s.UtilizationPercentage
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
