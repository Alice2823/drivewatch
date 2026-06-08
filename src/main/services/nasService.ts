// ============================================
// NAS MONITORING - Enterprise Hybrid Discovery Engine
// Active scanning + Passive mDNS/SSDP + MAC vendor + Persistent cache
// ============================================

import { exec } from 'child_process'
import { promisify } from 'util'
import * as net from 'net'
import * as dgram from 'dgram'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

const execAsync = promisify(exec)

// ============================================
// Types
// ============================================

export interface NASDevice {
  id: string
  ip: string
  name: string
  vendor: string
  type: string
  status: 'online' | 'offline'
  latencyMs: number
  hostname: string
  mac: string | null
  macVendor: string | null
  lastSeen: number
  discoveredAt: number
  discoveryMethod: string
  confidence: number // 0-100
  shares: string[]
  smbAvailable: boolean
  sshAvailable: boolean
  httpAvailable: boolean
  webPortalUrl: string | null
  services: { port: number; service: string; open: boolean }[]
}

interface AdapterInfo {
  name: string
  ip: string
  netmask: string
  subnet: string
  cidr: number
  priority: number
}

interface DiscoveryDiagnostics {
  adapterUsed: string
  subnetScanned: string
  hostsScanned: number
  hostsAlive: number
  devicesFound: number
  scanDurationMs: number
  protocols: string[]
  mdnsResponses: number
  ssdpResponses: number
  arpEntries: number
}

// ============================================
// MAC Vendor OUI Database (Top NAS manufacturers)
// ============================================

const MAC_VENDORS: Record<string, string> = {
  '00:11:32': 'Synology',
  '00:09:B0': 'Synology',
  '00:1B:FC': 'Synology',
  '00:24:1D': 'QNAP',
  '24:5E:BE': 'QNAP',
  '00:08:9B': 'QNAP',
  'AC:15:A2': 'QNAP',
  '00:0E:2E': 'Edimax',
  '00:14:D1': 'TRENDnet',
  '00:1F:1F': 'Edimax',
  '28:C6:8E': 'Netgear',
  'A0:40:A0': 'Netgear',
  '9C:3D:CF': 'Netgear',
  '00:26:F2': 'Netgear',
  'C4:04:15': 'Netgear',
  '00:1E:2A': 'Netgear',
  '00:22:3F': 'Netgear',
  '10:0C:6B': 'Netgear',
  '00:1B:2F': 'Netgear',
  '00:1F:33': 'Netgear',
  '00:24:B2': 'Netgear',
  '20:E5:2A': 'Netgear',
  '6C:B0:CE': 'Netgear',
  '00:14:6C': 'Netgear',
  'B0:48:7A': 'Asustor',
  '00:0E:0C': 'Intel',
  '00:1B:21': 'Intel',
  '3C:97:0E': 'WD (Western Digital)',
  '00:90:A9': 'WD (Western Digital)',
  'DC:A6:32': 'Raspberry Pi',
  'B8:27:EB': 'Raspberry Pi',
  'E4:5F:01': 'Raspberry Pi',
  '00:50:56': 'VMware',
  '00:0C:29': 'VMware',
  '08:00:27': 'VirtualBox',
}

function lookupMacVendor(mac: string): string | null {
  if (!mac) return null
  const prefix = mac.toUpperCase().replace(/-/g, ':').substring(0, 8)
  return MAC_VENDORS[prefix] || null
}

// ============================================
// Smart Adapter Selection
// ============================================

const EXCLUDED_ADAPTERS = /tailscale|vpn|hyper-v|docker|vmware|virtualbox|vbox|wsl|loopback|vethernet|isatap|teredo|6to4|bluetooth|ham|pseudo|tunnel/i

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts[0] === 10) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  return false
}

