const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const surface = read('src/main/services/scanner/surfaceScanEngine.ts')
const store = read('src/main/services/scanner/scanResultStore.ts')
const smart = read('src/main/services/scanner/smartScan.ts')
const surfaceUi = read('src/renderer/src/components/DiskSurfaceScanner.tsx')
const prediction = read('src/renderer/src/services/driveLifespan/predictionEngine.ts')
const stabilizer = read('src/main/services/stabilizer/sectorStabilizer.ts')

function mustContain(source, pattern, label) {
  assert.match(source, pattern, label)
}

function mustNotContain(source, pattern, label) {
  assert.doesNotMatch(source, pattern, label)
}

console.log('TEST 1: Healthy NVMe real-IO contract')
mustContain(surface, /CreateFile/, 'surface scan must open a physical device handle')
mustContain(surface, /ReadFile/, 'surface scan must read through ReadFile')
mustContain(surface, /DeviceIoControl/, 'surface scan must validate the physical device')
mustContain(surface, /FILE_FLAG_NO_BUFFERING/, 'surface scan must bypass buffered fake progress')
mustContain(surface, /actualBytesRead \+= bytesRead/, 'progress bytes must derive from completed reads')
mustContain(surface, /\[REAL_IO\]/, 'real IO telemetry log must be emitted')

console.log('TEST 2: External USB HDD throughput contract')
mustContain(surface, /throughputMBs/, 'per-read throughput must be calculated from read bytes and latency')
mustContain(surface, /readSpeedMBs = executionMode === 'REAL_SCAN'[\s\S]*actualBytesRead \/ elapsedSec \/ 1_048_576/, 'display speed must derive from actual bytes over elapsed time')
mustContain(surface, /bytesRead <= 0/, 'zero-byte reads must be guarded')

console.log('TEST 3: Unplug during scan contract')
mustContain(surface, /Drive disconnected during scan/, 'disconnect error must be explicit')
mustContain(surface, /deviceConnected/, 'device connection state must be validated each read')
mustContain(surface, /isDisconnectTelemetry/, 'disconnect telemetry must abort the scan')

console.log('TEST 4: SMART unsupported bridge contract')
mustContain(smart, /overallHealth: 'Unsupported'/, 'unsupported SMART must be represented explicitly')
mustContain(smart, /cachedOrUnsupported/, 'previous valid SMART values must be cached temporarily')
mustContain(surfaceUi, /N\/A/, 'UI must show N/A for unavailable numeric SMART health')

console.log('TEST 5: No-IO integrity failure contract')
mustContain(surface, /Scan integrity failure: no physical IO detected/, 'no-IO integrity failure must be explicit')
mustContain(surface, /noIoIterations > 3/, 'no IO activity for more than three iterations must abort')
mustContain(surface, /repeatedOffsetCount >= 3/, 'repeated offsets must abort')

console.log('TEST 6: No silent scan simulation')
mustContain(surface, /'REAL_SCAN' \| 'SIMULATION_MODE'/, 'explicit scan execution modes must exist')
mustContain(surfaceUi, /SIMULATION MODE ACTIVE/, 'manual simulation must be visibly badged')
mustNotContain(surface, /Math\.random|switching to simulation|entering simulation|isSimulated = true/, 'surface scan must not silently synthesize reads')
mustNotContain(stabilizer, /Math\.random|switching to diagnostic simulation|isSimulated = true/, 'sector stabilizer must not silently synthesize reads')
mustNotContain(store, /Stage 5 fallback/, 'stored scan lookup must not silently return another drive')
mustContain(prediction, /executionMode === 'REAL_SCAN'/, 'simulated surface data must not affect lifespan prediction')

console.log('All real-IO enforcement checks passed.')
