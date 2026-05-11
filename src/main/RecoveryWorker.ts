import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';

if (!parentPort) process.exit(1);

const { drivePath, mode } = workerData as { drivePath: string; mode: 'quick' | 'deep' };
let isPaused = false, isCancelled = false, fileIdCounter = 0;

const ONE_MB = 1024 * 1024;
const DEFAULT_CARVE_SIZES: Record<string, number> = {
  pdf: 2 * ONE_MB,
  jpg: 512 * 1024,
  png: 512 * 1024,
  gif: 256 * 1024,
  bmp: 2 * ONE_MB,
  zip: 8 * ONE_MB,
  docx: 8 * ONE_MB,
  mp4: 32 * ONE_MB
};

parentPort.on('message', (msg: string) => {
  if (msg === 'pause') isPaused = true;
  if (msg === 'resume') isPaused = false;
  if (msg === 'cancel') isCancelled = true;
});

function log(msg: string) { console.log(`[RecoveryWorker] ${msg}`); }

function sendProgress(p: any) { parentPort?.postMessage({ type: 'progress', progress: p }); }
function sendFile(f: any) { parentPort?.postMessage({ type: 'file_found', file: f }); }
function sendStatus(s: string) { parentPort?.postMessage({ type: 'status', status: s }); }
function sendError(e: string) { parentPort?.postMessage({ type: 'error', error: e }); }
function sendDone() { parentPort?.postMessage({ type: 'done' }); }

async function waitIfPaused() {
  while (isPaused && !isCancelled) await new Promise(r => setTimeout(r, 300));
}

function getExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.substring(i + 1).toLowerCase() : '';
}

function getBaseName(name: string): string {
  const parsed = path.parse(name);
  return parsed.name || name.replace(/\.[^/.]+$/, '');
}

function getProbability(ext: string, source: string, isSSD: boolean): number {
  let base = source === 'recycle_bin' ? 95 : source === 'mft_deleted' ? 70 : 50;
  if (isSSD) base = Math.max(base - 30, 10);
  const goodExts = ['jpg','png','pdf','mp4','zip','docx','txt','xlsx','pptx','gif','bmp','wav','mp3'];
  if (goodExts.includes(ext)) base = Math.min(base + 5, 99);
  return base;
}

function getStatus(prob: number): string {
  if (prob >= 90) return 'excellent';
  if (prob >= 60) return 'recoverable';
  if (prob >= 30) return 'partially_overwritten';
  return 'corrupted';
}

function filetimeToDate(low: number, high: number): string {
  const ft = BigInt(high) * BigInt(0x100000000) + BigInt(low >>> 0);
  const epochDiff = BigInt('116444736000000000');
  const ms = Number((ft - epochDiff) / BigInt(10000));
  if (ms < 0 || ms > 4102444800000) return new Date().toISOString();
  return new Date(ms).toISOString();
}