function getActiveAdapters(): AdapterInfo[] {
  const interfaces = os.networkInterfaces()
  const adapters: AdapterInfo[] = []

  for (const [name, iface] of Object.entries(interfaces)) {
    if (!iface) continue
    if (EXCLUDED_ADAPTERS.test(name)) continue

    for (const addr of iface) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      if (!isPrivateIPv4(addr.address)) continue

      const parts = addr.address.split('.').map(Number)
      const maskParts = addr.netmask.split('.').map(Number)
      const subnetParts = parts.map((p, i) => p & maskParts[i])
      const subnet = subnetParts.join('.')
      const cidr = maskParts.reduce((acc, octet) =>
        acc + (octet >>> 0).toString(2).replace(/0/g, '').length, 0)

      let priority = 50
      const ln = name.toLowerCase()
      if (ln.includes('ethernet') || ln.includes('eth') || ln.includes('lan')) priority = 10
      else if (ln.includes('wi-fi') || ln.includes('wifi') || ln.includes('wlan')) priority = 20
      else if (ln.includes('usb')) priority = 30
      if (parts[0] === 192 && parts[1] === 168) priority -= 5
      else if (parts[0] === 10) priority -= 3

      adapters.push({ name, ip: addr.address, netmask: addr.netmask, subnet, cidr, priority })
    }
  }
  return adapters.sort((a, b) => a.priority - b.priority)
}

function getBestAdapter(): AdapterInfo | null {
  const adapters = getActiveAdapters()
  return adapters.length > 0 ? adapters[0] : null
}

function getSubnetHosts(adapter: AdapterInfo): string[] {
  const hosts: string[] = []
  const parts = adapter.subnet.split('.').map(Number)
  // For /24 networks (most common home/office)
  if (adapter.cidr >= 24) {
    const base = `${parts[0]}.${parts[1]}.${parts[2]}`
    for (let i = 1; i <= 254; i++) {
      const ip = `${base}.${i}`
      if (ip !== adapter.ip) hosts.push(ip)
    }
  } else if (adapter.cidr >= 20) {
    // /20 = 4094 hosts — scan only common NAS ranges
    const base = `${parts[0]}.${parts[1]}`
    const startThird = parts[2]
    for (let t = startThird; t < startThird + 16 && t <= 255; t++) {
      for (let i = 1; i <= 254; i++) {
        const ip = `${base}.${t}.${i}`
        if (ip !== adapter.ip) hosts.push(ip)
      }
    }
  } else {
    // /16 or larger — only scan local /24
    const base = adapter.ip.split('.').slice(0, 3).join('.')
    for (let i = 1; i <= 254; i++) {
      const ip = `${base}.${i}`
      if (ip !== adapter.ip) hosts.push(ip)
    }
  }
  return hosts
}

// ============================================
// Gateway Detection (Router Filtering)
// ============================================

let cachedGateway: string | null = null

async function getGatewayIP(): Promise<string | null> {
  if (cachedGateway) return cachedGateway
  try {
    const { stdout } = await execAsync(
      'powershell -NoProfile -Command "(Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Select-Object -First 1).NextHop"',
      { timeout: 3000, windowsHide: true }
    )
    const gw = stdout.trim()
    if (/^\d+\.\d+\.\d+\.\d+$/.test(gw)) {
      cachedGateway = gw
      return gw
    }
  } catch {}
  try {
    const { stdout } = await execAsync('ipconfig', { timeout: 3000, windowsHide: true })
    const gwMatch = stdout.match(/Default Gateway[.\s]*:\s*(\d+\.\d+\.\d+\.\d+)/i)
    if (gwMatch) { cachedGateway = gwMatch[1]; return gwMatch[1] }
  } catch {}
  return null
}

// ============================================
// Port Scanner
// ============================================

const NAS_PORTS = [
  { port: 445, service: 'smb' },
  { port: 139, service: 'netbios' },
  { port: 22, service: 'ssh' },
  { port: 80, service: 'http' },
  { port: 443, service: 'https' },
  { port: 5000, service: 'synology' },
  { port: 5001, service: 'synology-https' },
  { port: 8080, service: 'openmediavault' },
  { port: 9000, service: 'truenas' },
]

