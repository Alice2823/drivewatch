# Disconnect Test Results

## Automated Contract Result

The automated real-IO enforcement test verifies that disconnect handling is wired into the scan loop:

- `deviceConnected` is checked per read.
- invalid handles abort the scan.
- the exact UI error is present: `Drive disconnected during scan`.
- progress is not advanced after the abort path.

Command:

```bash
npm run test:real-io
```

Result:

```text
TEST 3: Unplug during scan contract
All real-IO enforcement checks passed.
```

## Physical USB Pull Test

Status: requires a Windows host with an external USB disk attached.

Expected result during a live `REAL_SCAN`:

- UI changes to error state immediately.
- Last progress value remains frozen.
- sector map stops changing.
- `surface:error` receives `Drive disconnected during scan`.
- no scan result is saved as a successful real scan.

## Manual Procedure

1. Start DriveWatch as Administrator.
2. Select an external USB HDD or SSD.
3. Set I/O Enforcement to `REAL_SCAN`.
4. Start a Quick or Full scan.
5. Physically unplug the USB device while the scan is active.
6. Confirm the UI error and frozen progress.
7. Confirm the main-process log contains `deviceConnected=false` or `handleValid=false`.