// ═══════════════════════════════════════════════════════════════
// STAGE 1: RECYCLE BIN SCANNER — Finds files in $Recycle.Bin
// ═══════════════════════════════════════════════════════════════
async function scanRecycleBin(letter: string): Promise<number> {
  log(`Scanning $Recycle.Bin on ${letter}:`);
  sendStatus(`Scanning Recycle Bin on ${letter}: ...`);
  let found = 0;

  const recyclePath = path.join(`${letter}:\\`, '$Recycle.Bin');
  if (!fs.existsSync(recyclePath)) { log('No $Recycle.Bin found'); return 0; }

  try {
    const sids = fs.readdirSync(recyclePath, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('S-'));

    for (const sid of sids) {
      if (isCancelled) break;
      const sidPath = path.join(recyclePath, sid.name);
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(sidPath, { withFileTypes: true }); }
      catch { continue; }

      const infoFiles = entries.filter(e => e.name.startsWith('$I') && e.isFile());

      for (const info of infoFiles) {
        if (isCancelled) break;
        await waitIfPaused();

        const infoPath = path.join(sidPath, info.name);
        const dataName = '$R' + info.name.substring(2);
        const dataPath = path.join(sidPath, dataName);

        try {
          const buf = fs.readFileSync(infoPath);
          if (buf.length < 28) continue;

          const version = buf.readBigInt64LE(0);
          const fileSize = Number(buf.readBigInt64LE(8));
          const deletionTimeLow = buf.readUInt32LE(16);
          const deletionTimeHigh = buf.readUInt32LE(20);
          const deletionDate = filetimeToDate(deletionTimeLow, deletionTimeHigh);

          let originalPath = '';
          if (version === BigInt(2) && buf.length >= 28) {
            const pathLen = buf.readUInt32LE(24);
            const pathBuf = buf.subarray(28, 28 + pathLen * 2);
            originalPath = pathBuf.toString('utf16le').replace(/\0+$/, '');
          } else if (version === BigInt(1) && buf.length >= 280) {
            originalPath = buf.subarray(24, 544).toString('utf16le').replace(/\0+$/, '');
          }

          const fileName = path.basename(originalPath);
          const ext = getExtension(fileName);
          if (!fileName || !ext) continue;

          const prob = getProbability(ext, 'recycle_bin', false);
          const dataExists = fs.existsSync(dataPath);

          const file = {
            id: `rb-${++fileIdCounter}`,
            name: getBaseName(fileName),
            extension: ext,
            path: path.dirname(originalPath),
            size: fileSize,
            deletionDate,
            status: dataExists ? getStatus(prob) : 'corrupted',
            probability: dataExists ? prob : 15,
            sectorStart: 0,
            sectorCount: Math.ceil(fileSize / 512),
            source: 'recycle_bin' as const,
            driveLetter: letter,
            recycleBinPath: dataExists ? dataPath : undefined
          };

          sendFile(file);
          found++;
        } catch (e: any) { log(`Error parsing ${infoPath}: ${e.message}`); }
      }
    }
  } catch (e: any) { log(`Recycle bin access error: ${e.message}`); }

  log(`Recycle Bin scan complete: ${found} files found`);
  return found;
}

// ═══════════════════════════════════════════════════════════════
// STAGE 2: NTFS MFT SCANNER — Parses deleted MFT entries
// ═══════════════════════════════════════════════════════════════
function applyMftFixup(record: Buffer, bytesPerSector: number): boolean {
  if (record.length < 48) return false;
  const sig = record.toString('ascii', 0, 4);
  if (sig !== 'FILE') return false;

  const usaOff = record.readUInt16LE(4);
  const usaSize = record.readUInt16LE(6);
  if (usaOff + usaSize * 2 > record.length) return false;

  const seqNum = record.readUInt16LE(usaOff);
  for (let i = 1; i < usaSize; i++) {
    const sectorEnd = i * bytesPerSector - 2;
    if (sectorEnd + 2 > record.length) break;
    if (record.readUInt16LE(sectorEnd) !== seqNum) return false;
    record.writeUInt16LE(record.readUInt16LE(usaOff + i * 2), sectorEnd);
  }
  return true;
}

function parseFileName(attrValue: Buffer): { name: string; parentRef: bigint; fileSize: bigint; creationTime: string } | null {
  if (attrValue.length < 66) return null;
  const parentRef = attrValue.readBigUInt64LE(0) & BigInt(0xFFFFFFFFFFFF);
  const creationLow = attrValue.readUInt32LE(8);
  const creationHigh = attrValue.readUInt32LE(12);
  const fileSize = attrValue.readBigUInt64LE(0x30);
  const nameLen = attrValue.readUInt8(0x40);
  const namespace = attrValue.readUInt8(0x41);
  if (namespace === 2) return null; // Skip DOS-only names
  if (0x42 + nameLen * 2 > attrValue.length) return null;

  const name = attrValue.subarray(0x42, 0x42 + nameLen * 2).toString('utf16le');
  return { name, parentRef, fileSize, creationTime: filetimeToDate(creationLow, creationHigh) };
}