function probePort(ip: string, port: number, timeoutMs = 800): Promise<{ open: boolean; latencyMs: number }> {
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

async function isHostAlive(ip: string): Promise<{ alive: boolean; latencyMs: number }> {
  const smb = await probePort(ip, 445, 400)
  if (smb.open) return { alive: true, latencyMs: smb.latencyMs }
  const ssh = await probePort(ip, 22, 400)
  if (ssh.open) return { alive: true, latencyMs: ssh.latencyMs }
  const http = await probePort(ip, 80, 350)
  if (http.open) return { alive: true, latencyMs: http.latencyMs }
  return { alive: false, latencyMs: -1 }
}

// ============================================
// mDNS / Bonjour Discovery (Passive)
// ============================================

function discoverViaMdns(timeoutMs = 3000): Promise<{ ip: string; name: string; service: string }[]> {
  return new Promise((resolve) => {
    const results: { ip: string; name: string; service: string }[] = []
    const seen = new Set<string>()

    try {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

      socket.on('error', () => { socket.close(); resolve(results) })

      socket.on('message', (msg, rinfo) => {
        if (seen.has(rinfo.address)) return
        try {
          const str = msg.toString('utf8')
          // Look for NAS-related service names in mDNS responses
          let service = ''
          if (str.includes('_smb._tcp') || str.includes('_afpovertcp._tcp')) service = 'smb'
          else if (str.includes('_http._tcp')) service = 'http'
          else if (str.includes('_ssh._tcp')) service = 'ssh'
          else if (str.includes('_nfs._tcp')) service = 'nfs'
          else if (str.includes('_device-info._tcp')) service = 'device-info'
          else if (str.includes('_webdav._tcp')) service = 'webdav'

          if (service) {
            seen.add(rinfo.address)
            // Extract hostname from mDNS packet (simplified)
            const nameMatch = str.match(/([a-zA-Z0-9_-]+)\._/)
            const name = nameMatch ? nameMatch[1] : `mDNS-${rinfo.address.split('.').pop()}`
            results.push({ ip: rinfo.address, name, service })
          }
        } catch {}
      })

      socket.bind(0, () => {
        // Send mDNS query for SMB services
        const query = Buffer.alloc(45)
        query.writeUInt16BE(0, 0)      // Transaction ID
        query.writeUInt16BE(0, 2)      // Flags (standard query)
        query.writeUInt16BE(1, 4)      // Questions: 1
        // _smb._tcp.local query (simplified)
        const qname = Buffer.from('\x04_smb\x04_tcp\x05local\x00', 'binary')
        qname.copy(query, 12)
        query.writeUInt16BE(255, 12 + qname.length)  // QTYPE: ANY
        query.writeUInt16BE(1, 12 + qname.length + 2) // QCLASS: IN

        try {
          socket.send(query, 0, query.length, 5353, '224.0.0.251')
        } catch {}
      })

      setTimeout(() => { try { socket.close() } catch {}; resolve(results) }, timeoutMs)
    } catch {
      resolve(results)
    }
  })
}

// ============================================
// SSDP / UPnP Discovery (Passive)
// ============================================

function discoverViaSsdp(timeoutMs = 3000): Promise<{ ip: string; server: string; location: string }[]> {
  return new Promise((resolve) => {
    const results: { ip: string; server: string; location: string }[] = []
    const seen = new Set<string>()

    try {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

      socket.on('error', () => { socket.close(); resolve(results) })

      socket.on('message', (msg, rinfo) => {
        if (seen.has(rinfo.address)) return
        try {
          const str = msg.toString('utf8')
          const serverMatch = str.match(/SERVER:\s*(.+)/i)
          const locationMatch = str.match(/LOCATION:\s*(.+)/i)
          const server = serverMatch ? serverMatch[1].trim() : ''
          const location = locationMatch ? locationMatch[1].trim() : ''

          // Filter for NAS/storage-related SSDP responses
          const isNasLike = /synology|qnap|truenas|nas|storage|media|samba|smb|disk/i.test(server + location)
          const isServer = /linux|freebsd|debian|ubuntu/i.test(server)

          if (isNasLike || isServer || location.includes(':5000') || location.includes(':8080')) {
            seen.add(rinfo.address)
            results.push({ ip: rinfo.address, server, location })
          }
        } catch {}
      })

      socket.bind(0, () => {
        const ssdpMsg = Buffer.from(
          'M-SEARCH * HTTP/1.1\r\n' +
          'HOST: 239.255.255.250:1900\r\n' +
          'MAN: "ssdp:discover"\r\n' +
          'MX: 2\r\n' +
          'ST: ssdp:all\r\n' +
          '\r\n'
        )
        try {
          socket.send(ssdpMsg, 0, ssdpMsg.length, 1900, '239.255.255.250')
        } catch {}
      })

      setTimeout(() => { try { socket.close() } catch {}; resolve(results) }, timeoutMs)
    } catch {
      resolve(results)
    }
  })
}

// ============================================
// ARP + MAC Resolution
// ============================================

async function getArpTable(subnetPrefix: string): Promise<Map<string, string>> {
  const arpMap = new Map<string, string>() // ip -> mac
  try {
    const { stdout } = await execAsync('arp -a', { timeout: 3000, windowsHide: true })
    for (const line of stdout.split('\n')) {
      const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([\da-f]{2}[:-][\da-f]{2}[:-][\da-f]{2}[:-][\da-f]{2}[:-][\da-f]{2}[:-][\da-f]{2})/i)
      if (match && match[1].startsWith(subnetPrefix + '.')) {
        arpMap.set(match[1], match[2].replace(/-/g, ':').toUpperCase())
      }
    }
  } catch {}
  return arpMap
}

