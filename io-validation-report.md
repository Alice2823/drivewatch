# IO Validation Report

## Enforcement Status

`REAL_SCAN` now requires a persistent physical disk handle and low-level read completion before any scan progress advances.

Validated primitives in the scan engine:

- `CreateFile`
- `ReadFile`
- `DeviceIoControl`
- `FILE_FLAG_NO_BUFFERING`
- aligned `VirtualAlloc` read buffers

## Per-Read Telemetry

Every read emits:

```text
[REAL_IO]
device=\\.\PhysicalDriveN
handleValid=true
deviceConnected=true
sector=...
offset=...
bytesRequested=...
bytesRead=...
readLatency=...
readSuccess=true
throughputMBs=...
```

## Integrity Rules

The scan aborts on:

- `bytesRead == 0`
- repeated offsets
- `ioActivityBytes <= 0` for more than three reads
- disconnected device
- invalid handle
- missing no-buffering validation

## Throughput

Displayed MB/s is calculated as:

```text
actualBytesRead / elapsedTime
```

No synthetic throughput is used in `REAL_SCAN`.
