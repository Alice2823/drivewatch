/**
 * ═══════════════════════════════════════════════════════════════
 * DriveWatch — Scan Result Store
 * ═══════════════════════════════════════════════════════════════
 *
 * Persists the last surface scan result per disk.
 *
 * Storage key: diskIndex (primary) + serial/model (for fuzzy lookup)
 * Persistence: JSON file in Electron userData — survives app restarts.
 * ═══════════════════════════════════════════════════════════════
 */

import { app } from 'electron'
import fs from 'fs'
import path from 'path'

export interface WeakSectorRecord {
  lba: number
  /** 2 = slow/weak, 3 = bad/unreadable */
  status: 2 | 3
  readTimeMs: number
}

export interface StoredScanResult {
  diskIndex: number
  /** Drive model/friendly name — for fuzzy cross-session matching */
  model?: string
  /** Drive serial number — strongest cross-session identifier */
  serial?: string
  /** Physical device path e.g. \\\\.\\PhysicalDrive1 */
  devicePath?: string
  timestamp: number
  /** Total LBAs on the disk */
  totalLbas: number
  /** Total chunks scanned */
  totalChunks: number
  /**
   * Count of CONFIRMED weak sectors (≥150 ms, not a controller spike).
   * Used by the lifespan engine for reliability scoring.
   */
  slowCount: number
  /**
   * Count of ALL display-slow sectors (≥50 ms) for UI yellow-block display.
   * Includes normal USB/SCSI controller jitter — NOT used for lifespan scoring.
   */
  slowCountDisplay?: number
  /** Count of bad (unreadable) sectors found */
  errorCount: number
  /** Duration of the scan in seconds */
  durationSec: number
  /** Weak/bad sector records (≥150 ms confirmed, or actual read failures) */
  weakSectors: WeakSectorRecord[]
  /** Compressed block map (0=unscanned 1=healthy 2=slow 3=bad 4=scanning) */
  blocks: number[]
  totalBlocks: number
  /** Scan mode that generated this result */
  scanMode: 'quick' | 'full' | 'smart'
  /** Hardware execution mode. REAL_SCAN is the only mode allowed to affect scoring. */
  executionMode?: 'REAL_SCAN' | 'SIMULATION_MODE'
  /** Count of bytes confirmed by completed ReadFile calls. */
  actualBytesRead?: number
  /**
   * True when the scan ran in simulation mode (no hardware access).
   * The lifespan engine MUST ignore surface-scan penalties from simulated results.
   */
  isSimulated?: boolean
}

// ── Persistence ───────────────────────────────────────────────────────────────

function getStorePath(): string {
  try {
    return path.join(app.getPath('userData'), 'drivewatch_scan_cache.json')
  } catch {
    // app may not be ready yet during module load — fallback
    return path.join(process.cwd(), 'drivewatch_scan_cache.json')
  }
}

function loadFromDisk(): Map<number, StoredScanResult> {
  try {
    const filePath = getStorePath()
    if (!fs.existsSync(filePath)) return new Map()
    const raw = fs.readFileSync(filePath, 'utf8')
    const arr: StoredScanResult[] = JSON.parse(raw)
    const map = new Map<number, StoredScanResult>()
    for (const entry of arr) {
      if (typeof entry.diskIndex === 'number') {
        map.set(entry.diskIndex, entry)
        console.log(`[ScanStore] 📂 Loaded persisted result: diskIndex=${entry.diskIndex}, model="${entry.model}", serial="${entry.serial}", slowCount=${entry.slowCount}, errorCount=${entry.errorCount}`)
      }
    }
    console.log(`[ScanStore] ✅ Loaded ${map.size} persisted scan result(s) from disk.`)
    return map
  } catch (e: any) {
    console.error(`[ScanStore] ⚠️ Could not load persisted cache:`, e?.message)
    return new Map()
  }
}