// ============================================
// Device Identification (Deep Probe)
// ============================================

async function identifyDevice(ip: string, mac: string | null, gateway: string | null): Promise<NASDevice | null> {
  // Skip gateway
  if (gateway && ip === gateway) return null

  const portResults = await Promise.all(
    NAS_PORTS.map(async (p) => {
      const result = await probePort(ip, p.port, 700)
      return { ...p, open: result.open, latencyMs: result.latencyMs }
    })
  )

  const openPorts = portResults.filter(r => r.open)
  if (openPorts.length === 0) return null

  const bestLatency = Math.min(...openPorts.map(p => p.latencyMs))
  const smbAvailable = openPorts.some(p => p.service === 'smb' || p.service === 'netbios')
  const sshAvailable = openPorts.some(p => p.service === 'ssh')
  const httpAvailable = openPorts.some(p => ['http', 'https', 'synology', 'synology-https', 'openmediavault', 'truenas'].includes(p.service))

  // Vendor detection from ports
  let vendor = 'Unknown'
  let type = 'Network Device'
  let confidence = 30
  let webPortalUrl: string | null = null
  let discoveryMethod = 'port-scan'

  if (openPorts.some(p => p.service === 'synology' || p.service === 'synology-https')) {
    vendor = 'Synology'; type = 'NAS'; confidence = 85
    webPortalUrl = `http://${ip}:5000`
  } else if (openPorts.some(p => p.service === 'openmediavault')) {
    vendor = 'OpenMediaVault'; type = 'NAS'; confidence = 75
    webPortalUrl = `http://${ip}:8080`
  } else if (openPorts.some(p => p.service === 'truenas')) {
    vendor = 'TrueNAS'; type = 'NAS'; confidence = 75
    webPortalUrl = `http://${ip}:9000`
  } else if (smbAvailable && sshAvailable) {
    vendor = 'Linux NAS'; type = 'NAS'; confidence = 60
  } else if (smbAvailable) {
    vendor = 'SMB Server'; type = 'File Server'; confidence = 50
  }

  // MAC vendor boost
  const macVendor = lookupMacVendor(mac || '')
  if (macVendor) {
    if (['Synology', 'QNAP', 'Asustor'].includes(macVendor)) {
      vendor = macVendor; type = 'NAS'; confidence = Math.max(confidence, 90)
      discoveryMethod = 'mac-vendor'
    } else if (macVendor === 'Netgear' && smbAvailable) {
      vendor = 'Netgear ReadyNAS'; type = 'NAS'; confidence = Math.max(confidence, 80)
    } else if (macVendor === 'Raspberry Pi' && smbAvailable) {
      vendor = 'Raspberry Pi NAS'; type = 'NAS'; confidence = Math.max(confidence, 70)
    } else if (macVendor === 'WD (Western Digital)' && smbAvailable) {
      vendor = 'WD My Cloud'; type = 'NAS'; confidence = Math.max(confidence, 80)
    }
  }

  // HTTP banner detection
  if (httpAvailable && confidence < 80) {
    const httpPort = openPorts.find(p => p.service === 'http')?.port ||
                     openPorts.find(p => p.service === 'synology')?.port ||
                     openPorts.find(p => p.service === 'openmediavault')?.port || 80
    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://${ip}:${httpPort}' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; $r.Content.Substring(0, [Math]::Min(1000, $r.Content.Length)) } catch { '' }"`,
        { timeout: 4000, windowsHide: true }
      )
      const html = stdout.toLowerCase()
      if (html.includes('synology') || html.includes('diskstation')) { vendor = 'Synology'; type = 'NAS'; confidence = 95; webPortalUrl = `http://${ip}:${httpPort}` }
      else if (html.includes('qnap') || html.includes('qts')) { vendor = 'QNAP'; type = 'NAS'; confidence = 95; webPortalUrl = `http://${ip}:${httpPort}` }
      else if (html.includes('truenas') || html.includes('freenas') || html.includes('ixsystems')) { vendor = 'TrueNAS'; type = 'NAS'; confidence = 95; webPortalUrl = `http://${ip}:${httpPort}` }
      else if (html.includes('openmediavault') || html.includes('omv')) { vendor = 'OpenMediaVault'; type = 'NAS'; confidence = 95; webPortalUrl = `http://${ip}:${httpPort}` }
      else if (html.includes('unraid')) { vendor = 'Unraid'; type = 'NAS'; confidence = 95; webPortalUrl = `http://${ip}:${httpPort}` }
      else if (html.includes('webmin')) { vendor = 'Linux NAS'; type = 'NAS'; confidence = 70; webPortalUrl = `http://${ip}:${httpPort}` }
      else if (html.includes('router') || html.includes('gateway') || html.includes('modem')) { return null }
    } catch {}
  }

  // Skip pure routers/gateways
  if (!smbAvailable && !sshAvailable && openPorts.length <= 2) {
    const lastOctet = parseInt(ip.split('.')[3])
    if (lastOctet === 1 || lastOctet === 254) return null
  }

  // Hostname resolution
  let name = `Device-${ip.split('.').pop()}`
  try {
    const { stdout } = await execAsync(`nbtstat -A ${ip} 2>nul`, { timeout: 2500, windowsHide: true })
    const nbMatch = stdout.match(/^\s+(\S+)\s+<00>\s+UNIQUE/m)
    if (nbMatch) name = nbMatch[1].trim()
  } catch {}
  if (name.startsWith('Device-')) {
    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "try { [System.Net.Dns]::GetHostEntry('${ip}').HostName } catch { '' }"`,
        { timeout: 2500, windowsHide: true }
      )
      const resolved = stdout.trim()
      if (resolved && resolved !== ip) name = resolved.split('.')[0]
    } catch {}
  }

  // SMB share enumeration
  let shares: string[] = []
  if (smbAvailable) {
    try {
      const { stdout } = await execAsync(`net view \\\\${ip} /all 2>nul`, { timeout: 4000, windowsHide: true })
      shares = stdout.split('\n').filter(l => l.includes('Disk')).map(l => l.trim().split(/\s{2,}/)[0]).filter(Boolean)
    } catch {}
  }

  return {
    id: `nas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ip, name, vendor, type, status: 'online',
    latencyMs: bestLatency, hostname: name,
    mac: mac || null, macVendor: macVendor || null,
    lastSeen: Date.now(), discoveredAt: Date.now(),
    discoveryMethod, confidence, shares,
    smbAvailable, sshAvailable, httpAvailable,
    webPortalUrl,
    services: portResults.map(r => ({ port: r.port, service: r.service, open: r.open }))
  }
}

