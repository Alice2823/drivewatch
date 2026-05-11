export interface NASPoolInfo {
  name: string
  size: number
  allocated: number
  free: number
  health: string
  topology: string
  disks: string[]
}

export interface NASDatasetInfo {
  name: string
  used: number
  available: number
  refer: number
  mountpoint: string
  pool: string
}

export interface NASShareInfo {
  name: string
  path: string
  pool: string
}

export function parseSize(sizeStr: string): number {
  if (!sizeStr || sizeStr === '-') return 0
  const s = sizeStr.trim().toUpperCase()
  const num = parseFloat(s)
  if (isNaN(num)) return 0
  if (s.endsWith('P') || s.endsWith('PB')) return num * 1024 * 1024 * 1024 * 1024 * 1024
  if (s.endsWith('T') || s.endsWith('TB')) return num * 1024 * 1024 * 1024 * 1024
  if (s.endsWith('G') || s.endsWith('GB')) return num * 1024 * 1024 * 1024
  if (s.endsWith('M') || s.endsWith('MB')) return num * 1024 * 1024
  if (s.endsWith('K') || s.endsWith('KB')) return num * 1024
  return num
}

export function parseZpoolList(output: string): NASPoolInfo[] {
  const pools: NASPoolInfo[] = []
  const lines = output.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('NAME') && !l.includes('no pools available') && !l.toLowerCase().includes('password') && !l.toLowerCase().includes('[sudo]'))
  for (const line of lines) {
    const parts = line.split(/\s+/)
    if (parts.length >= 4) {
      // Find health state robustly regardless of column position
      const healthMatch = line.match(/(ONLINE|DEGRADED|FAULTED|OFFLINE|UNAVAIL|REMOVED)/i)
      const health = healthMatch ? healthMatch[1].toUpperCase() : 'UNKNOWN'

      pools.push({
        name: parts[0],
        size: parseSize(parts[1]),
        allocated: parseSize(parts[2]),
        free: parseSize(parts[3]),
        health,
        topology: 'Unknown',
        disks: []
      })
    }
  }
  return pools
}

export function parseZpoolStatus(output: string, pools: NASPoolInfo[]): NASPoolInfo[] {
  let currentPool = ''
  let inConfig = false
  const poolMap = new Map(pools.map(p => [p.name, p]))

  const lines = output.split('\n')
  for (const line of lines) {
    if (line.toLowerCase().includes('password') || line.toLowerCase().includes('[sudo]')) continue
    const poolMatch = line.match(/^\s*pool:\s*(\S+)/)
    if (poolMatch) {
      currentPool = poolMatch[1]
      if (!poolMap.has(currentPool)) {
        const newPool = { name: currentPool, size: 0, allocated: 0, free: 0, health: 'UNKNOWN', topology: 'Unknown', disks: [] }
        pools.push(newPool)
        poolMap.set(currentPool, newPool)
      }
      inConfig = false
      continue
    }

    const stateMatch = line.match(/^\s*state:\s*(\S+)/)
    if (stateMatch && currentPool) {
      const p = poolMap.get(currentPool)
      if (p && p.health === 'UNKNOWN') p.health = stateMatch[1].toUpperCase()
    }

    if (line.match(/^\s*config:/)) { inConfig = true; continue }
    if (line.match(/^\s*(errors|scan|status|action|see):/) && inConfig) { inConfig = false; continue }

    if (inConfig && currentPool) {
      const pool = poolMap.get(currentPool)
      if (!pool) continue
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('NAME') || trimmed === currentPool) continue

      if (trimmed.match(/^(raidz[123]|mirror|stripe|spare|log|cache)/i)) {
        const topo = trimmed.split(/\s+/)[0].toLowerCase()
        if (topo.startsWith('raidz1') || topo === 'raidz') pool.topology = 'RAIDZ1'
        else if (topo.startsWith('raidz2')) pool.topology = 'RAIDZ2'
        else if (topo.startsWith('raidz3')) pool.topology = 'RAIDZ3'
        else if (topo.startsWith('mirror')) pool.topology = 'Mirror'
        else if (topo.startsWith('stripe')) pool.topology = 'Stripe'
      }

      const diskMatch = trimmed.match(/^(\/dev\/\S+|da\d+|ada\d+|sd[a-z]+|nvme\d+n\d+|gptid\/\S+)/)
      if (diskMatch) {
        pool.disks.push(diskMatch[1])
      }
    }
  }

  for (const pool of pools) {
    if (pool.topology === 'Unknown') {
      if (pool.disks.length > 1) pool.topology = 'Stripe'
      else if (pool.disks.length === 1) pool.topology = 'Single'
      else pool.topology = 'Topology unavailable'
    }
  }

  return pools
}

export function parseZfsList(output: string): NASDatasetInfo[] {
  const datasets: NASDatasetInfo[] = []
  const lines = output.split('\n').filter(l => l.trim() && !l.trim().startsWith('NAME') && !l.toLowerCase().includes('password') && !l.toLowerCase().includes('[sudo]'))
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 5) {
      const name = parts[0]
      datasets.push({
        name,
        used: parseSize(parts[1]),
        available: parseSize(parts[2]),
        refer: parseSize(parts[3]),
        mountpoint: parts[4] || 'none',
        pool: name.split('/')[0]
      })
    }
  }
  return datasets
}

export function parseSMBShares(smbOutput: string, datasets: NASDatasetInfo[]): NASShareInfo[] {
  const shares: NASShareInfo[] = []
  const shareBlocks = smbOutput.split(/\[/).filter(b => b.trim())

  for (const block of shareBlocks) {
    const nameMatch = block.match(/^(\S+)\]/)
    const pathMatch = block.match(/path\s*=\s*(.+)/i)
    if (nameMatch && pathMatch) {
      const name = nameMatch[1]
      if (name === 'global' || name === 'homes' || name === 'printers') continue
      const sharePath = pathMatch[1].trim()
      const pool = datasets.find(d => sharePath.startsWith(d.mountpoint))?.pool || ''
      shares.push({ name, path: sharePath, pool })
    }
  }

  if (shares.length === 0 && datasets.length > 0) {
    for (const ds of datasets) {
      if (ds.name.includes('/') && ds.mountpoint !== 'none' && ds.mountpoint !== '-') {
        const dsName = ds.name.split('/').pop() || ds.name
        shares.push({ name: dsName, path: ds.mountpoint, pool: ds.pool })
      }
    }
  }

  return shares
}
