try {
    $gpus = Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM
    $counters = Get-Counter "\GPU Engine(*)\Utilization Percentage" -ErrorAction SilentlyContinue
    $memCounters = Get-Counter "\GPU Adapter Memory(*)\Total Committed" -ErrorAction SilentlyContinue

    $results = @{}

    if ($counters) {
        foreach ($sample in $counters.CounterSamples) {
            if ($sample.Path -match "luid_(0x[0-9a-fA-F_]+)_phys_(\d+)_eng_(\d+)_engtype_([^)]+)") {
                $luid = $matches[1]
                $type = $matches[4]
                if (-not $results.ContainsKey($luid)) {
                    $results[$luid] = @{
                        engines = @{}
                        vramUsed = 0
                    }
                }
                if (-not $results[$luid].engines.ContainsKey($type)) {
                    $results[$luid].engines[$type] = 0
                }
                $results[$luid].engines[$type] += $sample.CookedValue
            }
        }
    }

    if ($memCounters) {
        foreach ($sample in $memCounters.CounterSamples) {
            if ($sample.Path -match "luid_(0x[0-9a-fA-F_]+)_phys_(\d+)") {
                $luid = $matches[1]
                if ($results.ContainsKey($luid)) {
                    $results[$luid].vramUsed = [math]::Round($sample.CookedValue / 1MB)
                }
            }
        }
    }

    $output = @()
    $luidKeys = $results.Keys | Sort-Object
    for ($i = 0; $i -lt $luidKeys.Count; $i++) {
        $luid = $luidKeys[$i]
        $gpuData = $results[$luid]
        
        $maxUtil = 0
        if ($gpuData.engines.Count -gt 0) {
            $maxUtil = ($gpuData.engines.Values | Measure-Object -Maximum).Maximum
        }

        $name = "GPU $i"
        $vramTotal = 0
        if ($i -lt $gpus.Count) {
            $name = $gpus[$i].Name
            $vramTotal = [math]::Round($gpus[$i].AdapterRAM / 1MB)
        }

        $output += @{
            name = $name
            usage = [math]::Round($maxUtil)
            vramUsed = $gpuData.vramUsed
            vramTotal = $vramTotal
        }
    }

    if ($output.Count -eq 0 -and $gpus.Count -gt 0) {
        # Fallback if counters failed
        foreach ($gpu in $gpus) {
            $output += @{
                name = $gpu.Name
                usage = 0
                vramUsed = 0
                vramTotal = [math]::Round($gpu.AdapterRAM / 1MB)
            }
        }
    }

    Write-Output ($output | ConvertTo-Json -Compress)
} catch {
    Write-Output "ERROR: $($_.Exception.Message)"
}