// ============================================
// Persistent Discovery Cache
// ============================================

function getCachePath(): string {
  try { return path.join(app.getPath('userData'), 'nas_discovery_cache.json') }
  catch { return path.join(os.tmpdir(), 'drivewatch_nas_cache.json') }
}

function loadCache(): NASDevice[] {
  try {
    const p = getCachePath()
    if (!fs.existsSync(p)) return []
    const raw = fs.readFileSync(p, 'utf8')
    return JSON.parse(raw)
  } catch { return [] }
}

function saveCache(devices: NASDevice[]) {
  try { fs.writeFileSync(getCachePath(), JSON.stringify(devices, null, 2), 'utf8') } catch {}
}

let discoveryCache: NASDevice[] = loadCache()

// ============================================
// Background Heartbeat Monitor
// ============================================

let heartbeatInterval: NodeJS.Timeout | null = null

function startHeartbeat() {
  if (heartbeatInterval) return
  heartbeatInterval = setInterval(async () => {
    for (const device of discoveryCache) {
      const alive = await isHostAlive(device.ip)
      device.status = alive.alive ? 'online' : 'offline'
      if (alive.alive) { device.lastSeen = Date.now(); device.latencyMs = alive.latencyMs }
    }
    saveCache(discoveryCache)
  }, 30000) // Every 30 seconds
}