function saveToDisk(map: Map<number, StoredScanResult>): void {
  try {
    const filePath = getStorePath()
    const arr = Array.from(map.values())
    fs.writeFileSync(filePath, JSON.stringify(arr, null, 2), 'utf8')
  } catch (e: any) {
    console.error(`[ScanStore] ⚠️ Could not persist cache:`, e?.message)
  }
}

// One result per physical disk index — loaded from disk on startup
const store = loadFromDisk()

// ── Write API ─────────────────────────────────────────────────────────────────

export function saveScanResult(result: StoredScanResult): void {
  // FULLY OVERWRITE old telemetry for the same disk.
  // Do NOT preserve stale degradation or merge with old results.
  
  // Clean up any existing entries in the store that share the same serial or devicePath
  // to prevent stale duplicate cache contamination.
  for (const [key, entry] of store.entries()) {
    const isSameSerial = result.serial && entry.serial && result.serial.trim().toLowerCase() === entry.serial.trim().toLowerCase();
    const isSameDevice = result.devicePath && entry.devicePath && result.devicePath.trim().toLowerCase() === entry.devicePath.trim().toLowerCase();
    
    if (isSameSerial || isSameDevice || key === result.diskIndex) {
      store.delete(key);
    }
  }

  store.set(result.diskIndex, result)
  saveToDisk(store)

  console.log('[ScanStore]')
  console.log(`Replacing previous scan snapshot for disk: ${result.diskIndex}`)

  console.log(`[ScanStore] 💾 Saved scan result:`)
  console.log(`  diskIndex  = ${result.diskIndex}`)
  console.log(`  model      = "${result.model ?? 'N/A'}"`)
  console.log(`  serial     = "${result.serial ?? 'N/A'}"`)
  console.log(`  devicePath = "${result.devicePath ?? 'N/A'}"`)
  console.log(`  slowCount  = ${result.slowCount}`)
  console.log(`  errorCount = ${result.errorCount}`)
  console.log(`  scanMode   = ${result.scanMode}`)
  console.log(`  key (diskIndex) = ${result.diskIndex}`)
  console.log(`  allStoredKeys   = [${Array.from(store.keys()).join(', ')}]`)
}

// ── Read API ──────────────────────────────────────────────────────────────────

export function getScanResult(diskIndex: number): StoredScanResult | null {
  const result = store.get(diskIndex) ?? null
  console.log(`[ScanStore] 🔍 Lookup: diskIndex=${diskIndex} → ${result ? `FOUND (slowCount=${result.slowCount}, errorCount=${result.errorCount})` : 'NOT FOUND'}`)
  console.log(`[ScanStore]    Available stored diskIndices: [${Array.from(store.keys()).join(', ')}]`)
  return result
}

/**
 * Multi-stage fuzzy lookup:
 * 1. Exact diskIndex
 * 2. Serial match (strongest cross-session identifier)
 * 3. Exact model name match
 * 3.5. Device path match
 * 4. Partial/substring model match (USB/SCSI/Realtek mangled names)
 */
