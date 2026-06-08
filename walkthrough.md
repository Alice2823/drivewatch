# DriveWatch Real Surface Scan Walkthrough

## Summary

DriveWatch surface scanning now uses explicit execution modes:

- `REAL_SCAN`: the default and only mode that can affect surface telemetry, lifespan, reliability, or risk scoring.
- `SIMULATION_MODE`: manual opt-in only, visibly badged in the UI, excluded from all scoring paths.

Real scans fail closed. If raw disk access, device validation, byte reads, or integrity checks fail, the scan aborts and no synthetic progress is generated.

## Real IO Pipeline

1. `surface:start` passes the scan mode plus execution mode from renderer to Electron main.
2. `surfaceScanEngine.ts` clears previous scan cache for the selected disk before starting.
3. `REAL_SCAN` starts a persistent PowerShell raw-reader process.
4. The raw reader opens `\\.\PhysicalDriveN` once with `CreateFile`.
5. The handle is validated with `DeviceIoControl`.
6. Every scan iteration calls `ReadFile` against an aligned no-buffering allocation.
7. Progress advances only after a completed read returns `bytesRead > 0`.
8. Throughput uses `actualBytesRead / elapsedTime`.
9. Sector map colors are written only from completed read outcomes.

## Abort Conditions

The scan aborts immediately when any of these happen:

- Device handle is invalid.
- Device is no longer connected.
- `ReadFile` returns zero bytes.
- The same offset repeats repeatedly.
- No IO activity is detected for more than three iterations.
- No-buffering validation is not active.

The explicit integrity error is:

```text
Scan integrity failure: no physical IO detected
```

USB removal reports:

```text
Drive disconnected during scan
```

## Sector Map Rules

- Green: successful real read below latency threshold.
- Yellow: successful real read with latency threshold breach.
- Red: actual read failure or unreadable latency threshold.
- Gray: unscanned.

`SIMULATION_MODE` can still draw illustrative blocks, but it is visibly labeled and stores `isSimulated: true` plus `executionMode: SIMULATION_MODE`.

## SMART Rules

Unavailable SMART data now resolves as `Unsupported`/`N/A`, not `0%`.

Previous valid SMART telemetry is cached briefly and marked stale when reused. Unsupported USB bridges remain `N/A` unless valid SMART data was recently available.

## Validation Commands

```bash
npm run test:real-io
npm run typecheck
npm run build
```

## Files Changed

- `src/main/services/scanner/surfaceScanEngine.ts`
- `src/main/services/scanner/scanResultStore.ts`
- `src/main/services/scanner/smartScan.ts`
- `src/main/services/scanner/healthScore.ts`
- `src/main/services/stabilizer/sectorStabilizer.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- `src/renderer/src/components/DiskSurfaceScanner.tsx`
- `src/renderer/src/components/DriveHealthScanner.tsx`
- `src/renderer/src/components/explore/DriveLifespanPanel.tsx`
- `src/renderer/src/services/driveLifespan/*`
- `tests/real-io-enforcement.test.cjs`