// ============================================
// Main Discovery Engine (Hybrid)
// ============================================

export async function discoverNASDevices(): Promise<{
  devices: NASDevice[]
  scanDurationMs: number
  networkRange: string
  adapterUsed: string
  subnetScanned: string
  diagnostics: DiscoveryDiagnostics
  error?: string
}> {
  const startTime = Date.now()
  const adapter = getBestAdapter()

  if (!adapter) {
    return {
      devices: discoveryCache.length > 0 ? discoveryCache : [],
      scanDurationMs: Date.now() - startTime,
      networkRange: 'No adapter', adapterUsed: 'None', subnetScanned: 'None',
      diagnostics: { adapterUsed: 'None', subnetScanned: 'None', hostsScanned: 0, hostsAlive: 0, devicesFound: 0, scanDurationMs: 0, protocols: [], mdnsResponses: 0, ssdpResponses: 0, arpEntries: 0 },
      error: 'No active LAN adapter detected.'
    }
  }

  const subnetPrefix = adapter.subnet.split('.').slice(0, 3).join('.')
  const networkRange = `${subnetPrefix}.1-254`
  const gateway = await getGatewayIP()
  const protocols: string[] = ['arp', 'tcp-probe']

  // Phase 1: Passive discovery (mDNS + SSDP) — runs in parallel with ARP
  const [mdnsResults, ssdpResults, arpMap] = await Promise.all([
    discoverViaMdns(2500).catch(() => []),
    discoverViaSsdp(2500).catch(() => []),
    getArpTable(subnetPrefix)
  ])

  if (mdnsResults.length > 0) protocols.push('mdns')
  if (ssdpResults.length > 0) protocols.push('ssdp')

  // Merge passive discovery IPs into candidate list
  const candidateSet = new Set<string>()
  for (const [ip] of arpMap) {
    if (ip !== adapter.ip && ip !== gateway) candidateSet.add(ip)
  }
  for (const m of mdnsResults) { if (m.ip !== adapter.ip) candidateSet.add(m.ip) }
  for (const s of ssdpResults) { if (s.ip !== adapter.ip) candidateSet.add(s.ip) }

  // Phase 2: If passive gave few results, do active subnet scan
  if (candidateSet.size < 5) {
    const allHosts = getSubnetHosts(adapter)
    const CONCURRENCY = 60
    for (let i = 0; i < allHosts.length; i += CONCURRENCY) {
      const batch = allHosts.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map(ip => isHostAlive(ip)))
      for (let j = 0; j < results.length; j++) {
        if (results[j].alive) candidateSet.add(batch[j])
      }
    }
  }

  // Remove gateway from candidates
  if (gateway) candidateSet.delete(gateway)

  // Phase 3: Deep identification of all candidates
  const candidates = Array.from(candidateSet)
  const IDENTIFY_CONCURRENCY = 12
  const devices: NASDevice[] = []

  for (let i = 0; i < candidates.length; i += IDENTIFY_CONCURRENCY) {
    const batch = candidates.slice(i, i + IDENTIFY_CONCURRENCY)
    const results = await Promise.all(
      batch.map(ip => identifyDevice(ip, arpMap.get(ip) || null, gateway).catch(() => null))
    )
    for (const result of results) {
      if (result) {
        // Boost confidence from passive discovery
        const mdnsHit = mdnsResults.find(m => m.ip === result.ip)
        const ssdpHit = ssdpResults.find(s => s.ip === result.ip)
        if (mdnsHit) { result.confidence = Math.min(100, result.confidence + 15); result.discoveryMethod += '+mdns' }
        if (ssdpHit) { result.confidence = Math.min(100, result.confidence + 10); result.discoveryMethod += '+ssdp' }
        devices.push(result)
      }
    }
  }

  // Update cache
  discoveryCache = devices
  saveCache(devices)
  startHeartbeat()

  const diagnostics: DiscoveryDiagnostics = {
    adapterUsed: `${adapter.name} (${adapter.ip}/${adapter.cidr})`,
    subnetScanned: networkRange,
    hostsScanned: candidates.length,
    hostsAlive: candidateSet.size,
    devicesFound: devices.length,
    scanDurationMs: Date.now() - startTime,
    protocols,
    mdnsResponses: mdnsResults.length,
    ssdpResponses: ssdpResults.length,
    arpEntries: arpMap.size
  }

  return {
    devices,
    scanDurationMs: Date.now() - startTime,
    networkRange,
    adapterUsed: diagnostics.adapterUsed,
    subnetScanned: networkRange,
    diagnostics
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
      const probe = await probePort(config.host, 445, 3000)
      if (!probe.open) return { success: false, latencyMs: probe.latencyMs, error: 'SMB port (445) not accessible' }

      let shares: string[] = []
      try {
        const { stdout } = await execAsync(`net view \\\\${config.host} /all 2>nul`, { timeout: 5000, windowsHide: true })
        shares = stdout.split('\n').filter(l => l.includes('Disk')).map(l => l.trim().split(/\s{2,}/)[0]).filter(Boolean)
      } catch {}

      if (config.username && config.shareName) {
        try {
          await execAsync(`net use \\\\${config.host}\\${config.shareName} /user:${config.username} ${config.password || ''} /persistent:no 2>&1`, { timeout: 8000, windowsHide: true })
          try { await execAsync(`net use \\\\${config.host}\\${config.shareName} /delete /y 2>nul`, { timeout: 3000, windowsHide: true }) } catch {}
          return { success: true, latencyMs: Date.now() - start, serverInfo: `SMB Server at ${config.host}`, shares }
        } catch (err: any) {
          return { success: false, latencyMs: Date.now() - start, error: err.stderr || err.message || 'Auth failed' }
        }
      }
      return { success: true, latencyMs: probe.latencyMs, serverInfo: `SMB Server at ${config.host}`, shares }

    } else if (config.protocol === 'ssh') {
      const probe = await probePort(config.host, config.port || 22, 3000)
      return { success: probe.open, latencyMs: probe.latencyMs, serverInfo: probe.open ? `SSH at ${config.host}:${config.port || 22}` : undefined, error: probe.open ? undefined : 'SSH not accessible' }
    }
    return { success: false, latencyMs: Date.now() - start, error: 'Unsupported protocol' }
  } catch (err: any) {
    return { success: false, latencyMs: Date.now() - start, error: err.message }
  }
}