async function scanMft(letter: string): Promise<number> {
  log(`Starting MFT scan on \\\\.\\${letter}:`);
  sendStatus(`Reading NTFS Master File Table on ${letter}: ...`);

  let fd: number;
  try {
    fd = fs.openSync(`\\\\.\\${letter}:`, 'r');
  } catch (e: any) {
    log(`Cannot open volume for raw access: ${e.message}`);
    sendStatus(`Raw volume access unavailable (${e.message})`);
    return 0;
  }

  let found = 0;
  try {
    // Read NTFS boot sector
    const boot = Buffer.alloc(512);
    fs.readSync(fd, boot, 0, 512, 0);

    const oemId = boot.toString('ascii', 3, 7);
    if (oemId !== 'NTFS') {
      log(`Not an NTFS volume (OEM: ${oemId})`);
      fs.closeSync(fd);
      return 0;
    }

    const bytesPerSector = boot.readUInt16LE(0x0B);
    const sectorsPerCluster = boot.readUInt8(0x0D);
    const bytesPerCluster = bytesPerSector * sectorsPerCluster;
    const mftClusterNum = Number(boot.readBigInt64LE(0x30));
    const mftRecSizeByte = boot.readInt8(0x40);
    const mftRecordSize = mftRecSizeByte > 0
      ? mftRecSizeByte * bytesPerCluster
      : Math.pow(2, Math.abs(mftRecSizeByte));

    const mftOffset = mftClusterNum * bytesPerCluster;

    log(`NTFS: ${bytesPerSector}B/sector, ${sectorsPerCluster}sec/cluster, MFT@cluster ${mftClusterNum}, recSize=${mftRecordSize}`);

    // Read MFT entries in batches
    const batchSize = 256;
    const batchBuf = Buffer.alloc(mftRecordSize * batchSize);
    const maxEntries = 100000; // Scan up to 100k entries for quick scan
    let scanned = 0;

    for (let batch = 0; batch * batchSize < maxEntries; batch++) {
      if (isCancelled) break;
      await waitIfPaused();

      const offset = mftOffset + batch * batchSize * mftRecordSize;
      let bytesRead = 0;
      try {
        bytesRead = fs.readSync(fd, batchBuf, 0, batchBuf.length, offset);
      } catch { break; }
      if (bytesRead < mftRecordSize) break;

      const entriesInBatch = Math.floor(bytesRead / mftRecordSize);

      for (let i = 0; i < entriesInBatch; i++) {
        if (isCancelled) break;
        scanned++;
        const entryBuf = Buffer.from(batchBuf.subarray(i * mftRecordSize, (i + 1) * mftRecordSize));

        if (entryBuf.toString('ascii', 0, 4) !== 'FILE') continue;
        if (!applyMftFixup(entryBuf, bytesPerSector)) continue;

        const flags = entryBuf.readUInt16LE(0x16);
        const inUse = (flags & 0x01) !== 0;
        const isDir = (flags & 0x02) !== 0;
        if (inUse || isDir) continue; // Only care about deleted non-directory entries

        // Parse attributes
        let attrOffset = entryBuf.readUInt16LE(0x14);
        let fileName = '', fileSize = BigInt(0), creationTime = '';
        let dataRuns: { clusterOffset: number; clusterCount: number }[] = [];
        let residentData: number[] | null = null;
        let dataRealSize = 0; // Authoritative file size from $DATA attribute
        let prevLcn = 0; // Persist LCN across multiple $DATA attributes for the same file

        while (attrOffset + 4 < mftRecordSize) {
          const attrType = entryBuf.readUInt32LE(attrOffset);
          if (attrType === 0xFFFFFFFF || attrType === 0) break;
          const attrLen = entryBuf.readUInt32LE(attrOffset + 4);
          if (attrLen < 16 || attrOffset + attrLen > mftRecordSize) break;

          if (attrType === 0x30) { // $FILE_NAME
            const nonRes = entryBuf.readUInt8(attrOffset + 8);
            if (nonRes === 0) {
              const valLen = entryBuf.readUInt32LE(attrOffset + 0x10);
              const valOff = entryBuf.readUInt16LE(attrOffset + 0x14);
              const valStart = attrOffset + valOff;
              if (valStart + valLen <= mftRecordSize) {
                const parsed = parseFileName(entryBuf.subarray(valStart, valStart + valLen));
                if (parsed && parsed.name.length > 0 && !parsed.name.startsWith('$')) {
                  fileName = parsed.name;
                  fileSize = parsed.fileSize;
                  creationTime = parsed.creationTime;
                }
              }
            }
          }

          // Parse $DATA attribute (0x80) for actual file cluster locations
          if (attrType === 0x80) {
            const attrNameLen = entryBuf.readUInt8(attrOffset + 9);
            if (attrNameLen > 0) {
              attrOffset += attrLen;
              continue;
            }
            const nonRes = entryBuf.readUInt8(attrOffset + 8);
            if (nonRes === 0) {
              // Resident data — file content is inside the MFT record itself
              const valLen = entryBuf.readUInt32LE(attrOffset + 0x10);
              const valOff = entryBuf.readUInt16LE(attrOffset + 0x14);
              const valStart = attrOffset + valOff;
              if (valStart + valLen <= mftRecordSize && valLen > 0) {
                residentData = Array.from(entryBuf.subarray(valStart, valStart + valLen));
                dataRealSize = valLen;
              }
            } else {
              // Non-resident data — extract real size and parse data run list
              // Real size is at offset 0x30 from attribute start (8 bytes, LE)
              try {
                dataRealSize = Number(entryBuf.readBigUInt64LE(attrOffset + 0x30));
              } catch { dataRealSize = 0; }

              try {
                const runListOff = entryBuf.readUInt16LE(attrOffset + 0x20);
                let runPos = attrOffset + runListOff;

                while (runPos < attrOffset + attrLen) {
                  const header = entryBuf.readUInt8(runPos);
                  if (header === 0) break;
                  const lenFieldSize = header & 0x0F;
                  const offFieldSize = (header >> 4) & 0x0F;
                  if (lenFieldSize === 0) break;
                  if (runPos + 1 + lenFieldSize + offFieldSize > attrOffset + attrLen) break;

                  // Parse run length (unsigned, number of clusters in this run)
                  let runLength = 0;
                  for (let b = 0; b < lenFieldSize; b++) {
                    runLength += entryBuf.readUInt8(runPos + 1 + b) * Math.pow(256, b);
                  }

                  // Parse run offset (signed, relative to previous LCN)
                  let runOffsetRel = 0;
                  if (offFieldSize > 0) {
                    // Read as unsigned first
                    for (let b = 0; b < offFieldSize; b++) {
                      runOffsetRel += entryBuf.readUInt8(runPos + 1 + lenFieldSize + b) * Math.pow(256, b);
                    }
                    // Sign-extend: if high bit of last byte is set, value is negative
                    const highByte = entryBuf.readUInt8(runPos + 1 + lenFieldSize + offFieldSize - 1);
                    if (highByte & 0x80) {
                      // Two's complement: subtract 2^(offFieldSize*8) to get negative value
                      runOffsetRel -= Math.pow(256, offFieldSize);
                    }

                    const absoluteLcn = prevLcn + runOffsetRel;
                    prevLcn = absoluteLcn;

                    if (runLength > 0 && absoluteLcn > 0) {
                      dataRuns.push({ clusterOffset: absoluteLcn, clusterCount: runLength });
                    }
                  }
                  // If offFieldSize === 0, this is a sparse run (no physical clusters)

                  runPos += 1 + lenFieldSize + offFieldSize;
                }

                if (dataRuns.length > 0) {
                  log(`  Data runs for "${fileName}": ${dataRuns.length} runs, realSize=${dataRealSize}`);
                  for (let r = 0; r < dataRuns.length; r++) {
                    log(`    Run ${r}: LCN=${dataRuns[r].clusterOffset}, clusters=${dataRuns[r].clusterCount}, bytes=${dataRuns[r].clusterCount * bytesPerCluster}`);
                  }
                }
              } catch (e: any) { log(`Data run parse error: ${e.message}`); }
            }
          }

          attrOffset += attrLen;
        }

        if (!fileName || fileName.startsWith('$') || fileName.startsWith('.')) continue;

        const ext = getExtension(fileName);
        if (!ext) continue;

        // Use $DATA realSize if available (authoritative), fall back to $FILE_NAME size
        const size = dataRealSize > 0 ? dataRealSize : Number(fileSize);
        if (size <= 0 || size > 100 * 1024 * 1024 * 1024) continue; // Skip implausible sizes

        const prob = getProbability(ext, 'mft_deleted', false);
        const file = {
          id: `mft-${++fileIdCounter}`,
          name: getBaseName(fileName),
          extension: ext,
          path: `${letter}:\\[Deleted]`,
          size,
          deletionDate: creationTime,
          status: getStatus(prob),
          probability: prob,
          sectorStart: offset / bytesPerSector + i * (mftRecordSize / bytesPerSector),
          sectorCount: Math.ceil(size / bytesPerSector),
          source: 'mft_deleted' as const,
          driveLetter: letter,
          dataRuns: dataRuns.length > 0 ? dataRuns : undefined,
          residentData: residentData || undefined,
          bytesPerCluster,
          bytesPerSector
        };

        sendFile(file);
        found++;

        if (scanned % 5000 === 0) {
          const pct = Math.min(Math.round((scanned / maxEntries) * 100), 99);
          sendProgress({
            scannedSectors: scanned, totalSectors: maxEntries, percentage: pct,
            foundFiles: found, speed: scanned, eta: Math.ceil((maxEntries - scanned) / 5000),
            isComplete: false, isPaused, currentOperation: 'Parsing MFT entries', stage: 'MFT Scan'
          });
        }
      }
    }
    fs.closeSync(fd);
  } catch (e: any) {
    log(`MFT scan error: ${e.message}`);
    try { fs.closeSync(fd!); } catch {}
  }

  log(`MFT scan complete: ${found} deleted entries found`);
  return found;
}

