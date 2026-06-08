import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { existsSync } from 'fs'
import { PowerShellHost } from '../psHost'
import { getDiskData } from '../diskService'
import { parseSmartOverallHealth } from './smartHealthParser'
import { parseNvmeSmart } from './nvmeSmartParser'
import { mapNvmeToSmartAttributes } from './smartAttributeMapper'


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
  console.warn('[SmartScan] smartctl not found; SMART may be unsupported on this device')
  return null
}

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface SmartResult {
  available: boolean
  fallback: boolean
  overallHealth: 'PASSED' | 'FAILED' | 'Unknown' | 'Unsupported'
  temperature: number | null
  powerOnHours: number | null
  attributes: any[]
  issues: string[]
  error?: string
  unsupported?: boolean
  stale?: boolean
  cachedAt?: number
  partialSMARTSupport?: boolean
  bridgeType?: string
}

const DEFAULT_UNSUPPORTED: SmartResult = {
  available: false,
  fallback: true,
  overallHealth: 'Unsupported',
  temperature: null,
  powerOnHours: null,
  attributes: [],
  issues: [],
  unsupported: true
}

const SMART_CACHE_TTL_MS = 5 * 60 * 1000
const smartCache = new Map<number, { result: SmartResult; timestamp: number }>()

function cacheSmartResult(diskIndex: number, result: SmartResult): SmartResult {
  if (result.available && !result.unsupported && (result.attributes?.length ?? 0) > 0) {
    smartCache.set(diskIndex, {
      result: { ...result, stale: false, cachedAt: Date.now() },
      timestamp: Date.now()
    })
  }
  return result
}

function cachedOrUnsupported(diskIndex: number, result: SmartResult): SmartResult {
  const cached = smartCache.get(diskIndex)
  if (cached && Date.now() - cached.timestamp <= SMART_CACHE_TTL_MS) {
    return {
      ...cached.result,
      fallback: true,
      stale: true,
      cachedAt: cached.timestamp,
      error: result.error ?? 'SMART temporarily unavailable; using cached telemetry'
    }
  }

  return result
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
        ...DEFAULT_UNSUPPORTED,
        error: 'Invalid JSON from smartctl'
      }
    }

    const overallHealth = parseSmartOverallHealth(data)

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

    // 2. Map NVMe Attributes and Extrapolate Fallbacks using new parsed modules
    const nvmeParsed = parseNvmeSmart(data)
    if (nvmeParsed) {
      if (nvmeParsed.percentageUsed !== undefined && wear === null) {
        wear = Math.max(0, 100 - nvmeParsed.percentageUsed)
      }
      if (nvmeParsed.mediaErrors !== undefined) {
        reallocated = Math.max(reallocated, nvmeParsed.mediaErrors)
      }

      // If no ATA table existed, populate NVMe stats as attributes so the UI table has data
      if (attributes.length === 0) {
        const nvmeMapped = mapNvmeToSmartAttributes(nvmeParsed)
        attributes.push(...nvmeMapped)
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
      unsupported: false,
      stale: false,
      cachedAt: Date.now(),
      overallHealth,
      temperature: typeof temperature === 'number' && temperature >= 1 && temperature <= 120 ? temperature : null,
      powerOnHours,
      attributes,
      issues
    }
  } catch (err: any) {
    console.error('[SmartScan Error]', err)

    return {
      ...DEFAULT_UNSUPPORTED,
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
      ...DEFAULT_UNSUPPORTED,
      error: 'WMI fallback only available on Windows'
    }
  }

  const psHost = PowerShellHost.getInstance()

  const script = `
$fail = Get-WmiObject -Namespace root\\wmi -Class MSStorageDriver_FailurePredictStatus |
Where-Object { $_.InstanceName -match "Disk${diskIndex}" } |
Select-Object -First 1

$result = @{
  HasStatus = if ($fail) { $true } else { $false }
  PredictFailure = if ($fail) { $fail.PredictFailure } else { $null }
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

    if (!data?.HasStatus) {
      return {
        ...DEFAULT_UNSUPPORTED,
        error: 'SMART unsupported or blocked by device bridge'
      }
    }

    return {
      ...DEFAULT_UNSUPPORTED,
      available: true,
      unsupported: false,
      overallHealth: data?.PredictFailure ? 'FAILED' : 'Unknown',
    }
  } catch {
    return {
      ...DEFAULT_UNSUPPORTED,
      error: 'WMI fallback failed'
    }
  }
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

export async function runSmartScan(diskIndex: number): Promise<SmartResult> {
  console.log(`[SMART_FETCH] Initiating SMART scan for diskIndex=${diskIndex}`)
  const allDisks = await getDiskData()
  const disk = allDisks.find(d => d.diskIndex === diskIndex) ?? null
  const model = disk?.name || ''
  
  let isUsbBridge = false
  let bridgeType = ''
  
  if (model.match(/RTL9201R|JMS578|ASMedia|SAT|USB-SCSI|SCSI Disk Device/i)) {
    isUsbBridge = true
    bridgeType = model
    console.log(`[USB_BRIDGE_DETECTED] Identified USB-SCSI/SAT bridge device: ${bridgeType}`)
  }

  const smartctl = await findSmartctl()
  let finalResult: SmartResult | null = null

  if (smartctl) {
    const result = await runSmartctl(smartctl, diskIndex)
    if (result.available && !result.unsupported && (result.attributes?.length ?? 0) > 0) {
      console.log(`[SMART_PARSE] Successfully parsed smartctl attributes`)
      finalResult = cacheSmartResult(diskIndex, result)
    }
  }

  if (!finalResult) {
    const fallbackResult = await runWmiFallback(diskIndex)
    if (fallbackResult.available && !fallbackResult.unsupported) {
      console.log(`[SMART_PARSE] Successfully parsed WMI fallback attributes`)
      finalResult = cacheSmartResult(diskIndex, fallbackResult)
    } else {
      console.log(`[SMART_UNSUPPORTED] SMART telemetry unavailable or blocked`)
      finalResult = cachedOrUnsupported(diskIndex, fallbackResult)
    }
  }

  if (isUsbBridge) {
    finalResult.partialSMARTSupport = true
    finalResult.bridgeType = bridgeType
    if (finalResult.unsupported || !finalResult.available) {
      finalResult.error = 'SMART Passthrough Blocked by USB Controller'
    }
  } else if (finalResult.unsupported || !finalResult.available || (finalResult.attributes?.length ?? 0) === 0) {
    finalResult.error = 'SMART Unsupported'
  }

  return finalResult
}