export function findBestScanResult(
  diskIndex: number,
  model?: string,
  serial?: string,
  devicePath?: string
): StoredScanResult | null {
  const allResults = Array.from(store.values())
  const allKeys = Array.from(store.keys())

  console.log(`[ScanStore] 🔎 findBestScanResult: diskIndex=${diskIndex}, model="${model}", serial="${serial}", devicePath="${devicePath}"`)
  console.log(`[ScanStore]    Stored results: ${allResults.length} — keys: [${allKeys.join(', ')}]`)
  allResults.forEach(r => {
    console.log(`[ScanStore]    Stored[${r.diskIndex}]: model="${r.model}", serial="${r.serial}", device="${r.devicePath}", slow=${r.slowCount}, err=${r.errorCount}`)
  })

  // Stage 1: Exact diskIndex
  const exact = store.get(diskIndex)
  if (exact) {
    console.log(`[ScanStore] ✅ Stage 1 HIT: exact diskIndex=${diskIndex}`)
    return exact
  }
  console.log(`[ScanStore]    Stage 1 MISS: no exact diskIndex=${diskIndex}`)

  // Stage 2: Serial match (strongest cross-session identifier)
  if (serial && serial.trim().length > 3) {
    const normalSerial = serial.trim().toLowerCase()
    const bySerial = allResults.find(r =>
      r.serial && r.serial.trim().toLowerCase() === normalSerial
    )
    if (bySerial) {
      console.log(`[ScanStore] ✅ Stage 2 HIT: serial match "${serial}" → stored diskIndex=${bySerial.diskIndex}`)
      return { ...bySerial, diskIndex }
    }
    console.log(`[ScanStore]    Stage 2 MISS: serial "${serial}" not in stored results`)
  }

  // Stage 3: Exact model name match
  if (model && model.trim().length > 3) {
    const normalModel = model.trim().toLowerCase()
    const byModel = allResults.find(r =>
      r.model && r.model.trim().toLowerCase() === normalModel
    )
    if (byModel) {
      console.log(`[ScanStore] ✅ Stage 3 HIT: exact model match "${model}" → stored diskIndex=${byModel.diskIndex}`)
      return { ...byModel, diskIndex }
    }
    console.log(`[ScanStore]    Stage 3 MISS: exact model "${model}" not found`)
  }

  // Stage 3.5: Device path match (e.g. \\.\PhysicalDriveN)
  if (devicePath && devicePath.trim().length > 4) {
    const normalPath = devicePath.trim().toLowerCase()
    const byPath = allResults.find(r =>
      r.devicePath && r.devicePath.trim().toLowerCase() === normalPath
    )
    if (byPath) {
      console.log(`[ScanStore] ✅ Stage 3.5 HIT: devicePath match "${devicePath}" → stored diskIndex=${byPath.diskIndex}`)
      return { ...byPath, diskIndex }
    }
    console.log(`[ScanStore]    Stage 3.5 MISS: devicePath "${devicePath}" not found`)
  }

  // Stage 4: Partial model match (USB/SCSI/Realtek often embed base model in longer string)
  if (model && model.trim().length > 3) {
    const normalModel = model.trim().toLowerCase()
    const byPartial = allResults.find(r =>
      r.model && (
        r.model.trim().toLowerCase().includes(normalModel) ||
        normalModel.includes(r.model.trim().toLowerCase())
      )
    )
    if (byPartial) {
      console.log(`[ScanStore] ✅ Stage 4 HIT: partial model match "${model}" ↔ "${byPartial.model}" → stored diskIndex=${byPartial.diskIndex}`)
      return { ...byPartial, diskIndex }
    }
    console.log(`[ScanStore]    Stage 4 MISS: no partial model match for "${model}"`)
  }

  console.warn(`[ScanStore] ❌ findBestScanResult: No match found for diskIndex=${diskIndex}. Run Surface Scan on this drive first.`)
  return null
}

export function hasScanResult(diskIndex: number): boolean {
  return store.has(diskIndex)
}

export function clearScanResult(diskIndex: number, serial?: string, model?: string, devicePath?: string): void {
  store.delete(diskIndex)
  
  for (const [key, entry] of store.entries()) {
    const isSameSerial = serial && entry.serial && serial.trim().toLowerCase() === entry.serial.trim().toLowerCase();
    const isSameDevice = devicePath && entry.devicePath && devicePath.trim().toLowerCase() === entry.devicePath.trim().toLowerCase();
    const isSameModel = model && entry.model && model.trim().toLowerCase() === entry.model.trim().toLowerCase();
    
    if (isSameSerial || isSameDevice || (isSameModel && entry.model && entry.model.trim().length > 3)) {
      store.delete(key);
    }
  }
  
  saveToDisk(store)
}

export function getAllStoredDiskIndices(): number[] {
  return Array.from(store.keys())
}

export function getAllScanResults(): StoredScanResult[] {
  return Array.from(store.values())
}

// cancelled is optional on stored results (only present on in-flight scans)
// isSimulated is optional — added by the calibrated scan engine v2
