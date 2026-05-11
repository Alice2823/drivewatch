// ============================================
// NAS MONITORING - Main Process Service
// Isolated module: does NOT modify existing services
// Handles network discovery, connection, and data collection
// ============================================

import { exec } from 'child_process'
import { promisify } from 'util'
import * as net from 'net'
import * as os from 'os'

const execAsync = promisify(exec)

// ============================================
// Network Helpers
// ============================================

function getLocalSubnet(): string {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name]
    if (!iface) continue
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const parts = addr.address.split('.')
        return `${parts[0]}.${parts[1]}.${parts[2]}`
      }
    }
  }
  return '192.168.1'
}

function generateId(): string {
  return `nas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================
// Port Scan (Lightweight single-port TCP probe)
// ============================================

function probePort(ip: string, port: number, timeoutMs = 1500): Promise<{ open: boolean; latencyMs: number }> {
  return new Promise((resolve) => {
    const start = Date.now()
    const socket = new net.Socket()
    let resolved = false

    const finish = (open: boolean) => {
      if (resolved) return
      resolved = true
      socket.destroy()
      resolve({ open, latencyMs: Date.now() - start })
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, ip)
  })
}

// ============================================
// Vendor Detection via known ports & banners
// ============================================

interface DetectedDevice {
  ip: string
  name: string
  vendor: string
  latencyMs: number
  port: number
  shares: string[]
}

async function detectVendor(ip: string): Promise<DetectedDevice | null> {
  // Ports commonly used by NAS devices
  const checks = [
    { port: 445, vendor: 'SMB' },       // SMB/CIFS
    { port: 5000, vendor: 'Synology' },  // Synology DSM HTTP
    { port: 8080, vendor: 'QNAP' },     // QNAP HTTP
    { port: 80, vendor: 'Generic' },     // Generic HTTP NAS admin
    { port: 443, vendor: 'Generic' },    // HTTPS
    { port: 22, vendor: 'Generic' },     // SSH
  ]

  let bestResult: { port: number; vendor: string; latencyMs: number } | null = null

  // Probe all ports concurrently with tight timeout
  const results = await Promise.all(
    checks.map(async (c) => {
      const r = await probePort(ip, c.port, 1200)
      return { ...c, ...r }
    })
  )

  for (const r of results) {
    if (r.open) {
      // Prioritize NAS-specific ports
      if (r.port === 5000) {
        bestResult = { port: r.port, vendor: 'Synology', latencyMs: r.latencyMs }
        break
      }
      if (r.port === 8080 && (!bestResult || bestResult.vendor === 'SMB' || bestResult.vendor === 'Generic')) {
        bestResult = { port: r.port, vendor: 'QNAP', latencyMs: r.latencyMs }
      }
      if (r.port === 445 && !bestResult) {
        bestResult = { port: r.port, vendor: 'SMB', latencyMs: r.latencyMs }
      }
      if (!bestResult) {
        bestResult = { port: r.port, vendor: r.vendor, latencyMs: r.latencyMs }
      }
    }
  }

  if (!bestResult) return null

  // Try to resolve hostname
  let hostname = ip
  try {
    const { stdout } = await execAsync(`nslookup ${ip} 2>nul`, { timeout: 3000 })
    const nameMatch = stdout.match(/Name:\s+(\S+)/i)
    if (nameMatch) hostname = nameMatch[1]
  } catch { /* nslookup failure is non-critical */ }

  // Try to detect TrueNAS via HTTP banner (optional, best-effort)
  let vendor = bestResult.vendor
  if (bestResult.port === 80 || bestResult.port === 443) {
    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://${ip}' -TimeoutSec 2 -UseBasicParsing).Content.Substring(0,500) } catch { '' }"`,
        { timeout: 5000 }
      )
      if (stdout.toLowerCase().includes('truenas') || stdout.toLowerCase().includes('freenas')) {
        vendor = 'TrueNAS'
      }
    } catch { /* banner detection failure is non-critical */ }
  }

  // Try to enumerate SMB shares (best-effort)
  let shares: string[] = []
  if (results.some(r => r.port === 445 && r.open)) {
    try {
      const { stdout } = await execAsync(
        `net view \\\\${ip} /all 2>nul`,
        { timeout: 5000 }
      )
      const shareLines = stdout.split('\n').filter(l => l.includes('Disk'))
      shares = shareLines.map(l => l.trim().split(/\s{2,}/)[0]).filter(Boolean)
    } catch { /* share enumeration failure is non-critical */ }
  }

  return {
    ip,
    name: hostname !== ip ? hostname : `NAS-${ip.split('.').pop()}`,
    vendor,
    latencyMs: bestResult.latencyMs,
    port: bestResult.port,
    shares
  }
}

