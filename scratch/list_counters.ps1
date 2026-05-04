Get-Counter -ListSet * | Where-Object { $_.CounterSetName -match 'Thermal|Temp' } | Select-Object CounterSetName
