Get-Partition | Where-Object { $_.DriveLetter -ne $null -and $_.DriveLetter -ne '' } | Select-Object DiskNumber, DriveLetter, Size | ConvertTo-Json -Compress