// ============================================
// NAS Discovery Scanner
// ============================================

export async function discoverNASDevices(): Promise<{
  devices: any[]
  scanDurationMs: number
  networkRange: string
  error?: string
}> {
  const startTime = Date.now()
  const subnet = getLocalSubnet()
  const networkRange = `${subnet}.1-254`

  try {
    // First, try ARP table for fast known-host detection
    let knownHosts: string[] = []
    try {
      const { stdout } = await execAsync('arp -a', { timeout: 5000 })
      const arpLines = stdout.split('\n')
      for (const line of arpLines) {
        const match = line.match(/(\d+\.\d+\.\d+\.\d+)/)
        if (match && match[1].startsWith(subnet + '.')) {
          knownHosts.push(match[1])
        }
      }
    } catch { /* ARP failure is non-critical, we'll scan sequentially */ }

    // Filter out local machine
    const localIPs = new Set<string>()
    const interfaces = os.networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name]
      if (!iface) continue
      for (const addr of iface) {
        if (addr.family === 'IPv4') localIPs.add(addr.address)
      }
    }

    const candidates = knownHosts.filter(ip => !localIPs.has(ip))

    // If ARP gave us nothing, do a targeted scan of common NAS IPs
    if (candidates.length === 0) {
      // Scan a limited range to avoid aggressive behavior
      for (let i = 1; i <= 254; i++) {
        candidates.push(`${subnet}.${i}`)
      }
    }

    // Probe candidates in batches (max 20 concurrent to be network-friendly)
    const batchSize = 20
    const devices: any[] = []

    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(ip => detectVendor(ip).catch(() => null))
      )
      for (const result of batchResults) {
        if (result) {
          devices.push({
            id: generateId(),
            name: result.name,
            ip: result.ip,
            port: result.port,
            vendor: result.vendor,
            status: 'online',
            latencyMs: result.latencyMs,
            hostname: result.name,
            lastSeen: Date.now(),
            discoveredAt: Date.now(),
            shares: result.shares
          })
        }
      }
    }

    return {
      devices,
      scanDurationMs: Date.now() - startTime,
      networkRange
    }

  } catch (err: any) {
    return {
      devices: [],
      scanDurationMs: Date.now() - startTime,
      networkRange,
      error: err.message
    }
  }
}

// ============================================
// NAS Connection Test
// ============================================

