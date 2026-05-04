$gpus = Get-CimInstance Win32_VideoController
foreach ($gpu in $gpus) {
    $pnpId = $gpu.PNPDeviceID
    Write-Output "Name: $($gpu.Name)"
    Write-Output "PNPDeviceID: $pnpId"
    try {
        # DEVPKEY_Device_Address or other properties might help
        $prop = Get-PnpDeviceProperty -InstanceId $pnpId -KeyName "{60b193cb-5227-492f-b923-f173d9595c07} 1" -ErrorAction SilentlyContinue
        if ($prop) {
            Write-Output "LUID Prop: $($prop.Data)"
        }
        
        $prop2 = Get-PnpDeviceProperty -InstanceId $pnpId -KeyName "DEVPKEY_Device_Address" -ErrorAction SilentlyContinue
        if ($prop2) {
            Write-Output "Address Prop: $($prop2.Data)"
        }
    } catch {
        Write-Output "Error getting props"
    }
    Write-Output "---"
}