// ═══════════════════════════════════════════════════════════════
// DEEP SCAN: RAW SECTOR SIGNATURE CARVING
// ═══════════════════════════════════════════════════════════════
const FILE_SIGNATURES: { ext: string; header: number[]; minSize: number }[] = [
  { ext: 'jpg', header: [0xFF, 0xD8, 0xFF], minSize: 1024 },
  { ext: 'png', header: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], minSize: 100 },
  { ext: 'pdf', header: [0x25, 0x50, 0x44, 0x46], minSize: 512 },
  { ext: 'zip', header: [0x50, 0x4B, 0x03, 0x04], minSize: 100 },
  { ext: 'docx', header: [0x50, 0x4B, 0x03, 0x04], minSize: 4096 },
  { ext: 'mp4', header: [0x00, 0x00, 0x00], minSize: 8192 }, // partial, check ftyp
  { ext: 'gif', header: [0x47, 0x49, 0x46, 0x38], minSize: 64 },
  { ext: 'bmp', header: [0x42, 0x4D], minSize: 100 },
];

interface SignatureMatch {
  ext: string;
  estimatedSize: number;
}

interface CarveEstimate {
  size: number;
  hasTerminator: boolean;
  note: string;
}

function matchSignature(buf: Buffer, offset: number): SignatureMatch | null {
  for (const sig of FILE_SIGNATURES) {
    if (offset + sig.header.length > buf.length) continue;
    let match = true;
    for (let i = 0; i < sig.header.length; i++) {
      if (buf[offset + i] !== sig.header[i]) { match = false; break; }
    }
    if (!match) continue;

    // Special MP4 check: byte 4-7 must be "ftyp"
    if (sig.ext === 'mp4') {
      if (offset + 8 > buf.length) continue;
      const marker = buf.toString('ascii', offset + 4, offset + 8);
      if (marker !== 'ftyp') continue;
      const boxSize = buf.readUInt32BE(offset);
      return { ext: 'mp4', estimatedSize: Math.max(boxSize * 10, 1024 * 1024) };
    }

    // JPG: try to find end marker for size estimate
    if (sig.ext === 'jpg') {
      let estSize = 512 * 1024; // default 512KB
      for (let j = offset + 2; j < Math.min(offset + 20 * 1024 * 1024, buf.length) - 1; j++) {
        if (buf[j] === 0xFF && buf[j + 1] === 0xD9) { estSize = j - offset + 2; break; }
      }
      return { ext: 'jpg', estimatedSize: estSize };
    }

    // PNG: try to find IEND chunk
    if (sig.ext === 'png') {
      let estSize = 256 * 1024;
      const iend = Buffer.from('IEND');
      for (let j = offset + 8; j < Math.min(offset + 20 * 1024 * 1024, buf.length) - 8; j++) {
        if (buf.subarray(j, j + 4).equals(iend)) { estSize = j - offset + 12; break; }
      }
      return { ext: 'png', estimatedSize: estSize };
    }

    // PDF: search for %%EOF
    if (sig.ext === 'pdf') {
      let estSize = 128 * 1024;
      const eof = Buffer.from('%%EOF');
      for (let j = offset; j < Math.min(offset + 50 * 1024 * 1024, buf.length) - 5; j++) {
        if (buf.subarray(j, j + 5).equals(eof)) { estSize = j - offset + 5; break; }
      }
      return { ext: 'pdf', estimatedSize: estSize };
    }

    // ZIP/DOCX: read local file header size
    if (sig.ext === 'zip' || sig.ext === 'docx') {
      if (offset + 30 > buf.length) continue;
      // Check if DOCX by looking for [Content_Types].xml inside
      const nameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      if (offset + 30 + nameLen <= buf.length) {
        const innerName = buf.toString('ascii', offset + 30, offset + 30 + nameLen);
        const ext2 = innerName.includes('Content_Types') || innerName.includes('word/') ? 'docx' : 'zip';
        return { ext: ext2, estimatedSize: 256 * 1024 };
      }
      return { ext: sig.ext, estimatedSize: 128 * 1024 };
    }

      return { ext: sig.ext, estimatedSize: sig.minSize * 100 };
  }
  return null;
}

