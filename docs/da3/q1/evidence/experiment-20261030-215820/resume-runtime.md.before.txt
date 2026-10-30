# Resume Q1 runtime evidence safely — NOT executed

Current state: original four containers preserved; ordinary Nginx mount; no baseline;
station API HTTP 500 and read-only database connection ETIMEDOUT. Stop here until
read connectivity is restored through an authorized process. Do not disable TLS or
change credentials/schema as an experiment. The underlying cause is not established.

## Gates and exact scope

1. Confirm da3 and preserve all working changes. Re-inventory full container IDs,
   immutable images, project/service ownership, mounts, networks, ports and active
   load tools. Compare original image IDs to compose.rollback.yml. Preserve all images.
2. Run offline tests and cleanup recovery tests. Cleanup must work with missing,
   unhealthy, mixed-image or rolled-back originals; do not weaken start/run validation.
3. Verify successful local station reads from each backend and through 5173. Confirm
   no browser/worker/unrelated activity; arrange an idle window. Database readiness
   is separate from /health. No benchmark should run against known HTTP 500 responses.
4. Revalidate the exact approved image IDs below and all rollback images locally.
   Do not build, pull, retag or remove images. Recovery recreates only four owned
   services under project evolve. Expect interruption, new UUIDs/IPs and cold pools.

```powershell
$backend = 'sha256:0fd2b2d4ca403d6756563e75a1bb995f7972420bb6694e6d59062fa8b0356d96'
$proxy = 'sha256:046f9aac7098d53939f4ce1f50a0c59e69100c7c0bf88938107112aa29bef8d0'
$env:Q1B_BACKEND_IMAGE = $backend
$env:Q1B_PROXY_IMAGE = $proxy
$k6 = (Get-ChildItem .local-tools -Recurse -Filter k6.exe | Select-Object -First 1).FullName
```

Only after all gates pass, the scoped alignment operation is:

```powershell
docker compose -p evolve -f docker-compose.yml -f benchmarks/compose.three.override.yml up -d --no-build --pull never --force-recreate backend1 backend2 backend3 frontend
```

Inspect new identities, liveness/readiness, common immutable image and benchmark
Nginx mount. Frontend recreation refreshes static upstream DNS. No telemetry service
is selected. If startup/alignment fails, inspect and use the rollback below; do not
continue a benchmark or remove anything broadly. Existing service configuration is
supplied by Compose without copying secrets into evidence.

## Q1(a) and Q1(b)

Collect identity distribution into a NEW evidence directory; do not overwrite the
existing genuine observations. Check API readiness again. Start the baseline only
through its checked manager (explicit dedicated project evolve-q1b-baseline):

```powershell
./scripts/manage-q1b-baseline.ps1 -Action Start -ApprovedBackendImage $backend -ApprovedProxyImage $proxy
./scripts/manage-q1b-baseline.ps1 -Action Start -ApprovedBackendImage $backend -ApprovedProxyImage $proxy -Execute
$results = 'docs/da3/q1/benchmarks/paired-NEW-TIMESTAMP'
./scripts/benchmark-q1b.ps1 -Configuration One -ApprovedBackendImage $backend -ApprovedProxyImage $proxy -K6Path $k6 -ResultDirectory $results -Run
./scripts/benchmark-q1b.ps1 -Configuration Three -ApprovedBackendImage $backend -ApprovedProxyImage $proxy -K6Path $k6 -ResultDirectory $results -Run
./scripts/compare-q1b.ps1 -ResultDirectory $results
```

Both runs use
1000 measured client requests, 20 VUs, 20-second timeout and no warm-up. Two separate
unmeasured snapshot GETs bracket each run; data hashes must match. Do not change
settings after viewing results. Preserve console/raw/metadata/result artifacts.

## Independent baseline cleanup, before OR after rollback

```powershell
./scripts/manage-q1b-baseline.ps1 -Action Cleanup -ApprovedProxyImage $proxy
./scripts/manage-q1b-baseline.ps1 -Action Cleanup -ApprovedProxyImage $proxy -Execute
```

An absent baseline is a successful no-op even if original APIs are absent/unhealthy
or rolled back to different images. A present baseline requires all ownership,
image, mount, port and network checks. Only its exact verified full container ID
can be removed; no network/volume/image is removed. Ambiguity must stop deletion.
Rollback of originals does not depend on deleting an absent baseline.

## Q1(c), only after baseline cleanup and readiness

For each phase, change ONLY the frontend benchmark mount using the explicit three
files. Recheck exact ownership, alignment, readiness and absence of unrelated traffic.
Use a NEW failure output directory for the paired runs:

```powershell
$failure = 'docs/da3/q1/benchmarks/failure-NEW-TIMESTAMP'
$env:Q1C_PHASE = 'before'
docker compose -p evolve -f docker-compose.yml -f benchmarks/compose.three.override.yml -f benchmarks/compose.failover.override.yml up -d --no-build --pull never --no-deps --force-recreate frontend
./scripts/run-q1c.ps1 -Phase Before -ApprovedBackendImage $backend -ApprovedProxyImage $proxy -K6Path $k6 -ResultDirectory $failure -Run
$env:Q1C_PHASE = 'after'
docker compose -p evolve -f docker-compose.yml -f benchmarks/compose.three.override.yml -f benchmarks/compose.failover.override.yml up -d --no-build --pull never --no-deps --force-recreate frontend
./scripts/run-q1c.ps1 -Phase After -ApprovedBackendImage $backend -ApprovedProxyImage $proxy -K6Path $k6 -ResultDirectory $failure -Run
node benchmarks/failure-validation.cjs compare $failure
```

The controller verifies its own active k6 process/in-flight requests, then stops
ONLY the exact owned backend3 full ID. Finally it starts that SAME ID and waits for
health. Inspect recoverySucceeded and application readiness, not just process exit.
If recovery target changes, it refuses broader recovery. Preserve failure evidence;
never call an incomplete experiment accepted or claim zero failures from unit tests.

## Rollback to original images and ordinary Nginx

After validating the preserved IDs against the snapshot, this restores the three
original, potentially different backend image IDs and ordinary frontend mount:

```powershell
docker compose -p evolve -f docker-compose.yml -f benchmarks/compose.rollback.yml up -d --no-build --pull never --force-recreate backend1 backend2 backend3 frontend
```

This recreates only the four named services in evolve. Confirm exact service
ownership, original images, frontend/nginx.compose.conf readonly mount, DNS aliases,
5173 listener and process/API readiness. UUIDs/pools/in-flight requests may change.
Repeat independent cleanup if needed; absent baseline must succeed. Do not use
compose down, prune, remove-orphans or remove networks, volumes or images. Save a
sanitized final inventory. Render configuration and the cloud schema stay untouched.
