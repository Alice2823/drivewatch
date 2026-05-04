$path = "\\alice\gpu engine(pid_10644_luid_0x00000000_0x0000d351_phys_0_eng_0_engtype_3d)\utilization percentage"
if ($path -match "luid_(0x[0-9a-fA-F]+_0x[0-9a-fA-F]+)_phys_(\d+)_eng_(\d+)_engtype_([^)]+)") {
    Write-Output "LUID: $($matches[1])"
    Write-Output "Type: $($matches[4])"
} else {
    Write-Output "No match"
}
