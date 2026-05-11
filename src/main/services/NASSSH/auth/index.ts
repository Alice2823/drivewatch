import { executeSSH } from '../commands'
import { cleanupOrphanedProcesses } from '../cleanup'
import { parseZpoolList, parseZpoolStatus, parseZfsList, parseSMBShares } from '../parsers'
import { parseSMARTOutput, NASRealDiskSMART } from '../smart'
import type { NASPoolInfo, NASDatasetInfo, NASShareInfo } from '../parsers'

export async function authenticateAndFetchNAS(
  host: string, 
  username: string, 
  password: string, 
  port = 22
): Promise<{
  pools: NASPoolInfo[]
  datasets: NASDatasetInfo[]
  shares: NASShareInfo[]
  disks: NASRealDiskSMART[]
  error?: string
}> {
  try {
    // 1. Initial Authentication & Data Fetch
    // Use absolute paths to ensure commands are found on TrueNAS environments
    const envPrefix = 'export PATH=$PATH:/sbin:/usr/sbin:/usr/local/sbin; '
    const escapedPw = password.replace(/'/g, "'\\''")
    // Remove -p "" to prevent nested quote stripping across PowerShell/SSH/Bash causing sudo to swallow the command
    const sudoCmd = username === 'root' ? '' : `echo '${escapedPw}' | sudo -S `
    
    const [zpoolListOut, zpoolStatusOut, zfsListOut, smbConfOut, smartScanOut, diskMapOut] = await Promise.all([
      executeSSH(host, username, password, `${envPrefix} ${sudoCmd} zpool list`, port),
      executeSSH(host, username, password, `${envPrefix} ${sudoCmd} zpool status`, port),
      executeSSH(host, username, password, `${envPrefix} ${sudoCmd} zfs list`, port),
      executeSSH(host, username, password, `${envPrefix} ${sudoCmd} cat /etc/smb4.conf || ${sudoCmd} cat /usr/local/etc/smb4.conf`, port),
      executeSSH(host, username, password, `${envPrefix} ${sudoCmd} smartctl --scan`, port),
      executeSSH(host, username, password, `${envPrefix} ls -l /dev/disk/by-id/ /dev/disk/by-partuuid/ /dev/gptid/ 2>/dev/null || true`, port)
    ])

    // DEBUG LOGGING
    console.log('[NAS SSH DEBUG] RAW ZPOOL LIST:\n', zpoolListOut)
    console.log('[NAS SSH DEBUG] RAW ZPOOL STATUS:\n', zpoolStatusOut)
    console.log('[NAS SSH DEBUG] RAW SMART SCAN:\n', smartScanOut)

    if (!zpoolListOut && !zfsListOut && !smartScanOut) {
      throw new Error('Authentication failed, timeout, or insufficient permissions on NAS.')
    }

    // 2. Parse basic NAS layout
    // We isolate failures so one parser breaking doesn't discard everything
    let pools: NASPoolInfo[] = []
    let datasets: NASDatasetInfo[] = []
    let shares: NASShareInfo[] = []

    try { pools = parseZpoolList(zpoolListOut) } catch (e) { console.error('zpool list parse error', e) }
    try { pools = parseZpoolStatus(zpoolStatusOut, pools) } catch (e) { console.error('zpool status parse error', e) }
    try { datasets = parseZfsList(zfsListOut) } catch (e) { console.error('zfs list parse error', e) }
    try { shares = parseSMBShares(smbConfOut, datasets) } catch (e) { console.error('smb share parse error', e) }

    // 3. Extract physical disks from SMART SCAN instead of relying entirely on zpool topology
    // smartctl --scan outputs lines like: /dev/ada0 -d atacam # /dev/ada0, ATA device
    const diskResults: NASRealDiskSMART[] = []
    
    // Fallback: If smartctl scan is empty, try to salvage disks from zpool topology
    let allDiskIds: string[] = []
    if (smartScanOut.trim()) {
      allDiskIds = smartScanOut.split('\n')
        .map(line => line.trim().split(/\s+/)[0])
        .filter(dev => dev.startsWith('/dev/'))
    } else {
      allDiskIds = [...new Set(pools.flatMap(p => p.disks))].map(d => d.startsWith('/dev/') ? d : `/dev/${d}`)
    }

    // 4. Build Reverse Lookup Map for TrueNAS Disks (e.g. gptid to sda)
    const reverseDiskMap = new Map<string, string>()
    if (diskMapOut) {
      const lines = diskMapOut.split('\n')
      for (const line of lines) {
        // matches: gptid/12345-6789 -> ../../sda2
        const match = line.match(/([^\s\/]+)\s+->\s+.*?(sd[a-z]+|nvme\d+n\d+|da\d+|ada\d+)/)
        if (match) {
          const alias = match[1]
          const target = match[2]
          let current = reverseDiskMap.get(target) || ''
          reverseDiskMap.set(target, `${current} ${alias} gptid/${alias}`)
        }
      }
    }

    // 5. Fetch SMART data per disk
    const smartBatchSize = 4
    for (let i = 0; i < allDiskIds.length; i += smartBatchSize) {
      const batch = allDiskIds.slice(i, i + smartBatchSize)
      const smartPromises = batch.map(async (diskPath) => {
        const diskId = diskPath.replace('/dev/', '')
        const aliases = reverseDiskMap.get(diskId) || ''
        
        // Find which pool this disk belongs to by checking its direct name or its GPTID aliases
        const pool = pools.find(p => p.disks.some(d => 
          d === diskId || 
          d === diskPath || 
          aliases.includes(d) || 
          aliases.includes(d.replace('gptid/', ''))
        ))?.name || 'Unassigned'

        try {
          const smartOut = await executeSSH(host, username, password, `export PATH=$PATH:/sbin:/usr/sbin:/usr/local/sbin; ${sudoCmd} smartctl -a ${diskPath}`, port)
          console.log(`[NAS SSH DEBUG] RAW SMART DATA (${diskPath}):\n`, smartOut)
          return parseSMARTOutput(smartOut, diskId, pool)
        } catch (e) {
          console.error(`SMART fetch/parse error for ${diskPath}`, e)
          return null
        }
      })
      
      const results = await Promise.all(smartPromises)
      for (const r of results) {
        if (r) diskResults.push(r)
      }
    }

    console.log('[NAS SSH DEBUG] PARSED RESULT:', { pools, datasets, shares, disks: diskResults })
    return { pools, datasets, shares, disks: diskResults }

  } catch (err: any) {
    console.error('[NAS SSH DEBUG] FATAL ERROR:', err)
    return { pools: [], datasets: [], shares: [], disks: [], error: err.message }
  } finally {
    // 4. Secure Cleanup
    // Ensure hanging SSH sessions are reaped
    await cleanupOrphanedProcesses()
  }
}