function findMarkerInVolume(fd: number, marker: Buffer, start: number, maxEnd: number): number {
  const readSize = ONE_MB;
  const overlap = Math.max(marker.length - 1, 0);
  let position = start;
  let carry = Buffer.alloc(0);

  while (position < maxEnd && !isCancelled) {
    const bytesToRead = Math.min(readSize, maxEnd - position);
    const buf = Buffer.alloc(bytesToRead);
    let bytesRead = 0;

    try {
      bytesRead = fs.readSync(fd, buf, 0, bytesToRead, position);
    } catch {
      break;
    }
    if (bytesRead <= 0) break;

    const window = carry.length > 0
      ? Buffer.concat([carry, buf.subarray(0, bytesRead)])
      : buf.subarray(0, bytesRead);
    const found = window.indexOf(marker);

    if (found >= 0) {
      return position - carry.length + found;
    }

    carry = window.subarray(Math.max(0, window.length - overlap));
    position += bytesRead;
  }

  return -1;
}

function findJpegEndInVolume(fd: number, start: number, maxEnd: number): number {
  const readSize = ONE_MB;
  let position = start;
  let previous = -1;

  while (position < maxEnd && !isCancelled) {
    const bytesToRead = Math.min(readSize, maxEnd - position);
    const buf = Buffer.alloc(bytesToRead);
    let bytesRead = 0;

    try {
      bytesRead = fs.readSync(fd, buf, 0, bytesToRead, position);
    } catch {
      break;
    }
    if (bytesRead <= 0) break;

    for (let i = 0; i < bytesRead; i++) {
      if (previous === 0xFF && buf[i] === 0xD9) {
        return position + i + 1;
      }
      previous = buf[i];
    }

    position += bytesRead;
  }

  return -1;
}

