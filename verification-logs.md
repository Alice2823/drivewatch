# Verification Logs

## Automated Real IO Contract Tests

Command:

```bash
npm run test:real-io
```

Output:

```text
TEST 1: Healthy NVMe real-IO contract
TEST 2: External USB HDD throughput contract
TEST 3: Unplug during scan contract
TEST 4: SMART unsupported bridge contract
TEST 5: No-IO integrity failure contract
TEST 6: No silent scan simulation
All real-IO enforcement checks passed.
```

## TypeScript

Command:

```bash
npm run typecheck
```

Output:

```text
tsc --noEmit -p tsconfig.node.json --composite false
tsc --noEmit -p tsconfig.web.json --composite false
```

Result: passed.

## Build

Command:

```bash
npm run build
```

Output summary:

```text
main built in 937ms
preload built in 37ms
renderer built in 7.46s
```

Result: passed.

Note: the first sandboxed build attempt could not remove `out/main/chunks` due `EPERM`. The rerun outside the sandbox completed successfully.
