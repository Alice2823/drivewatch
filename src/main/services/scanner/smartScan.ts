import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { existsSync } from 'fs'
import { PowerShellHost } from '../psHost'
import { getDiskData } from '../diskService'

const execFileAsync = promisify(execFile)

// ─────────────────────────────────────────────
// smartctl detection (dev + production)
// ─────────────────────────────────────────────

const getBundledSmartctl = () => {
  try {
    const isWin = process.platform === 'win32'
    const binName = isWin ? 'smartctl.exe' : 'smartctl'

    // production (after build)
    const prod = path.join(process.resourcesPath, binName)
    if (existsSync(prod)) return prod

    // development mode
    const dev = path.join(process.cwd(), 'build', 'resources', binName)
    if (existsSync(dev)) return dev
  } catch {}

  return null
}

const SMARTCTL_CANDIDATES = [
  getBundledSmartctl(),
  'smartctl',
  'C:\\Program Files\\smartmontools\\bin\\smartctl.exe',
  'C:\\Program Files (x86)\\smartmontools\\bin\\smartctl.exe'
].filter(Boolean) as string[]

let resolvedSmartctl: string | null | undefined = undefined

async function findSmartctl(): Promise<string | null> {
  if (resolvedSmartctl !== undefined) return resolvedSmartctl

  for (const candidate of SMARTCTL_CANDIDATES) {
    try {
      await execFileAsync(candidate, ['--version'], {
        timeout: 3000,
        windowsHide: true
      })
      resolvedSmartctl = candidate
      console.log(`[SmartScan] Found smartctl: ${candidate}`)
      return resolvedSmartctl
    } catch {}
  }

  resolvedSmartctl = null
  console.warn('[SmartScan] smartctl not found → fallback mode')
  return null
}

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface SmartResult {
  available: boolean
  fallback: boolean
  overallHealth: 'PASSED' | 'FAILED' | 'Unknown'
  temperature: number | null
  powerOnHours: number | null
  attributes: any[]
  issues: string[]
  error?: string
}

const DEFAULT_FALLBACK: SmartResult = {
  available: false,
  fallback: true,
  overallHealth: 'Unknown',
  temperature: null,
  powerOnHours: null,
  attributes: [],
  issues: []
}

// ─────────────────────────────────────────────
// DEVICE DETECTION
// ─────────────────────────────────────────────

async function getSmartDevice(smartctlPath: string, diskIndex: number) {
  try {
    const { stdout } = await execFileAsync(smartctlPath, ['--scan'], { windowsHide: true })
    const lines = stdout.split('\n')
    
    // Convert index 0 -> 'a', 1 -> 'b' to match /dev/sda, /dev/sdb
    const targetChar = String.fromCharCode(97 + diskIndex)
    const targetPath = `/dev/sd${targetChar}`
    
    for (const line of lines) {
      if (line.includes(targetPath) || line.includes(`/dev/nvme${diskIndex}`)) {
        const parts = line.trim().split(' ')
        
        let typeFlag: string | null = null
        const dIndex = parts.indexOf('-d')
        if (dIndex !== -1 && dIndex + 1 < parts.length) {
          typeFlag = parts[dIndex + 1]
        }
        
        return {
          path: parts[0],
          isNvme: typeFlag === 'nvme' || line.toLowerCase().includes('nvme'),
          typeFlag
        }
      }
    }
  } catch {}

  return {
    path: `\\\\.\\PhysicalDrive${diskIndex}`,
    isNvme: false,
    typeFlag: null
  }
}

// ─────────────────────────────────────────────
// SMARTCTL SCAN
// ─────────────────────────────────────────────