function estimateCarvedSize(fd: number, absoluteOffset: number, ext: string, volumeSize: number, fallbackSize: number): CarveEstimate {
  const defaultSize = Math.max(fallbackSize, DEFAULT_CARVE_SIZES[ext] || fallbackSize);
  const structuralMax = ext === 'pdf' ? 256 * ONE_MB : ext === 'mp4' ? 512 * ONE_MB : 64 * ONE_MB;
  const maxEnd = Math.min(volumeSize, absoluteOffset + structuralMax);

  if (ext === 'pdf') {
    const eof = findMarkerInVolume(fd, Buffer.from('%%EOF'), absoluteOffset, maxEnd);
    if (eof >= 0) {
      return { size: eof - absoluteOffset + 5, hasTerminator: true, note: 'PDF EOF found' };
    }
    return { size: defaultSize, hasTerminator: false, note: 'PDF EOF not found in scan window' };
  }

  if (ext === 'jpg') {
    const end = findJpegEndInVolume(fd, absoluteOffset + 2, maxEnd);
    if (end >= 0) {
      return { size: end - absoluteOffset, hasTerminator: true, note: 'JPEG EOI found' };
    }
    return { size: defaultSize, hasTerminator: false, note: 'JPEG EOI not found in scan window' };
  }

  if (ext === 'png') {
    const iend = findMarkerInVolume(fd, Buffer.from('IEND'), absoluteOffset + 8, maxEnd);
    if (iend >= 0) {
      return { size: iend - absoluteOffset + 8, hasTerminator: true, note: 'PNG IEND found' };
    }
    return { size: defaultSize, hasTerminator: false, note: 'PNG IEND not found in scan window' };
  }

  if (ext === 'gif') {
    const end = findMarkerInVolume(fd, Buffer.from([0x3B]), absoluteOffset + 6, maxEnd);
    if (end >= 0) {
      return { size: end - absoluteOffset + 1, hasTerminator: true, note: 'GIF trailer found' };
    }
    return { size: defaultSize, hasTerminator: false, note: 'GIF trailer not found in scan window' };
  }

  return { size: defaultSize, hasTerminator: false, note: 'Size estimated from signature' };
}