// ============================================
// NAS Ping
// ============================================

export async function pingNASDevice(host: string): Promise<{ online: boolean; latencyMs: number }> {
  const result = await probePort(host, 445, 2000)
  if (result.open) return { online: true, latencyMs: result.latencyMs }
  for (const port of [22, 80, 443, 5000, 8080, 9000]) {
    const alt = await probePort(host, port, 1500)
    if (alt.open) return { online: true, latencyMs: alt.latencyMs }
  }
  return { online: false, latencyMs: -1 }
}

// ============================================
// NAS Storage Info
// ============================================

export async function getNASStorageInfo(host: string, shareName?: string): Promise<{
  totalCapacity: number; usedSpace: number; freeSpace: number; usagePercent: number; error?: string
}> {
  try {
    if (shareName) {
      try {
        const { stdout } = await execAsync(
          `powershell -NoProfile -Command "try { $s = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -like '*${host}*' }; if ($s) { @{ Used=$s.Used; Free=$s.Free } | ConvertTo-Json } else { 'null' } } catch { 'null' }"`,
          { timeout: 8000, windowsHide: true }
        )
        if (stdout.trim() !== 'null') {
          const data = JSON.parse(stdout.trim())
          const used = data.Used || 0; const free = data.Free || 0; const total = used + free
          return { totalCapacity: total, usedSpace: used, freeSpace: free, usagePercent: total > 0 ? Math.round((used / total) * 100) : 0 }
        }
      } catch {}
    }
    const probe = await probePort(host, 445, 2000)
    if (!probe.open) return { totalCapacity: 0, usedSpace: 0, freeSpace: 0, usagePercent: 0, error: 'Not reachable' }
    return { totalCapacity: 0, usedSpace: 0, freeSpace: 0, usagePercent: 0, error: 'Requires mapped share' }
  } catch (err: any) {
    return { totalCapacity: 0, usedSpace: 0, freeSpace: 0, usagePercent: 0, error: err.message }
  }
}

// ============================================
// Get Cached Devices (instant UI population)
// ============================================

export function getCachedNASDevices(): NASDevice[] {
  return discoveryCache
}
