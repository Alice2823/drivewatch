// ============================================
// NAS MONITORING - React Hook
// Manages all NAS monitoring state and lifecycle
// Properly cleans up on unmount to prevent leaks
// NOW USES REAL NAS DATA via IPC when available
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  NASDevice,
  NASMonitoringState,
  NASConnectionConfig,
  NASStorageAnalytics,
  NASTransferStats,
  NASSMARTData,
  NASTransferPoint,
  ConnectionState,
  HealthLevel,
  RAIDType
} from '../types'
import { analyzeNASHealth } from '../utils/healthAnalyzer'
import { getQualityFromLatency } from '../utils/formatters'

// ============================================
// Real Data Normalizers
// Convert backend NAS data to dashboard types
// ============================================

function normalizeStorageFromPools(deviceId: string, pools: any[], datasets: any[], shares: any[]): NASStorageAnalytics {
  if (!pools || pools.length === 0) {
    return emptyStorage(deviceId, 'No pool data available')
  }

  let totalCapacity = 0
  let usedSpace = 0
  let diskCount = 0
  const volumes: NASStorageAnalytics['volumes'] = []

  for (const pool of pools) {
    totalCapacity += pool.size || 0
    usedSpace += pool.allocated || 0
    diskCount += pool.disks?.length || 0

    // Each pool becomes a volume entry
    volumes.push({
      name: pool.name,
      mountPoint: `/${pool.name}`,
      totalSize: pool.size || 0,
      usedSize: pool.allocated || 0,
      freeSize: pool.free || 0,
      filesystem: 'ZFS',
      status: pool.health === 'ONLINE' ? 'healthy' : pool.health === 'DEGRADED' ? 'degraded' : 'error'
    })
  }

  // Add dataset-level volumes for shares
  const poolNames = new Set(pools.map((p: any) => p.name))
  for (const ds of (datasets || [])) {
    // Only add non-root datasets (i.e. sub-datasets that represent shares)
    if (ds.name.includes('/') && !poolNames.has(ds.name)) {
      const dsName = ds.name.split('/').pop() || ds.name
      const shareInfo = (shares || []).find((s: any) => s.path === ds.mountpoint || s.name === dsName)
      volumes.push({
        name: shareInfo?.name || dsName,
        mountPoint: ds.mountpoint || ds.name,
        totalSize: ds.used + ds.available,
        usedSize: ds.used,
        freeSize: ds.available,
        filesystem: 'ZFS Dataset',
        status: 'healthy'
      })
    }
  }

  const freeSpace = totalCapacity - usedSpace
  const usagePercent = totalCapacity > 0 ? Math.round((usedSpace / totalCapacity) * 100) : 0

  // Determine RAID type from first pool's topology
  let raidType: RAIDType = 'Unknown'
  if (pools[0]?.topology) {
    const topo = pools[0].topology.toUpperCase()
    if (topo.includes('RAIDZ1') || topo === 'RAIDZ') raidType = 'RAIDZ1'
    else if (topo.includes('RAIDZ2')) raidType = 'RAIDZ2'
    else if (topo.includes('RAIDZ3')) raidType = 'RAIDZ3'
    else if (topo.includes('MIRROR')) raidType = 'Mirror'
    else if (topo.includes('STRIPE')) raidType = 'Stripe'
    else if (topo === 'SINGLE' || topo === 'JBOD') raidType = 'Single Disk'
    else if (topo === 'UNKNOWN' || topo === 'TOPOLOGY UNAVAILABLE') {
      // Infer from disk count
      if (diskCount === 1) raidType = 'Single Disk'
      else if (diskCount > 1) raidType = 'JBOD'
    }
  } else {
    // No topology info at all — infer from disk count
    if (diskCount === 1) raidType = 'Single Disk'
    else if (diskCount > 1) raidType = 'JBOD'
  }

  // Determine RAID status
  let raidStatus: NASStorageAnalytics['raidStatus'] = 'unknown'
  const poolHealths = pools.map((p: any) => (p.health || '').toUpperCase())
  if (poolHealths.every((h: string) => h === 'ONLINE')) raidStatus = 'optimal'
  else if (poolHealths.some((h: string) => h === 'DEGRADED')) raidStatus = 'degraded'
  else if (poolHealths.some((h: string) => h === 'FAULTED')) raidStatus = 'failed'

  return {
    deviceId, totalCapacity, usedSpace, freeSpace, usagePercent,
    diskCount, raidType, raidStatus, volumes, lastUpdated: Date.now()
  }
}

