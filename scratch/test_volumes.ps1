# Test: Volume sizes via Get-Volume
Get-Volume | Where-Object { $_.DriveLetter -ne $null -and $_.DriveLetter -ne '' } | Select-Object DriveLetter, Size, SizeRemaining | ConvertTo-Json -Compress
