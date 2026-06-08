# Screenshots And Log Samples

## Simulation Badge

Expected visible UI when manual simulation is enabled:

```text
SIMULATION MODE ACTIVE
No physical IO is being performed. Results are excluded from lifespan, reliability, and risk scoring.
```

## Real IO Log Sample

```text
[REAL_IO]
device=\\.\PhysicalDrive1
handleValid=true
deviceConnected=true
sector=204800
offset=104857600
bytesRequested=1048576
bytesRead=1048576
readLatency=18.42
readSuccess=true
throughputMBs=54.29
```

## Integrity Failure Log Sample

```text
[REAL_IO]
device=\\.\PhysicalDrive1
handleValid=true
deviceConnected=true
sector=206848
offset=105906176
bytesRequested=1048576
bytesRead=0
readLatency=0.00
readSuccess=false
throughputMBs=0.00

Scan integrity failure: no physical IO detected
```

## Disconnect Log Sample

```text
[REAL_IO]
device=\\.\PhysicalDrive2
handleValid=false
deviceConnected=false
sector=409600
offset=209715200
bytesRequested=1048576
bytesRead=0
readLatency=0.00
readSuccess=false
throughputMBs=0.00

Drive disconnected during scan
```

## Task Manager Validation

During `REAL_SCAN`, Windows Task Manager should show disk read activity for the selected physical disk. If the scan loop observes more than three iterations without IO activity, DriveWatch aborts with:

```text
Scan integrity failure: no physical IO detected
```