async function deepScan(letter: string): Promise<number> {
  log(`Starting Deep Scan on \\\\.\\${letter}:`);
  sendStatus(`Deep scanning raw sectors on ${letter}: ...`);

  let fd: number;
  try {
    fd = fs.openSync(`\\\\.\\${letter}:`, 'r');
  } catch (e: any) {
    sendError(`Cannot open volume for deep scan: ${e.message}`);
    return 0;
  }

  let found = 0;
  const CHUNK_SIZE = 1024 * 1024; // 1MB per read
  const chunk = Buffer.alloc(CHUNK_SIZE);
  let position = 0;
  let totalSize = 0;
  let bytesPerSector = 512;

  // Get volume size from boot sector
  try {
    const boot = Buffer.alloc(512);
    fs.readSync(fd, boot, 0, 512, 0);
    bytesPerSector = boot.readUInt16LE(0x0B) || 512;
    const totalSectors = Number(boot.readBigInt64LE(0x28));
    totalSize = totalSectors * bytesPerSector;
    if (totalSize <= 0) totalSize = 500 * 1024 * 1024 * 1024; // fallback 500GB
  } catch {
    totalSize = 500 * 1024 * 1024 * 1024;
  }

  const maxScanBytes = Math.min(totalSize, 100 * 1024 * 1024 * 1024); // Cap at 100GB
  const startTime = Date.now();

  try {
    while (position < maxScanBytes && !isCancelled) {
      await waitIfPaused();

      let bytesRead = 0;
      try {
        bytesRead = fs.readSync(fd, chunk, 0, CHUNK_SIZE, position);
      } catch { break; }
      if (bytesRead === 0) break;

      // Scan chunk for signatures at sector boundaries.
      for (let off = 0; off < bytesRead - 16; off += bytesPerSector) {
        const result = matchSignature(chunk, off);
        if (!result) continue;

        const absoluteOffset = position + off;
        const sectorNum = Math.floor(absoluteOffset / bytesPerSector);
        const estimate = estimateCarvedSize(fd, absoluteOffset, result.ext, totalSize, result.estimatedSize);
        const baseProb = getProbability(result.ext, 'signature_carve', false);
        const prob = estimate.hasTerminator ? baseProb : Math.min(baseProb, 35);

        const file = {
          id: `ds-${++fileIdCounter}`,
          name: `recovered_${fileIdCounter}`,
          extension: result.ext,
          path: `${letter}:\\ [Sector ${sectorNum}]`,
          size: estimate.size,
          status: getStatus(prob),
          probability: prob,
          sectorStart: sectorNum,
          sectorCount: Math.ceil(estimate.size / bytesPerSector),
          source: 'signature_carve' as const,
          driveLetter: letter,
          bytesPerSector,
          hasTerminator: estimate.hasTerminator,
          recoveryNote: estimate.note
        };

        sendFile(file);
        found++;
      }

      position += bytesRead;

      // Send progress every 10MB
      if (position % (10 * 1024 * 1024) < CHUNK_SIZE) {
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? position / elapsed : 0;
        const remaining = speed > 0 ? (maxScanBytes - position) / speed : 0;

        sendProgress({
          scannedSectors: Math.floor(position / bytesPerSector),
          totalSectors: Math.floor(maxScanBytes / bytesPerSector),
          percentage: Math.min(Math.round((position / maxScanBytes) * 100), 99),
          foundFiles: found,
          speed: Math.round(speed / (1024 * 1024)),
          eta: Math.round(remaining),
          isComplete: false, isPaused,
          currentOperation: `Carving sectors at ${Math.round(position / (1024 * 1024))} MB`,
          stage: 'Deep Scan'
        });
      }
    }
  } catch (e: any) {
    log(`Deep scan error: ${e.message}`);
  }

  try { fs.closeSync(fd); } catch {}
  log(`Deep scan complete: ${found} signatures found`);
  return found;
}

