$gpus = Get-CimInstance Win32_VideoController
foreach ($gpu in $gpus) {
    Write-Output "Name: $($gpu.Name)"
    Write-Output "PNPDeviceID: $($gpu.PNPDeviceID)"
    $path = "HKLM:\SYSTEM\CurrentControlSet\Enum\$($gpu.PNPDeviceID)\Device Parameters"
    if (Test-Path $path) {
        Get-ItemProperty $path | Select-Object *
    }
    Write-Output "---"
}
