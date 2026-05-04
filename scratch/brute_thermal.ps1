$namespaces = @('root/cimv2', 'root/wmi')
$found = @()

foreach ($ns in $namespaces) {
    try {
        $classes = Get-CimClass -Namespace $ns -ClassName *Thermal*,*Temp*,*Sensor* -ErrorAction SilentlyContinue
        foreach ($c in $classes) {
            try {
                $instances = Get-CimInstance -Namespace $ns -ClassName $c.CimClassName -ErrorAction SilentlyContinue
                foreach ($inst in $instances) {
                    $props = $inst | Get-Member -MemberType Property
                    foreach ($p in $props) {
                        try {
                            $val = $inst.$($p.Name)
                            if ($val -is [numeric] -and $val -gt 20 -and $val -lt 5000) {
                                # Potential temp
                                $found += [PSCustomObject]@{
                                    NS = $ns
                                    Class = $c.CimClassName
                                    Property = $p.Name
                                    Value = $val
                                }
                            }
                        } catch {}
                    }
                }
            } catch {}
        }
    } catch {}
}

$found | ConvertTo-Json