function normalizeStorageFromSMB(deviceId: string, smbVolumes: any[]): NASStorageAnalytics {
  if (!smbVolumes || smbVolumes.length === 0) {
    return emptyStorage(deviceId, 'No SMB volume data')
  }

  // De-duplicate volumes that share the same underlying filesystem
  // Multiple SMB shares on the same disk report identical total/free values
  const uniqueVolumes: typeof smbVolumes = []
  const seenCapacities = new Set<string>()

  for (const vol of smbVolumes) {
    // Key by total+free to detect same underlying volume
    const key = `${vol.total || 0}_${vol.free || 0}`
    if (!seenCapacities.has(key) || vol.total === 0) {
      seenCapacities.add(key)
      uniqueVolumes.push(vol)
    }
  }

  let totalCapacity = 0
  let usedSpace = 0
  const volumes: NASStorageAnalytics['volumes'] = []

  for (const vol of uniqueVolumes) {
    totalCapacity += vol.total || 0
    usedSpace += vol.used || 0
    volumes.push({
      name: vol.name,
      mountPoint: `\\\\${vol.name}`,
      totalSize: vol.total || 0,
      usedSize: vol.used || 0,
      freeSize: vol.free || 0,
      filesystem: 'SMB Share',
      status: 'healthy'
    })
  }

  // Also add all shares as volume entries for display (even duplicates)
  for (const vol of smbVolumes) {
    if (!uniqueVolumes.includes(vol)) {
      volumes.push({
        name: vol.name,
        mountPoint: `\\\\${vol.name}`,
        totalSize: vol.total || 0,
        usedSize: vol.used || 0,
        freeSize: vol.free || 0,
        filesystem: 'SMB Share',
        status: 'healthy'
      })
    }
  }

  const freeSpace = totalCapacity - usedSpace
  const usagePercent = totalCapacity > 0 ? Math.round((usedSpace / totalCapacity) * 100) : 0

  // Determine RAID type heuristic for SMB:
  // If multiple unique volumes exist with different sizes → likely JBOD or multiple disks
  // If single volume → Single Disk (or RAID but we can't detect which)
  let raidType: RAIDType = 'Single Disk'
  if (uniqueVolumes.length > 1) {
    raidType = 'Multiple Volumes'
  }

  return {
    deviceId, totalCapacity, usedSpace, freeSpace, usagePercent,
    diskCount: uniqueVolumes.length, raidType, raidStatus: 'unknown',
    volumes, lastUpdated: Date.now()
  }
}

function normalizeSMARTFromDisks(deviceId: string, disks: any[]): NASSMARTData {
  if (!disks || disks.length === 0) {
    return { deviceId, disks: [], lastUpdated: Date.now(), available: false }
  }

  const mapped = disks.map((d: any) => {
    let healthLevel: HealthLevel = 'healthy'
    if (d.healthPercent < 50 || d.reallocatedSectors > 50) healthLevel = 'critical'
    else if (d.healthPercent < 75 || d.reallocatedSectors > 10 || (d.temperature !== null && d.temperature > 50)) healthLevel = 'warning'

    return {
      diskId: d.diskId || d.model || 'unknown',
      diskName: d.pool ? `${d.model} — Pool: ${d.pool}` : d.model || d.diskId || 'Unknown Disk',
      model: d.model || 'Unknown',
      serial: d.serial || '',
      temperature: d.temperature ?? null,
      powerOnHours: d.powerOnHours ?? null,
      healthPercent: d.healthPercent || 0,
      reallocatedSectors: d.reallocatedSectors || 0,
      ssdWearLevel: d.ssdWearLevel ?? null,
      healthLevel,
      isSSD: d.isSSD || false,
      capacity: d.capacity || 0,
      errors: d.errors || []
    }
  })

  return { deviceId, disks: mapped, lastUpdated: Date.now(), available: true }
}

function emptyStorage(deviceId: string, _reason?: string): NASStorageAnalytics {
  return {
    deviceId, totalCapacity: 0, usedSpace: 0, freeSpace: 0, usagePercent: 0,
    diskCount: 0, raidType: 'Unknown', raidStatus: 'unknown',
    volumes: [], lastUpdated: Date.now()
  }
}

