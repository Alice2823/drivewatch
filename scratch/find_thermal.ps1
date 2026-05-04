$namespaces = @('root')
$found = @()

function Get-ThermalClasses($ns) {
    try {
        $classes = Get-CimClass -Namespace $ns -ClassName *Thermal* -ErrorAction SilentlyContinue
        foreach ($c in $classes) {
            $found += [PSCustomObject]@{ Namespace = $ns; Class = $c.CimClassName }
        }
        
        $subs = Get-CimInstance -Namespace $ns -ClassName __NAMESPACE -ErrorAction SilentlyContinue
        foreach ($s in $subs) {
            Get-ThermalClasses "$ns/$($s.Name)"
        }
    } catch {}
}

Get-ThermalClasses 'root'
$found | ConvertTo-Json