export async function testNASConnection(config: {
  host: string
  port: number
  protocol: string
  username?: string
  password?: string
  shareName?: string
}): Promise<{
  success: boolean
  latencyMs: number
  serverInfo?: string
  shares?: string[]
  error?: string
}> {
  const start = Date.now()

  try {
    if (config.protocol === 'smb') {
      // Test SMB connectivity
      const probe = await probePort(config.host, 445, 3000)
      if (!probe.open) {
        return { success: false, latencyMs: probe.latencyMs, error: 'SMB port (445) is not accessible' }
      }

      // Try net view for share enumeration
      let shares: string[] = []
      try {
        const { stdout } = await execAsync(`net view \\\\${config.host} /all 2>nul`, { timeout: 5000 })
        const shareLines = stdout.split('\n').filter(l => l.includes('Disk'))
        shares = shareLines.map(l => l.trim().split(/\s{2,}/)[0]).filter(Boolean)
      } catch { /* share enumeration is optional */ }

      // If credentials provided, test authentication
      if (config.username && config.shareName) {
        try {
          const cmd = `net use \\\\${config.host}\\${config.shareName} /user:${config.username} ${config.password || ''} /persistent:no 2>&1`
          await execAsync(cmd, { timeout: 8000 })
          // Disconnect after test
          try { await execAsync(`net use \\\\${config.host}\\${config.shareName} /delete /y 2>nul`, { timeout: 3000 }) } catch {}
          return {
            success: true,
            latencyMs: Date.now() - start,
            serverInfo: `SMB Server at ${config.host}`,
            shares
          }
        } catch (err: any) {
          return {
            success: false,
            latencyMs: Date.now() - start,
            error: err.stderr || err.message || 'Authentication failed'
          }
        }
      }

      return {
        success: true,
        latencyMs: probe.latencyMs,
        serverInfo: `SMB Server at ${config.host}`,
        shares
      }

    } else if (config.protocol === 'ssh') {
      // Test SSH connectivity
      const probe = await probePort(config.host, config.port || 22, 3000)
      return {
        success: probe.open,
        latencyMs: probe.latencyMs,
        serverInfo: probe.open ? `SSH Server at ${config.host}:${config.port || 22}` : undefined,
        error: probe.open ? undefined : 'SSH port is not accessible'
      }
    }

    return { success: false, latencyMs: Date.now() - start, error: 'Unsupported protocol' }

  } catch (err: any) {
    return { success: false, latencyMs: Date.now() - start, error: err.message }
  }
}

// ============================================
// NAS Storage Info (via SMB / PowerShell)
// ============================================

export async function getNASStorageInfo(host: string, shareName?: string): Promise<{
  totalCapacity: number
  usedSpace: number
  freeSpace: number
  usagePercent: number
  error?: string
}> {
  try {
    // Use PowerShell to query remote share space
    const target = shareName ? `\\\\${host}\\${shareName}` : `\\\\${host}`
    const psCmd = `
      $drive = New-Object System.IO.DriveInfo("${target}")
      @{
        TotalSize = $drive.TotalSize
        AvailableFreeSpace = $drive.AvailableFreeSpace
      } | ConvertTo-Json
    `

    // Fallback: use net use + fsutil or wmic
    // Try simpler approach: map and query
    try {
      if (shareName) {
        const { stdout } = await execAsync(
          `powershell -NoProfile -Command "try { $s = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -like '*${host}*' }; if ($s) { @{ Used=$s.Used; Free=$s.Free } | ConvertTo-Json } else { 'null' } } catch { 'null' }"`,
          { timeout: 8000 }
        )
        if (stdout.trim() !== 'null') {
          const data = JSON.parse(stdout.trim())
          const used = data.Used || 0
          const free = data.Free || 0
          const total = used + free
          return {
            totalCapacity: total,
            usedSpace: used,
            freeSpace: free,
            usagePercent: total > 0 ? Math.round((used / total) * 100) : 0
          }
        }
      }
    } catch { /* fallback below */ }

    // Fallback: just ping-check and return simulated data
    const probe = await probePort(host, 445, 2000)
    if (!probe.open) {
      return { totalCapacity: 0, usedSpace: 0, freeSpace: 0, usagePercent: 0, error: 'Device not reachable' }
    }

    return {
      totalCapacity: 0,
      usedSpace: 0,
      freeSpace: 0,
      usagePercent: 0,
      error: 'Storage info requires mapped share'
    }

  } catch (err: any) {
    return { totalCapacity: 0, usedSpace: 0, freeSpace: 0, usagePercent: 0, error: err.message }
  }
}

// ============================================
// NAS Ping / Latency Check
// ============================================

export async function pingNASDevice(host: string): Promise<{
  online: boolean
  latencyMs: number
}> {
  // TCP probe to SMB port is more reliable than ICMP in most networks
  const result = await probePort(host, 445, 2000)
  if (result.open) return { online: true, latencyMs: result.latencyMs }

  // Fallback to other common ports
  const altPorts = [22, 80, 443, 5000, 8080]
  for (const port of altPorts) {
    const alt = await probePort(host, port, 1500)
    if (alt.open) return { online: true, latencyMs: alt.latencyMs }
  }

  return { online: false, latencyMs: -1 }
}