async function runSmartctl(smartctlPath: string, diskIndex: number): Promise<SmartResult> {
  try {
    const device = await getSmartDevice(smartctlPath, diskIndex)
    console.log(`[SmartScan] using device: ${device.path} (NVMe: ${device.isNvme}, Flag: ${device.typeFlag})`)

    const args = ['-a', '-j']
    if (device.typeFlag) {
      args.push('-d', device.typeFlag)
    } else if (device.isNvme) {
      args.push('-d', 'nvme')
    }
    args.push(device.path)

    const { stdout } = await execFileAsync(
      smartctlPath,
      args,
      {
        timeout: 20000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024
      }
    )

    console.log("[SmartScan RAW]", stdout.substring(0, 500) + "...") // truncated for sanity

    let data: any = {}

    try {
      data = JSON.parse(stdout)
      console.log("[SmartScan PARSED]", JSON.stringify(data).substring(0, 500) + "...")
    } catch {
      return {
        ...DEFAULT_FALLBACK,
        error: 'Invalid JSON from smartctl'
      }
    }

    const overallHealth =
      data?.smart_status?.passed === true
        ? 'PASSED'
        : data?.smart_status?.passed === false
        ? 'FAILED'
        : 'Unknown'

    const temperature =
      data?.temperature?.current ??
      data?.nvme_smart_health_information_log?.temperature ??
      data?.ata_smart_attributes?.table?.find(
        (a: any) => a.id === 194 || a.id === 190
      )?.raw?.value ??
      null

    const powerOnHours = data?.power_on_time?.hours ?? null

    let reallocated = 0
    let pending = 0
    let wear: number | null = null
    const issues: string[] = []
    const attributes: any[] = []

    const rawTable = data?.ata_smart_attributes?.table ?? []

    // 1. Map ATA Attributes
    if (rawTable.length > 0) {
      for (const attr of rawTable) {
        if (attr.id === 5) reallocated = attr.raw?.value || 0
        if (attr.id === 197) pending = attr.raw?.value || 0

        if ([173, 177, 202, 231].includes(attr.id) && wear === null) {
          wear = attr.value
        }

        attributes.push({
          id: attr.id ?? 0,
          name: attr.name ?? 'Unknown',
          value: attr.value ?? 0,
          worst: attr.worst ?? 0,
          thresh: attr.thresh ?? 0,
          raw: attr.raw?.value ?? attr.raw?.string ?? 0,
          failed: !!attr.when_failed,
          critical: attr.flags?.prefailure ?? false
        })
      }
    }

    // 2. Map NVMe Attributes and Extrapolate Fallbacks
    const nvme = data?.nvme_smart_health_information_log
    if (nvme) {
      if (nvme.percentage_used !== undefined && wear === null) {
        wear = Math.max(0, 100 - nvme.percentage_used)
      }
      if (nvme.media_errors !== undefined) {
        reallocated = Math.max(reallocated, nvme.media_errors)
      }

      // If no ATA table existed, populate NVMe stats as attributes so the UI table has data
      if (attributes.length === 0) {
        const addAttr = (id: number, name: string, raw: number) => {
          attributes.push({
            id, name, value: 100, worst: 100, thresh: 0, raw, failed: false, critical: false
          })
        }
        if (nvme.critical_warning !== undefined) addAttr(1, 'Critical_Warning', nvme.critical_warning)
        if (nvme.temperature !== undefined) addAttr(2, 'Temperature_Celsius', nvme.temperature)
        if (nvme.available_spare !== undefined) addAttr(3, 'Available_Spare_%', nvme.available_spare)
        if (nvme.percentage_used !== undefined) addAttr(4, 'Percentage_Used_%', nvme.percentage_used)
        if (nvme.media_errors !== undefined) addAttr(5, 'Media_Errors', nvme.media_errors)
        if (nvme.data_units_read !== undefined) addAttr(6, 'Data_Units_Read', nvme.data_units_read)
        if (nvme.data_units_written !== undefined) addAttr(7, 'Data_Units_Written', nvme.data_units_written)
        if (nvme.power_cycles !== undefined) addAttr(8, 'Power_Cycles', nvme.power_cycles)
        if (nvme.power_on_hours !== undefined) addAttr(9, 'Power_On_Hours', nvme.power_on_hours)
        if (nvme.unsafe_shutdowns !== undefined) addAttr(10, 'Unsafe_Shutdowns', nvme.unsafe_shutdowns)
      }
    }



    if (reallocated > 0) {
      issues.push(`Bad sectors detected (${reallocated})`)
    }
    if (pending > 0) {
      issues.push("Pending sectors detected → risk of data loss")
    }
    if (temperature !== null && temperature > 55) {
      issues.push(`High temperature (${temperature}°C)`)
    }
    if (wear !== null && wear < 70) {
      issues.push("Drive aging detected")
    }
    if (overallHealth === 'FAILED') {
      issues.push("Drive reported failure")
    }

    return {
      available: true,
      fallback: false,
      overallHealth,
      temperature: typeof temperature === 'number' && temperature >= 1 && temperature <= 120 ? temperature : null,
      powerOnHours,
      attributes,
      issues
    }
  } catch (err: any) {
    console.error('[SmartScan Error]', err)

    return {
      ...DEFAULT_FALLBACK,
      error: err.message
    }
  }
}

// ─────────────────────────────────────────────
// WMI FALLBACK (PER DISK)
// ─────────────────────────────────────────────

async function runWmiFallback(diskIndex: number): Promise<SmartResult> {
  if (process.platform !== 'win32') {
    return {
      ...DEFAULT_FALLBACK,
      error: 'WMI fallback only available on Windows'
    }
  }

  const psHost = PowerShellHost.getInstance()

  const script = `
$fail = Get-WmiObject -Namespace root\\wmi -Class MSStorageDriver_FailurePredictStatus |
Where-Object { $_.InstanceName -match "Disk${diskIndex}" } |
Select-Object -First 1

$result = @{
  PredictFailure = if ($fail) { $fail.PredictFailure } else { $false }
}

$result | ConvertTo-Json -Compress
`

  try {
    const out = await psHost.execute(script, 10000)

    let data: any = {}
    try {
      data = JSON.parse(out)
    } catch {
      data = {}
    }

    return {
      ...DEFAULT_FALLBACK,
      overallHealth: data?.PredictFailure ? 'FAILED' : 'Unknown',
    }
  } catch {
    return {
      ...DEFAULT_FALLBACK,
      error: 'WMI fallback failed'
    }
  }
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

export async function runSmartScan(diskIndex: number): Promise<SmartResult> {
  const smartctl = await findSmartctl()

  if (smartctl) {
    const result = await runSmartctl(smartctl, diskIndex)
    if (result.available) return result
  }

  return runWmiFallback(diskIndex)
}