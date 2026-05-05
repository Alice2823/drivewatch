$c = Get-Counter -Counter @(
  '\PhysicalDisk(*)\Disk Read Bytes/sec',
  '\PhysicalDisk(*)\Disk Write Bytes/sec',
  '\PhysicalDisk(*)\% Disk Time'
) -ErrorAction SilentlyContinue

$result = @{}
foreach ($s in $c.CounterSamples) {
  $path = $s.Path
  $val  = $s.CookedValue
  Write-Host "RAW: $path = $val"
  if ($path -match 'physicaldisk\((\d+)') {
    $idx = $Matches[1]
    if (-not $result[$idx]) { $result[$idx] = @{ r=0; w=0; u=0 } }
    if ($path -like '*read bytes*')  { $result[$idx].r = $val }
    if ($path -like '*write bytes*') { $result[$idx].w = $val }
    if ($path -like '*disk time*')   { $result[$idx].u = $val }
  }
}
Write-Host "---JSON---"
$result | ConvertTo-Json -Compress