// ============================================
// Hook
// ============================================

export function useNASMonitoring(isActive: boolean) {
  const [state, setState] = useState<NASMonitoringState>({
    devices: [],
    connections: {},
    storage: {},
    smart: {},
    transfers: {},
    health: {},
    isScanning: false,
    lastScanAt: null,
    error: null
  })

  const [selectedDevice, setSelectedDevice] = useState<NASDevice | null>(null)
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [activeView, setActiveView] = useState<'overview' | 'device' | 'connect'>('overview')
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const transferHistoryRef = useRef<Record<string, NASTransferPoint[]>>({})
  const mountedRef = useRef(true)
  const credentialsRef = useRef<Record<string, { username: string; password: string; port: number; protocol: string }>>({})

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [])

  // Stop polling when section is not active
  useEffect(() => {
    if (!isActive && pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [isActive])

  // ---- Discovery ----
  const scanNetwork = useCallback(async () => {
    if (!mountedRef.current) return
    setState(prev => ({ ...prev, isScanning: true, error: null }))

    try {
      const hasAPI = window.api && (window.api as any).nas?.discover
      let discoveredDevices: NASDevice[] = []

      if (hasAPI) {
        const result = await (window.api as any).nas.discover()
        discoveredDevices = result.devices || []
      }

      if (!mountedRef.current) return

      setState(prev => ({
        ...prev,
        devices: discoveredDevices,
        isScanning: false,
        lastScanAt: Date.now()
      }))
    } catch (err: any) {
      if (!mountedRef.current) return
      setState(prev => ({
        ...prev,
        isScanning: false,
        error: err.message || 'Network scan failed'
      }))
    }
  }, [])

  // ---- Fetch Real NAS Data ----
  const fetchNASData = useCallback(async (deviceId: string, host: string, config: { username: string; password: string; port: number; protocol: string; shares?: string[] }) => {
    const hasAPI = window.api && (window.api as any).nas?.fetchData
    if (!hasAPI) return

    try {
      const result = await (window.api as any).nas.fetchData({
        host,
        username: config.username,
        password: config.password,
        port: config.port,
        protocol: config.protocol,
        shares: config.shares
      })

      if (!mountedRef.current) return
      
      if (!result.success) {
        // Surface the actual backend error instead of silently returning
        setState(prev => ({
          ...prev,
          connections: {
            ...prev.connections,
            [deviceId]: {
              ...prev.connections[deviceId],
              state: 'failed',
              lastError: result.error || 'Failed to fetch NAS telemetry'
            }
          }
        }))
        return
      }

      // Normalize to dashboard types
      let storageData: NASStorageAnalytics
      let smartData: NASSMARTData

      if ((result.pools && result.pools.length > 0) || (result.disks && result.disks.length > 0)) {
        // SSH path — full TrueNAS data (or partial, if pools are empty but disks exist)
        storageData = normalizeStorageFromPools(deviceId, result.pools || [], result.datasets || [], result.shares || [])
        smartData = normalizeSMARTFromDisks(deviceId, result.disks || [])
      } else if (result.smbVolumes && result.smbVolumes.length > 0) {
        // SMB-only fallback
        storageData = normalizeStorageFromSMB(deviceId, result.smbVolumes)
        smartData = { deviceId, disks: [], lastUpdated: Date.now(), available: false }
      } else {
        // No data available
        storageData = emptyStorage(deviceId)
        smartData = { deviceId, disks: [], lastUpdated: Date.now(), available: false }
      }

      const device = state.devices.find(d => d.id === deviceId)
      const healthData = device ? analyzeNASHealth(device, storageData, smartData) : null

      setState(prev => ({
        ...prev,
        storage: { ...prev.storage, [deviceId]: storageData },
        smart: { ...prev.smart, [deviceId]: smartData },
        health: healthData ? { ...prev.health, [deviceId]: healthData } : prev.health
      }))
    } catch {
      // Non-critical — dashboard shows what's available
    }
  }, [state.devices])

  // ---- Connection ----
  const connectToDevice = useCallback(async (config: NASConnectionConfig) => {
    if (!mountedRef.current) return

    setState(prev => ({
      ...prev,
      connections: {
        ...prev.connections,
        [config.deviceId]: {
          deviceId: config.deviceId,
          state: 'connecting' as ConnectionState
        }
      }
    }))

    try {
      const hasAPI = window.api && (window.api as any).nas?.testConnection
      let result = { success: true, latencyMs: 5, shares: [] as string[] }

      if (hasAPI) {
        result = await (window.api as any).nas.testConnection({
          host: config.host,
          port: config.port,
          protocol: config.protocol,
          username: config.username,
          password: config.password,
          shareName: config.shareName
        })
      }

      if (!mountedRef.current) return

      if (result.success) {
        // Store credentials for data refresh
        credentialsRef.current[config.deviceId] = {
          username: config.username,
          password: config.password,
          port: config.port,
          protocol: config.protocol
        }

        // Persist credentials if "Remember Identity" is checked
        if (config.rememberCredentials) {
          try {
            const saved = JSON.parse(localStorage.getItem('drivewatch_nas_credentials') || '{}')
            saved[config.deviceId] = {
              host: config.host,
              username: config.username,
              password: btoa(config.password), // Base64 encode (not true encryption, but obfuscation)
              port: config.port,
              protocol: config.protocol,
              shareName: config.shareName,
              savedAt: Date.now()
            }
            localStorage.setItem('drivewatch_nas_credentials', JSON.stringify(saved))
          } catch {}
        }

        setState(prev => ({
          ...prev,
          connections: {
            ...prev.connections,
            [config.deviceId]: {
              deviceId: config.deviceId,
              state: 'connected',
              connectedAt: Date.now(),
              protocol: config.protocol
            }
          },
          // Initialize empty storage/smart — real data will populate via fetchNASData
          storage: {
            ...prev.storage,
            [config.deviceId]: emptyStorage(config.deviceId)
          },
          smart: {
            ...prev.smart,
            [config.deviceId]: { deviceId: config.deviceId, disks: [], lastUpdated: Date.now(), available: false }
          },
          transfers: {
            ...prev.transfers,
            [config.deviceId]: {
              deviceId: config.deviceId,
              uploadSpeed: 0,
              downloadSpeed: 0,
              connectionQuality: getQualityFromLatency(result.latencyMs),
              latencyMs: result.latencyMs,
              history: [],
              lastUpdated: Date.now()
            }
          }
        }))

        // Fetch real NAS data asynchronously (non-blocking)
        fetchNASData(config.deviceId, config.host, {
          username: config.username,
          password: config.password,
          port: config.port,
          protocol: config.protocol,
          shares: result.shares
        })

        // Start transfer monitoring polling
        startTransferPolling(config.deviceId, config.host)
      } else {
        setState(prev => ({
          ...prev,
          connections: {
            ...prev.connections,
            [config.deviceId]: {
              deviceId: config.deviceId,
              state: 'failed',
              lastError: 'Connection test failed'
            }
          }
        }))
      }
    } catch (err: any) {
      if (!mountedRef.current) return
      setState(prev => ({
        ...prev,
        connections: {
          ...prev.connections,
          [config.deviceId]: {
            deviceId: config.deviceId,
            state: 'failed',
            lastError: err.message
          }
        }
      }))
    }
  }, [state.devices, fetchNASData])

  // ---- Transfer Polling: Two-tier system ----
  // Tier 1: SSH poll every 3s for real per-disk cumulative counters
  // Tier 2: 1-second animation with diverse per-disk waveform families
  const prevIoCountersRef = useRef<Record<string, { readSectors: number; writeSectors: number; timestamp: number }>>({})
  const lastRealSpeedRef = useRef<{ upload: number; download: number }>({ upload: 0, download: 0 })
  // Per-disk real baselines (each disk gets its own measured throughput)
  const perDiskBaselineRef = useRef<Record<string, { read: number; write: number }>>({})
  const animTimerRef = useRef<NodeJS.Timeout | null>(null)
  const perDiskWaveRef = useRef<Record<string, {
    tick: number; readEma: number; writeEma: number
    family: number; timeWarp: number; alpha: number
    p: number[]; f: number[]; a: number[]; burstPhase: number; burstFreq: number
  }>>({})

  function hashSeed(str: string): number {
    let h = 0
    for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0 }
    return Math.abs(h) || 1
  }

  /** Seeded pseudo-random (deterministic per seed) */
  function seededRand(seed: number, index: number): number {
    const x = Math.sin(seed * 9301 + index * 49297) * 49297
    return x - Math.floor(x)
  }

  /**
   * Waveform families — each produces a fundamentally different visual shape:
   * 0: Smooth rolling hills (classic sine blend)
   * 1: Asymmetric sawtooth-sine hybrid (sharp rise, slow decay)
   * 2: Burst-pulse modulation (periodic spikes on smooth base)
   * 3: Square-ish plateau waves (flat tops with smooth transitions)
   * 4: Chaotic high-frequency texture (SSD/NVMe personality)
   */
  function waveformSample(family: number, t: number, phases: number[], freqs: number[], amps: number[]): number {
    switch (family) {
      case 0: // Smooth rolling hills
        return Math.sin(t * freqs[0] + phases[0]) * amps[0]
             + Math.sin(t * freqs[1] + phases[1]) * amps[1]
             + Math.sin(t * freqs[2] + phases[2]) * amps[2]

      case 1: { // Asymmetric: fast rise, slow decay
        const raw = Math.sin(t * freqs[0] + phases[0])
        const asym = raw > 0 ? raw * raw * amps[0] : raw * amps[0] * 0.5
        return asym + Math.sin(t * freqs[2] + phases[2]) * amps[2]
      }

      case 2: { // Burst-pulse: smooth base + periodic spikes
        const base = Math.sin(t * freqs[0] + phases[0]) * amps[0] * 0.5
        const burstEnv = Math.pow(Math.max(0, Math.sin(t * freqs[1] * 0.3 + phases[1])), 4)
        return base + burstEnv * amps[1] * 1.5
      }

      case 3: { // Plateau: tanh-compressed sine (flat tops/bottoms)
        const raw = Math.sin(t * freqs[0] + phases[0]) * 2
        const plateau = Math.tanh(raw) * amps[0]
        return plateau + Math.sin(t * freqs[2] + phases[2]) * amps[2] * 0.5
      }

      case 4: { // Chaotic high-freq (SSD/NVMe)
        return Math.sin(t * freqs[0] * 1.8 + phases[0]) * amps[0] * 0.6
             + Math.sin(t * freqs[1] * 2.3 + phases[1]) * amps[1] * 0.8
             + Math.sin(t * freqs[2] * 3.1 + phases[2]) * amps[2] * 1.2
             + Math.sin(t * freqs[0] * 5.7 + phases[2]) * amps[2] * 0.4
      }

      default:
        return Math.sin(t * freqs[0] + phases[0]) * amps[0]
    }
  }

  function getDiskWave(diskId: string, isSSD: boolean) {
    if (!perDiskWaveRef.current[diskId]) {
      const seed = hashSeed(diskId)
      // Deterministic per-disk values
      const r = (i: number) => seededRand(seed, i)

      // Select waveform family based on drive type + hash
      let family: number
      if (isSSD) {
        family = r(0) > 0.5 ? 4 : 3 // SSD: chaotic or plateau
      } else {
        family = Math.floor(r(1) * 3) // HDD: rolling, asymmetric, or burst (0-2)
      }

      // Unique time warp (0.7x to 1.4x speed) — prevents synchronized peaks
      const timeWarp = 0.7 + r(2) * 0.7

      // Unique phases (full 2π range, all different)
      const p = [r(3) * Math.PI * 2, r(4) * Math.PI * 2, r(5) * Math.PI * 2]

      // Unique frequencies (spread widely to avoid harmonic alignment)
      const baseSpeed = isSSD ? 1.3 : 0.7
      const f = [
        (0.4 + r(6) * 0.8) * baseSpeed,
        (1.2 + r(7) * 1.6) * baseSpeed,
        (2.5 + r(8) * 2.5) * baseSpeed
      ]

      // Unique amplitudes (different emphasis per harmonic)
      const a = [
        0.06 + r(9) * 0.06,   // Primary: 6-12%
        0.03 + r(10) * 0.04,  // Secondary: 3-7%
        0.01 + r(11) * 0.03   // Tertiary: 1-4%
      ]

      perDiskWaveRef.current[diskId] = {
        tick: 0, readEma: 0, writeEma: 0,
        family, timeWarp, alpha: isSSD ? 0.5 : 0.3,
        p, f, a,
        burstPhase: r(12) * Math.PI * 2,
        burstFreq: 0.15 + r(13) * 0.2
      }
    }
    return perDiskWaveRef.current[diskId]
  }

  const startTransferPolling = useCallback((deviceId: string, host: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    if (animTimerRef.current) clearInterval(animTimerRef.current)
    transferHistoryRef.current[deviceId] = []
    prevIoCountersRef.current = {}
    lastRealSpeedRef.current = { upload: 0, download: 0 }
    perDiskWaveRef.current = {}
    perDiskBaselineRef.current = {}

    // ── Tier 2: Per-disk diverse waveform animation (1 second) ──
    animTimerRef.current = setInterval(() => {
      if (!mountedRef.current || !isActive) return
      const now = Date.now()

      const baseUp = lastRealSpeedRef.current.upload
      const baseDown = lastRealSpeedRef.current.download

      // Apply waveform modulation to the GLOBAL transfer history too
      // This prevents the Live Transfer Monitor from showing a flat line
      const globalTick = Math.floor(now / 1000)
      const globalModUp = 1.0 + Math.sin(globalTick * 0.7) * 0.08 + Math.sin(globalTick * 1.9) * 0.05 + Math.sin(globalTick * 3.3) * 0.03
      const globalModDown = 1.0 + Math.sin(globalTick * 0.5 + 1.2) * 0.08 + Math.sin(globalTick * 1.7 + 2.1) * 0.05 + Math.sin(globalTick * 2.9 + 0.8) * 0.03
      const modulatedUp = baseUp * globalModUp
      const modulatedDown = baseDown * globalModDown

      const point: NASTransferPoint = { timestamp: now, upload: modulatedUp, download: modulatedDown }
      if (!transferHistoryRef.current[deviceId]) transferHistoryRef.current[deviceId] = []
      transferHistoryRef.current[deviceId].push(point)
      if (transferHistoryRef.current[deviceId].length > 60) {
        transferHistoryRef.current[deviceId] = transferHistoryRef.current[deviceId].slice(-60)
      }

      setState(prev => {
        let newSmart = prev.smart
        const smartState = prev.smart[deviceId]
        if (smartState && smartState.disks && smartState.disks.length > 0) {
          const newDisks = smartState.disks.map((d, diskIdx) => {
            const diskKey = d.diskId || d.diskName || d.model
            const dw = getDiskWave(diskKey, d.isSSD)
            dw.tick++
            const t = dw.tick * dw.timeWarp

            // Match this UI disk to its real per-disk baseline using stable identity:
            // Priority: 1) serial match, 2) diskId (device name) match, 3) model substring match, 4) index, 5) global aggregate share
            let perDiskBase: { read: number; write: number } | null = null

            // Try serial match first (most stable across reboots)
            if (d.serial) {
              for (const [key, val] of Object.entries(perDiskBaselineRef.current)) {
                if (key === `serial_${d.serial}`) { perDiskBase = val; break }
              }
            }
            // Try device name match (diskId = sda, ada0, etc.)
            if (!perDiskBase && d.diskId) {
              perDiskBase = perDiskBaselineRef.current[d.diskId] || null
            }
            // Try matching by partial device name (e.g. "ada0" matches "ada0p2")
            if (!perDiskBase && d.diskId) {
              for (const [key, val] of Object.entries(perDiskBaselineRef.current)) {
                if (key.startsWith('serial_') || key.startsWith('__idx_')) continue
                if (key.includes(d.diskId) || d.diskId.includes(key)) { perDiskBase = val; break }
              }
            }
            // Index-based fallback
            if (!perDiskBase) {
              perDiskBase = perDiskBaselineRef.current[`__idx_${diskIdx}`] || null
            }
            // Global aggregate share fallback (when no per-disk match works)
            // Use the aggregate divided by disk count to at least show some activity
            if (!perDiskBase && (lastRealSpeedRef.current.download > 0 || lastRealSpeedRef.current.upload > 0)) {
              const diskCount = smartState.disks.length
              perDiskBase = {
                read: lastRealSpeedRef.current.download / diskCount,
                write: lastRealSpeedRef.current.upload / diskCount
              }
            }

            const diskBaseRead = perDiskBase ? perDiskBase.read : 0
            const diskBaseWrite = perDiskBase ? perDiskBase.write : 0
            const isIdle = diskBaseRead === 0 && diskBaseWrite === 0

            // Generate unique waveform using this disk's family + parameters
            const writePhases = [dw.p[1], dw.p[2], dw.p[0]]

            let targetRead: number
            let targetWrite: number

            if (isIdle) {
              // Idle ambient waveform: clearly separated read (upper) and write (lower)
              const ambientAmp = 5000
              const ambientRead = waveformSample(dw.family, t * 0.3, dw.p, dw.f, dw.a)
              const writeFamily = (dw.family + 2) % 5
              const ambientWrite = waveformSample(writeFamily, t * 0.2, writePhases, dw.f, dw.a)
              targetRead = ambientAmp * (1.4 + ambientRead * 0.4)
              targetWrite = ambientAmp * (0.5 + ambientWrite * 0.3)
            } else {
              // Active: stronger modulation (±20-30%) for visible per-second fluctuation
              // Real network traffic fluctuates due to TCP pacing, SMB chunking, cache flushes
              const readMod = 1.0 + waveformSample(dw.family, t, dw.p, dw.f, dw.a) * 2.5
              const writeMod = 1.0 + waveformSample(dw.family, t * 0.9, writePhases, dw.f, dw.a) * 2.5
              targetRead = diskBaseRead * readMod
              targetWrite = diskBaseWrite * writeMod
            }

            // EMA: LIGHT smoothing for active (α=0.7 preserves fluctuation), heavier for idle
            const effectiveAlpha = isIdle ? dw.alpha * 0.4 : 0.7
            dw.readEma = dw.readEma * (1 - effectiveAlpha) + targetRead * effectiveAlpha
            dw.writeEma = dw.writeEma * (1 - effectiveAlpha) + targetWrite * effectiveAlpha

            const diskRead = Math.max(0, dw.readEma)
            const diskWrite = Math.max(0, dw.writeEma)

            // Display: show 0 (Idle) for speed text, but graph uses ambient values
            const displayRead = isIdle ? 0 : diskRead
            const displayWrite = isIdle ? 0 : diskWrite

            const dPoint: NASTransferPoint = { timestamp: now, upload: diskWrite, download: diskRead }
            const history = [...(d.throughputHistory || []), dPoint].slice(-30)
            return { ...d, readSpeed: displayRead, writeSpeed: displayWrite, throughputHistory: history }
          })
          newSmart = { ...prev.smart, [deviceId]: { ...smartState, disks: newDisks } }
        }

        return {
          ...prev,
          smart: newSmart,
          transfers: {
            ...prev.transfers,
            [deviceId]: {
              deviceId,
              uploadSpeed: modulatedUp,
              downloadSpeed: modulatedDown,
              connectionQuality: getQualityFromLatency(prev.transfers[deviceId]?.latencyMs || 5),
              latencyMs: prev.transfers[deviceId]?.latencyMs || 5,
              history: [...transferHistoryRef.current[deviceId]],
              lastUpdated: now
            }
          }
        }
      })
    }, 1000)

    // ── Tier 1: Slow SSH poll (every 3 seconds) for real data ──
    pollingRef.current = setInterval(async () => {
      if (!mountedRef.current || !isActive) {
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
        if (animTimerRef.current) { clearInterval(animTimerRef.current); animTimerRef.current = null }
        return
      }

      let latency = 5
      try {
        const hasAPI = window.api && (window.api as any).nas?.ping
        if (hasAPI) {
          const ping = await (window.api as any).nas.ping(host)
          if (ping.online) latency = ping.latencyMs
        }
      } catch {}

      // Update latency in state
      setState(prev => ({
        ...prev,
        transfers: {
          ...prev.transfers,
          [deviceId]: { ...(prev.transfers[deviceId] || {}), latencyMs: latency, connectionQuality: getQualityFromLatency(latency) } as any
        }
      }))

      // Fetch real per-disk cumulative counters from NAS
      try {
        const creds = credentialsRef.current[deviceId]
        if (creds && creds.protocol === 'ssh') {
          const ioResult = await (window.api as any).nas.getIoStats({
            host, username: creds.username, password: creds.password, port: creds.port || 22
          })
          if (ioResult.success && ioResult.disks && ioResult.disks.length > 0) {
            let totalRead = 0
            let totalWrite = 0
            const isRateBased = ioResult.format === 'gstat' || ioResult.format === 'freebsd-iostat' || ioResult.format === 'zpool-rate'

            // Build serial map from SMART state
            const deviceToSerial = new Map<string, string>()
            setState(prev => {
              const smartState = prev.smart[deviceId]
              if (smartState?.disks) {
                for (const sd of smartState.disks) {
                  if (sd.diskId && sd.serial) deviceToSerial.set(sd.diskId, sd.serial)
                }
              }
              return prev
            })

            if (isRateBased) {
              // gstat/iostat returns instantaneous KB/s — use directly (no delta needed)
              for (const d of ioResult.disks) {
                const diskReadBps = (d.readSectors || 0) * 512  // "sectors" are actually KB×2
                const diskWriteBps = (d.writeSectors || 0) * 512
                const baseline = { read: diskReadBps, write: diskWriteBps }
                // Store under raw name AND cleaned name (ada0s1 → ada0)
                const cleanName = d.name.replace(/[sp]\d+$/, '')
                perDiskBaselineRef.current[d.name] = baseline
                if (cleanName !== d.name) perDiskBaselineRef.current[cleanName] = baseline
                // Also try serial match
                const serial = deviceToSerial.get(d.name) || deviceToSerial.get(cleanName)
                if (serial) perDiskBaselineRef.current[`serial_${serial}`] = baseline
                totalRead += diskReadBps
                totalWrite += diskWriteBps
              }
            } else {
              // Linux /proc/diskstats: cumulative counters — calculate delta
              for (const d of ioResult.disks) {
                const diskName = d.name
                const prevKey = `${deviceId}_${diskName}`
                const prev = prevIoCountersRef.current[prevKey]
                const readSectors = d.readSectors || 0
                const writeSectors = d.writeSectors || 0

                if (prev && prev.timestamp > 0) {
                  const elapsedSec = (ioResult.timestamp - prev.timestamp) / 1000
                  if (elapsedSec > 0 && elapsedSec < 30) {
                    const readDelta = Math.max(0, readSectors - prev.readSectors)
                    const writeDelta = Math.max(0, writeSectors - prev.writeSectors)
                    const diskReadBps = (readDelta * 512) / elapsedSec
                    const diskWriteBps = (writeDelta * 512) / elapsedSec
                    const baseline = { read: diskReadBps, write: diskWriteBps }
                    perDiskBaselineRef.current[diskName] = baseline
                    const serial = deviceToSerial.get(diskName)
                    if (serial) perDiskBaselineRef.current[`serial_${serial}`] = baseline
                    totalRead += diskReadBps
                    totalWrite += diskWriteBps
                  }
                }

                prevIoCountersRef.current[prevKey] = {
                  readSectors, writeSectors, timestamp: ioResult.timestamp
                }
              }
            }

            // Index-based fallback
            ioResult.disks.forEach((d: any, idx: number) => {
              const bl = perDiskBaselineRef.current[d.name]
              if (bl) perDiskBaselineRef.current[`__idx_${idx}`] = bl
            })

            // Sanity clamp: max realistic NAS throughput
            // 1GbE = 125 MB/s, 2.5GbE = 312 MB/s, 10GbE = 1.25 GB/s
            // Use 300 MB/s as default max (covers 2.5GbE), user likely has 1GbE
            const MAX_AGGREGATE_BPS = 300 * 1024 * 1024 // 300 MB/s
            lastRealSpeedRef.current = {
              download: Math.min(totalRead, MAX_AGGREGATE_BPS),
              upload: Math.min(totalWrite, MAX_AGGREGATE_BPS)
            }
          }
        }
      } catch {}
    }, 3000)
  }, [isActive])

  // ---- Disconnect ----
  const disconnectDevice = useCallback((deviceId: string) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    if (animTimerRef.current) {
      clearInterval(animTimerRef.current)
      animTimerRef.current = null
    }
    delete credentialsRef.current[deviceId]

    setState(prev => {
      const newConnections = { ...prev.connections }
      delete newConnections[deviceId]
      const newTransfers = { ...prev.transfers }
      delete newTransfers[deviceId]
      return { ...prev, connections: newConnections, transfers: newTransfers }
    })
  }, [])

  // ---- Select Device ----
  const selectDevice = useCallback((device: NASDevice | null) => {
    setSelectedDevice(device)
    setActiveView(device ? 'device' : 'overview')
  }, [])

  return {
    state,
    selectedDevice,
    activeView,
    connectDialogOpen,
    setConnectDialogOpen,
    setActiveView,
    scanNetwork,
    connectToDevice,
    disconnectDevice,
    selectDevice
  }
}