// ═══════════════════════════════════════════════════════════════
// MAIN SCAN ORCHESTRATION
// ═══════════════════════════════════════════════════════════════
async function runScan() {
  const letter = drivePath.replace(/[:\\\/]/g, '').toUpperCase().charAt(0);
  log(`Scan initiated: mode=${mode}, drive=${letter}:`);

  try {
    if (mode === 'quick') {
      // Stage 1: Recycle Bin
      sendProgress({ scannedSectors: 0, totalSectors: 100, percentage: 5, foundFiles: 0, speed: 0, eta: 30, isComplete: false, isPaused: false, currentOperation: 'Scanning Recycle Bin', stage: 'Recycle Bin' });
      const rbCount = await scanRecycleBin(letter);
      if (isCancelled) { sendDone(); return; }

      // Stage 2: MFT
      sendProgress({ scannedSectors: 0, totalSectors: 100, percentage: 30, foundFiles: rbCount, speed: 0, eta: 20, isComplete: false, isPaused: false, currentOperation: 'Parsing MFT deleted entries', stage: 'MFT Scan' });
      const mftCount = await scanMft(letter);
      if (isCancelled) { sendDone(); return; }

      sendProgress({ scannedSectors: 100, totalSectors: 100, percentage: 100, foundFiles: rbCount + mftCount, speed: 0, eta: 0, isComplete: true, isPaused: false, currentOperation: 'Complete', stage: 'Done' });

    } else {
      // Deep scan: raw sector carving
      const deepCount = await deepScan(letter);

      sendProgress({ scannedSectors: 100, totalSectors: 100, percentage: 100, foundFiles: deepCount, speed: 0, eta: 0, isComplete: true, isPaused: false, currentOperation: 'Complete', stage: 'Done' });
    }

    sendDone();
  } catch (err: any) {
    log(`Fatal scan error: ${err.message}`);
    sendError(`Recovery scan failed: ${err.message}`);
  }
}

runScan();
