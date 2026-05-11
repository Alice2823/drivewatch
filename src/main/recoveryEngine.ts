import { Worker } from 'worker_threads';
import { join } from 'path';
import { BrowserWindow, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export class RecoveryEngine {
  private worker: Worker | null = null;
  private mainWindow: BrowserWindow;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  public startScan(drivePath: string, mode: 'quick' | 'deep') {
    console.log(`[RecoveryEngine] Initializing ${mode} scan for ${drivePath}`);

    if (this.worker) {
      console.log('[RecoveryEngine] Terminating existing worker');
      try { this.worker.terminate(); } catch {}
      this.worker = null;
    }

    try {
      const workerPath = join(__dirname, 'RecoveryWorker.js');
      console.log(`[RecoveryEngine] Worker path: ${workerPath}`);

      this.worker = new Worker(workerPath, {
        workerData: { drivePath, mode }
      });

      this.worker.on('message', (msg) => {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        try {
          switch (msg.type) {
            case 'progress':
              this.mainWindow.webContents.send('recovery:progress', msg.progress);
              break;
            case 'file_found':
              this.mainWindow.webContents.send('recovery:file-found', msg.file);
              break;
            case 'status':
              console.log(`[RecoveryEngine] Status: ${msg.status}`);
              this.mainWindow.webContents.send('recovery:status', msg.status);
              break;
            case 'error':
              console.error(`[RecoveryEngine] Error: ${msg.error}`);
              this.mainWindow.webContents.send('recovery:error', msg.error);
              break;
            case 'done':
              console.log('[RecoveryEngine] Scan complete');
              this.mainWindow.webContents.send('recovery:done');
              this.worker = null;
              break;
          }
        } catch (e: any) {
          console.error(`[RecoveryEngine] Message handler error: ${e.message}`);
        }
      });

      this.worker.on('error', (err) => {
        console.error(`[RecoveryEngine] Worker crash: ${err.message}`);
        if (!this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('recovery:error', `Worker failure: ${err.message}`);
        }
        this.worker = null;
      });

      this.worker.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.error(`[RecoveryEngine] Worker exited with code ${code}`);
          if (!this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('recovery:error', `Recovery process stopped (Code: ${code})`);
          }
        }
        this.worker = null;
      });

    } catch (err: any) {
      console.error(`[RecoveryEngine] Init failure: ${err.message}`);
      this.mainWindow.webContents.send('recovery:error', `Initialization error: ${err.message}`);
    }
  }

  public pauseScan() { this.worker?.postMessage('pause'); }
  public resumeScan() { this.worker?.postMessage('resume'); }

  public stopScan() {
    if (this.worker) {
      this.worker.postMessage('cancel');
      setTimeout(() => {
        try { this.worker?.terminate(); } catch {}
        this.worker = null;
      }, 500);
    }
  }

  public async selectDestination(): Promise<string | null> {
    const result = await dialog.showOpenDialog(this.mainWindow, {
      title: 'Select Recovery Destination Folder',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Select Destination'
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  }

  public async recoverFile(
    file: any,
    destinationPath: string
  ): Promise<{ success: boolean; recoveredPath?: string; error?: string; quality?: string }> {
    console.log(`[Recovery] === START RECOVERY ===`);
    console.log(`[Recovery] File: ${file.name}.${file.extension} (${formatSize(file.size)})`);
    console.log(`[Recovery] Source: ${file.source}, Drive: ${file.driveLetter}`);
    console.log(`[Recovery] Has dataRuns: ${!!(file.dataRuns?.length)}, Has residentData: ${!!(file.residentData)}, Has recycleBinPath: ${!!(file.recycleBinPath)}`);

    // Safety: prevent recovery to source drive for raw-read strategies.
    // Recycle Bin files are safe copies and can be recovered to the same drive.
    if (!destinationPath) return { success: false, error: 'No destination selected' };

    const srcLetter = (file.driveLetter || '').toUpperCase();
    const destLetter = destinationPath.charAt(0).toUpperCase();
    const isSameDrive = srcLetter && srcLetter === destLetter;

    // Only block same-drive for raw cluster / sector recovery (MFT data-run or signature carve),
    // because writing while reading the same volume can overwrite the data we're trying to read.
    // Recycle Bin recovery is a simple file copy, so it's perfectly safe on the same drive.
    if (isSameDrive && file.source !== 'recycle_bin') {
      return { success: false, error: `Safety violation: Cannot recover to the same source drive (${srcLetter}:). Please select a different drive as the destination to avoid overwriting recoverable data.` };
    }

    // Check free space
    try {
      const destStat = fs.statfsSync(destinationPath);
      const freeBytes = destStat.bfree * destStat.bsize;
      if (file.size > freeBytes) {
        return { success: false, error: `Insufficient space. Need ${formatSize(file.size)}, have ${formatSize(freeBytes)}` };
      }
    } catch {}

    const outName = buildSafeOutputName(file.name, file.extension);
    let outPath = path.join(destinationPath, outName);

    // Avoid overwriting existing files
    if (fs.existsSync(outPath)) {
      const parsedOut = path.parse(outName);
      const base = parsedOut.name;
      const ext = parsedOut.ext.replace(/^\./, '');
      let counter = 1;
      while (fs.existsSync(outPath)) {
        outPath = path.join(destinationPath, `${base}_recovered_${counter}.${ext}`);
        counter++;
      }
    }

    try {
      let recoveredBuf: Buffer | null = null;

      // === STRATEGY 1: Recycle Bin copy (highest reliability) ===
      if (file.source === 'recycle_bin' && file.recycleBinPath) {
        console.log(`[Recovery] Strategy: Recycle Bin copy`);
        console.log(`[Recovery] Source path: ${file.recycleBinPath}`);
        if (!fs.existsSync(file.recycleBinPath)) {
          return { success: false, error: 'Recycle Bin file no longer exists (may have been purged)' };
        }
        fs.copyFileSync(file.recycleBinPath, outPath);
        const stat = fs.statSync(outPath);
        console.log(`[Recovery] Copied ${stat.size} bytes`);
        const quality = validateFile(outPath, file.extension);
        console.log(`[Recovery] Validation: ${quality}`);
        return { success: true, recoveredPath: outPath, quality };
      }

      // === STRATEGY 2: Resident data (small files stored in MFT record) ===
      if (file.residentData && Array.isArray(file.residentData) && file.residentData.length > 0) {
        console.log(`[Recovery] Strategy: Resident MFT data (${file.residentData.length} bytes)`);
        recoveredBuf = Buffer.from(file.residentData);
      }

      // === STRATEGY 3: Data-run cluster recovery ===
      if (!recoveredBuf && file.dataRuns && Array.isArray(file.dataRuns) && file.dataRuns.length > 0 && file.driveLetter) {
        console.log(`[Recovery] Strategy: Data-run cluster recovery`);
        console.log(`[Recovery] Runs: ${JSON.stringify(file.dataRuns)}`);
        console.log(`[Recovery] Cluster size: ${file.bytesPerCluster || 4096}`);
        recoveredBuf = await this.readFromDataRuns(file);
      }

      // === STRATEGY 4: Raw sector fallback (deep scan carved files) ===
      if (!recoveredBuf && file.source === 'signature_carve' && file.driveLetter && typeof file.sectorStart === 'number') {
        console.log(`[Recovery] Strategy: Raw sector read`);
        console.log(`[Recovery] Sector: ${file.sectorStart}, Size: ${file.size}`);
        recoveredBuf = await this.readFromSectors(file);
      }

      if (!recoveredBuf && file.source === 'mft_deleted') {
        return {
          success: false,
          error: 'This deleted MFT entry no longer contains readable file data. Try Deep Scan to carve the file by signature.'
        };
      }

      // No recovery strategy available
      if (!recoveredBuf) {
        return { success: false, error: 'No recovery data available. File clusters may have been overwritten.' };
      }

      // Trim to actual file size
      if (recoveredBuf.length > file.size) {
        recoveredBuf = recoveredBuf.subarray(0, file.size);
      }
      recoveredBuf = trimRecoveredBuffer(recoveredBuf, file.extension);

      console.log(`[Recovery] Recovered buffer: ${recoveredBuf.length} bytes`);
      console.log(`[Recovery] First 16 bytes: ${recoveredBuf.subarray(0, 16).toString('hex')}`);

      // Pre-write validation
      const preCheck = validateBuffer(recoveredBuf, file.extension);
      console.log(`[Recovery] Pre-write validation: ${preCheck}`);

      if (preCheck === 'EMPTY' || preCheck === 'ZEROED') {
        return { success: false, error: `Recovery failed: File data is ${preCheck.toLowerCase()}. Clusters have been overwritten or zeroed by the filesystem.`, quality: 'Unrecoverable' };
      }
      if (preCheck === 'NO_HEADER') {
        return { success: false, error: `Recovery failed: The recovered bytes do not contain a valid .${file.extension} header.`, quality: 'Corrupted' };
      }

      // Write file
      fs.writeFileSync(outPath, recoveredBuf);
      const stat = fs.statSync(outPath);
      console.log(`[Recovery] Written ${stat.size} bytes to ${outPath}`);

      // Post-write validation
      const quality = validateFile(outPath, file.extension);
      console.log(`[Recovery] Final quality: ${quality}`);
      console.log(`[Recovery] === END RECOVERY ===`);

      if (quality === 'Corrupted') {
        return {
          success: true,
          recoveredPath: outPath,
          quality,
          error: `Warning: File was recovered but appears corrupted. The file header/structure is invalid — clusters may have been partially overwritten.`
        };
      }

      return { success: true, recoveredPath: outPath, quality };
    } catch (err: any) {
      console.error(`[Recovery] Fatal error: ${err.message}`);
      return { success: false, error: `Recovery failed: ${err.message}` };
    }
  }

  private async readFromDataRuns(file: any): Promise<Buffer | null> {
    const volumePath = `\\\\.\\${file.driveLetter}:`;
    const clusterSize = file.bytesPerCluster || 4096;
    let fd: number;
    try {
      fd = fs.openSync(volumePath, 'r');
    } catch (e: any) {
      console.error(`[Recovery] Cannot open volume: ${e.message}`);
      return null;
    }

    try {
      const chunks: Buffer[] = [];
      let totalRead = 0;

      for (let i = 0; i < file.dataRuns.length; i++) {
        const run = file.dataRuns[i];
        if (totalRead >= file.size) break;

        const byteOffset = run.clusterOffset * clusterSize;
        const runBytes = run.clusterCount * clusterSize;
        const needed = Math.min(runBytes, file.size - totalRead);
        
        // Dynamic alignment based on volume sector size
        const sectorSize = file.bytesPerSector || 512;
        const alignedSize = Math.ceil(needed / sectorSize) * sectorSize;
        const buf = Buffer.alloc(alignedSize);

        console.log(`[Recovery]   Run ${i}: cluster=${run.clusterOffset}, count=${run.clusterCount}, offset=0x${byteOffset.toString(16)}, read=${alignedSize} (align=${sectorSize})`);

        try {
          fs.readSync(fd, buf, 0, alignedSize, byteOffset);
          chunks.push(buf.subarray(0, needed));
          totalRead += needed;
        } catch (e: any) {
          console.error(`[Recovery]   Run ${i} READ FAILED at offset ${byteOffset}: ${e.message}`);
          chunks.push(Buffer.alloc(needed)); // zero-fill unreadable
          totalRead += needed;
        }
      }

      fs.closeSync(fd);
      return Buffer.concat(chunks);
    } catch (e: any) {
      try { fs.closeSync(fd); } catch {}
      console.error(`[Recovery] Data run recovery error: ${e.message}`);
      return null;
    }
  }

  private async readFromSectors(file: any): Promise<Buffer | null> {
    const volumePath = `\\\\.\\${file.driveLetter}:`;
    let fd: number;
    try {
      fd = fs.openSync(volumePath, 'r');
    } catch (e: any) {
      console.error(`[Recovery] Cannot open volume: ${e.message}`);
      return null;
    }

    try {
      const sectorSize = file.bytesPerSector || 512;
      const offset = file.sectorStart * sectorSize;
      const alignedSize = Math.ceil(file.size / sectorSize) * sectorSize;

      // Read in chunks of 1MB to avoid large buffer issues
      const CHUNK = 1024 * 1024;
      const chunks: Buffer[] = [];
      let pos = 0;

      while (pos < alignedSize) {
        const readLen = Math.min(CHUNK, alignedSize - pos);
        // Ensure readLen is also sector-aligned for Windows
        const alignedReadLen = Math.ceil(readLen / sectorSize) * sectorSize;
        const buf = Buffer.alloc(alignedReadLen);
        try {
          fs.readSync(fd, buf, 0, alignedReadLen, offset + pos);
          chunks.push(buf.subarray(0, Math.min(readLen, alignedSize - pos)));
        } catch (e: any) {
          console.error(`[Recovery] Sector read error at offset ${offset + pos}: ${e.message}`);
          chunks.push(Buffer.alloc(readLen));
        }
        pos += readLen;
      }

      fs.closeSync(fd);
      return Buffer.concat(chunks).subarray(0, file.size);
    } catch (e: any) {
      try { fs.closeSync(fd); } catch {}
      console.error(`[Recovery] Sector recovery error: ${e.message}`);
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// FILE SIGNATURE VALIDATORS
// ═══════════════════════════════════════════════════════════════

function buildSafeOutputName(name: string, extension: string): string {
  const safeBase = (name || 'recovered_file')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 180) || 'recovered_file';
  const safeExt = (extension || 'bin')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase() || 'bin';

  return `${safeBase}.${safeExt}`;
}

function trimRecoveredBuffer(buf: Buffer, ext: string): Buffer {
  const e = ext.toLowerCase();

  if (e === 'pdf') {
    const eof = Buffer.from('%%EOF');
    const idx = buf.lastIndexOf(eof);
    if (idx >= 0) {
      let end = idx + eof.length;
      while (end < buf.length && (buf[end] === 0x0D || buf[end] === 0x0A || buf[end] === 0x20 || buf[end] === 0x09)) {
        end++;
      }
      return buf.subarray(0, end);
    }
  }

  if (e === 'jpg' || e === 'jpeg') {
    for (let i = buf.length - 2; i >= 0; i--) {
      if (buf[i] === 0xFF && buf[i + 1] === 0xD9) {
        return buf.subarray(0, i + 2);
      }
    }
  }

  if (e === 'png') {
    const iend = Buffer.from('IEND');
    const idx = buf.lastIndexOf(iend);
    if (idx >= 0 && idx + 8 <= buf.length) {
      return buf.subarray(0, idx + 8);
    }
  }

  return buf;
}

function validateBuffer(buf: Buffer, ext: string): string {
  if (!buf || buf.length === 0) return 'EMPTY';

  // Check if buffer is all zeros (overwritten)
  let allZero = true;
  const checkLen = Math.min(buf.length, 4096);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] !== 0) { allZero = false; break; }
  }
  if (allZero) return 'ZEROED';

  const e = ext.toLowerCase();

  if (e === 'pdf') {
    const header = buf.subarray(0, 5).toString('ascii');
    if (!header.startsWith('%PDF')) return 'NO_HEADER';
    return 'VALID_HEADER';
  }

  if (e === 'jpg' || e === 'jpeg') {
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return 'NO_HEADER';
    return 'VALID_HEADER';
  }

  if (e === 'png') {
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) return 'NO_HEADER';
    return 'VALID_HEADER';
  }

  if (e === 'mp4' || e === 'mov') {
    if (buf.length >= 8) {
      const ftyp = buf.toString('ascii', 4, 8);
      if (ftyp === 'ftyp') return 'VALID_HEADER';
    }
    return 'NO_HEADER';
  }

  if (e === 'zip' || e === 'docx' || e === 'xlsx' || e === 'pptx') {
    if (buf[0] !== 0x50 || buf[1] !== 0x4B) return 'NO_HEADER';
    return 'VALID_HEADER';
  }

  return 'UNKNOWN';
}

