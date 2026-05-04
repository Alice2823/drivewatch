$path = "\\alice\gpu engine(pid_10644_luid_0x00000000_0x0000d351_phys_0_eng_0_engtype_3d)\utilization percentage"
if ($path -match "luid_(0x[0-9a-fA-F]+_0x[0-9a-fA-F]+)_phys_(\d+)") {
    Write-Output "LUID: $($matches[1])"
    Write-Output "Phys: $($matches[2])"
} else {
    Write-Output "No match"
}
