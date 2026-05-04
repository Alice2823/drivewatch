Get-WmiObject -Namespace root/wmi -List | Where-Object { $_.Name -match 'Thermal' }