function validateFile(filePath: string, ext: string): string {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return 'Empty';

    // Read first 8KB and last 8KB for validation
    const fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(Math.min(8192, stat.size));
    fs.readSync(fd, headerBuf, 0, headerBuf.length, 0);

    const tailSize = Math.min(8192, stat.size);
    const tailBuf = Buffer.alloc(tailSize);
    fs.readSync(fd, tailBuf, 0, tailSize, Math.max(0, stat.size - tailSize));
    fs.closeSync(fd);

    const e = ext.toLowerCase();

    if (e === 'pdf') {
      const header = headerBuf.subarray(0, 5).toString('ascii');
      const headerText = headerBuf.toString('ascii');
      const tail = tailBuf.toString('ascii');
      const hasHeader = header.startsWith('%PDF');
      const hasEOF = tail.includes('%%EOF');

      // Detect Adobe Illustrator placeholder PDFs
      const isIllustratorPlaceholder = headerText.includes('Adobe Illustrator') ||
        headerText.includes('saved without PDF Content') ||
        headerText.includes('Create PDF Compatible File');

      if (isIllustratorPlaceholder) {
        return 'Illustrator File (No PDF Content)';
      }

      if (hasHeader && hasEOF) return 'Excellent';
      if (hasHeader) return 'Partial (missing EOF)';
      return 'Corrupted';
    }

    if (e === 'jpg' || e === 'jpeg') {
      const hasSOI = headerBuf[0] === 0xFF && headerBuf[1] === 0xD8;
      const hasEOI = tailBuf[tailBuf.length - 2] === 0xFF && tailBuf[tailBuf.length - 1] === 0xD9;
      if (hasSOI && hasEOI) return 'Excellent';
      if (hasSOI) return 'Partial (missing EOI)';
      return 'Corrupted';
    }

    if (e === 'png') {
      const hasSig = headerBuf[0] === 0x89 && headerBuf[1] === 0x50;
      const iend = Buffer.from('IEND');
      let hasIEND = false;
      for (let i = 0; i < tailBuf.length - 4; i++) {
        if (tailBuf.subarray(i, i + 4).equals(iend)) { hasIEND = true; break; }
      }
      if (hasSig && hasIEND) return 'Excellent';
      if (hasSig) return 'Partial (missing IEND)';
      return 'Corrupted';
    }

    if (e === 'mp4' || e === 'mov') {
      if (headerBuf.length >= 8) {
        const ftyp = headerBuf.toString('ascii', 4, 8);
        if (ftyp === 'ftyp') return 'Good';
      }
      return 'Corrupted';
    }

    if (e === 'zip' || e === 'docx' || e === 'xlsx' || e === 'pptx') {
      if (headerBuf[0] === 0x50 && headerBuf[1] === 0x4B) return 'Good';
      return 'Corrupted';
    }

    if (['txt', 'log', 'json', 'xml', 'csv', 'ini', 'cfg', 'md', 'yaml', 'yml'].includes(e)) {
      // Check if content looks like text (no null bytes in first 1KB)
      const checkLen = Math.min(1024, headerBuf.length);
      let nullCount = 0;
      for (let i = 0; i < checkLen; i++) {
        if (headerBuf[i] === 0) nullCount++;
      }
      if (nullCount < checkLen * 0.1) return 'Good';
      return 'Corrupted';
    }

    return 'Unknown';
  } catch {
    return 'Error';
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}
