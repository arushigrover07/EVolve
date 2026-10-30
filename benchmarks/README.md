# Q1(b) benchmark tooling -- station API readiness blocked

Current Q1 milestone status is documented in docs/da3/q1/q1-report.md. Portable
k6 v1.8.2 is checksum-verified under ignored .local-tools; initialization and a
20-request /health functional smoke passed. No 1000-request station benchmark,
image alignment, service stop/recreation or migration was performed: the configured
Neon read connection reports ETIMEDOUT and /api/stations returns HTTP 500. Real
Q1(b)/(c) measurements remain absent. Ordinary Compose/Nginx is unchanged.

## Workload and enforcement

Both plans target GET /api/stations through Nginx: One at loopback port 5174 and
Three at loopback port 5173. This existing route performs a read-only station/charger
aggregation. Each accepted run requires exactly 1000 k6-counted client HTTP requests,
1000 completed iterations, 1000 named HTTP-200 checks, zero failed requests and
zero failed checks. The shared-iterations executor uses 20 VUs, not 1000 per VU.
Request timeout is 20 seconds. There is one GET per iteration, no setup/teardown
HTTP calls, no scripted retries and no followed redirects. TLS verification remains
enabled. The 30-minute scenario ceiling plus 25-second drain is an abort bound;
an incomplete run cannot be accepted.

The runner rejects all inherited K6_* variable names without printing their values
and uses an explicit empty k6 config file. The workload checks resolved
execution.test.options before each GET, and custom gauges record the actual
executor VU/iteration settings and the per-request timeout/redirect settings.
A different effective workload throws before sending a request and is rejected.
Twenty VUs is a modest identical starting setting for both pool configurations.
In-flight concurrency naturally tapers as the final iterations finish.

The guarantee is about k6-counted client requests, NOT exact wire transmissions,
backend executions or SQL statement counts. Backend attempts and database statement
counts are unmeasured; do not derive them from 1000 client requests. No warm-up
calls or readiness queries are hidden in the measured workload. The runner makes
two explicit unmeasured data-snapshot GETs as documented below. No /api/instance request
is part of the measured workload.

## Tool and artifacts

Portable k6 is now installed locally. The runner needs -K6Path pointing to its
executable unless it is on PATH. A system installation is unnecessary. Alternative
installation for another machine (not executed here):

    winget install k6 --source winget

Official installation: https://grafana.com/docs/k6/latest/set-up/install-k6/
No dependency was added to application packages. Existing Node runs validation.
The wrapper captures the installed k6 version and executable SHA256; usage reporting
is disabled and there are no remote script imports. Native initialization and resolved-workload gauges were verified with a separate
20-request /health smoke, not the database-backed benchmark.

The workload writes One.raw.json or Three.raw.json with the untouched summary and
configuration/endpoint. It never declares acceptance. After the process exits,
the wrapper writes .meta.json (including actual exit code) and invokes the shared
Node validator. A complete .json result is explicitly accepted or rejected. A crash,
nonzero exit, partial/missing raw summary or invalid metadata cannot become accepted.
An interrupted wrapper may leave raw evidence but no accepted result; comparison
then fails. The runner also preserves combined console output in a separate
.console.txt file. Existing artifacts are never overwritten.

The independent comparator validates configuration and exact endpoint, tool name,
nonempty version, hashes, run ID, explicit accepted status, exit code 0, counts,
checks, positive duration/RPS and finite nonnegative mean latency. Read-only station
response hashes must match before/after each run and between runs; this detects
observed data changes, not all possible transient changes. Two unmeasured snapshot
GETs bracket each 1000-request run; warmupRequests is fixed to zero for both plans. It reconciles
all reported values with raw metrics, named checks, threshold outcomes and resolved
workload gauges. It verifies separate raw and metadata artifact locations, SHA256 hashes and
contents (including the independently recorded process exit code), plus current workload/proxy file hashes. Both runs must use the same tool
binary/version, workload, approved images, concurrency and timeout. It does not
trust the acceptance flag alone. Missing, malformed or mismatched files fail closed.

This is evidence validation, not a cryptographic attestation: manually fabricated
artifacts cannot be made trustworthy solely by a local validator.

Metric sources: http_reqs count/rate, iterations count, checks passes/fails,
http_req_failed passes/fails/rate, http_req_duration avg (milliseconds), and
state.testRunDurationMs / 1000. Mean HTTP duration excludes initial DNS/TCP blocking.
Raw summaries are retained, and formulas use actual measured numbers:

    RPS improvement (%) = ((three RPS - one RPS) / one RPS) * 100
    Mean-time reduction (%) = ((one mean - three mean) / one mean) * 100

Negative values are retained. A zero baseline mean is accepted as a nonnegative
measurement, but its percentage reduction is undefined and reported as null.

## Image findings -- read-only inspection on 2026-10-30

The three existing API image IDs differ; compose.rollback.yml records them.
All three have identical filesystem layer hashes, creation timestamp, command
[node, server.js] and docker-entrypoint.sh entrypoint. Their per-service Compose
labels differ (backend1/backend2/backend3). Image IDs include configuration metadata,
so different IDs are expected with different labels even for identical filesystems.
The inspected build configuration gives all three the same backend build context
and Dockerfile. No OCI source-revision label was present. Therefore the intended
build input is shared, but a particular Git revision cannot be proven from the
images. The repository has uncommitted Stage 1 changes; HEAD alone is not proof
of the image's source snapshot.

Safest reversible alignment: after review, reuse the already-local backend1 image
ID for all three services. No rebuilding, retagging or pulling is necessary. The
benchmark override also pins the existing frontend image ID and mounts only the
benchmark-specific nginx.three.conf. The selected candidate IDs are:

    Q1B_BACKEND_IMAGE=sha256:0fd2b2d4ca403d6756563e75a1bb995f7972420bb6694e6d59062fa8b0356d96
    Q1B_PROXY_IMAGE=sha256:046f9aac7098d53939f4ce1f50a0c59e69100c7c0bf88938107112aa29bef8d0

These are candidates requiring approval, not an automatic approval record. Before
execution, re-inspect only image IDs/ownership; confirm original IDs still match
the rollback snapshot and preserve all original images. Do not inspect env fields.

### Future image/proxy alignment (NOT executed; separate approval required)

Set the two Q1B image variables above in an approved shell, then review:

    docker compose -p evolve -f docker-compose.yml -f benchmarks/compose.three.override.yml up -d --no-build --pull never --force-recreate backend1 backend2 backend3 frontend

Recreation is necessary to change an existing container's immutable image. This
command deliberately recreates all three APIs and the frontend. Connections drain
subject to the existing shutdown deadline; in-flight traffic can be interrupted,
instance UUIDs change, pools start cold and container IPs can change. Frontend
recreation refreshes static upstream DNS. Expect a service interruption; do this
only in an approved idle/maintenance window, not during a benchmark or booking.
No telemetry service is selected and no migration is performed. Existing database
configuration is supplied by Compose at that later authorized runtime step; no
credential values are copied into these preparation files.

## Runtime preflight and isolated baseline

The baseline project contains ONLY one additional proxy. It shares evolve_default,
uses the approved frontend image ID with pull_policy=never, binds only
127.0.0.1:5174 and forwards solely to the existing backend1. No backend, database
pool, worker or network is created by baseline startup.

manage-q1b-baseline.ps1 startup uses explicit -p evolve-q1b-baseline. Startup and
benchmark execution keep their strict original-stack checks: approved aligned
images, healthy/running APIs, expected frontend benchmark mount, aliases, ports
and no extra original-project services. Missing image approvals fail startup.
Before startup, existing baseline-project/name collisions and port occupancy fail.

Cleanup takes a separate recovery path BEFORE any original-stack/alignment checks.
It never needs original services to exist, run, be healthy or share image IDs.
It inventories baseline project labels AND the reserved baseline name; a name with
wrong ownership is an error, not an absent baseline. An absent baseline is a safe
no-op, even without image approvals. If present, cleanup requires the approved
immutable proxy image, exact project/service/name, full container ID, only the
expected external network, one read-only known Nginx bind mount/config and exact
loopback port mapping. Original-project IDs are protected. Another Docker container
publishing 5174 makes ownership ambiguous and cleanup fails. Docker Desktop does
not reliably attribute native host listener PIDs; cleanup makes no such claim and
never kills a host process.

Without -Execute, valid cleanup only reports its plan. With separately approved
-Execute, it repeats inspection and validation, rejects a changed container ID,
then uses ONLY `docker container rm --force <verified-full-ID>`. It never invokes
Compose down, --remove-orphans, pruning, image removal, or volume/network removal.
No name-based deletion or broad fallback exists. Removing a running baseline can
interrupt its own in-flight proxy requests; original application containers are
never removal targets. Missing originals, partial alignment and rollback are all
supported recovery states. An ownership/configuration mismatch stops all deletion.

Checks do not reserve a port or lock Docker: a concurrent external change between
preflight and operation remains possible. Docker also rejects a conflicting bind.
Do not run another Compose/Docker operation concurrently. A failed operation should
be inspected, not automatically retried or force-cleaned.

No baseline startup command bypassing these checks is recommended. After approving
image alignment, substitute the approved IDs in the following commands:

    ./scripts/manage-q1b-baseline.ps1 -Action Start -ApprovedBackendImage <ID> -ApprovedProxyImage <ID>

Without -Execute this performs read-only checks only. It currently MUST reject
the existing mixed-image/ordinary-Nginx stack. After a separate startup approval:

    ./scripts/manage-q1b-baseline.ps1 -Action Start -ApprovedBackendImage <ID> -ApprovedProxyImage <ID> -Execute

Run benchmarks sequentially only after readiness for database reads is separately
approved (liveness alone is insufficient):

    ./scripts/benchmark-q1b.ps1 -Configuration One -ApprovedBackendImage <ID> -ApprovedProxyImage <ID> -Run
    ./scripts/benchmark-q1b.ps1 -Configuration Three -ApprovedBackendImage <ID> -ApprovedProxyImage <ID> -Run
    ./scripts/compare-q1b.ps1

The runner repeats read-only runtime checks before either workload. It never
starts, stops or reconfigures containers. All target URLs are fixed loopback.

### Future cleanup and rollback (NOT executed)

Cleanup may run before OR after rollback, even if the original stack is unhealthy,
missing or partially recreated. To remove only the verified dedicated baseline:

    ./scripts/manage-q1b-baseline.ps1 -Action Cleanup -ApprovedProxyImage <ID> -Execute

The proxy ID is its approved original frontend image ID, not a backend image.
If no baseline exists, cleanup succeeds without removal; this also works with
`-Action Cleanup` alone. An absent baseline never blocks the rollback operation.
For a present but ambiguous baseline, stop and inspect; do not force a broader
cleanup. Original-stack recovery does not depend on deleting an absent baseline.

Before or after that independent cleanup, after reviewing the snapshot's IDs
against the preserved local originals, the original-stack rollback remains:

    docker compose -p evolve -f docker-compose.yml -f benchmarks/compose.rollback.yml up -d --no-build --pull never --force-recreate backend1 backend2 backend3 frontend

Rollback recreates those four services using their individually recorded original
images and restores the ordinary Nginx mount. It has the same interruption/cold-pool
impact and changes UUIDs. It does not undo database/application writes made by
unrelated traffic. Do not run down against the original project or prune images.

## Retry policy and fairness limitations

nginx.one.conf and nginx.three.conf both set proxy_next_upstream off. Only upstream
membership differs; proxy timeouts, paths, body/method forwarding and caching
settings match. Ordinary Compose/production Nginx is untouched. Runtime preflight
requires the benchmark-specific mount so it cannot silently benchmark the ordinary
retrying three-upstream config. Config validation is structural; native nginx -t
and loaded/runtime config verification remain later approved checks.

Retries are disabled to avoid hiding upstream failures. We STILL report client
counts only, not backend/SQL counts, because neither is independently instrumented.
Each target normally performs a SELECT, but failures, disconnects, other traffic
and transport behavior prevent equating logical client count with SQL executions.

Keep all other APIs/proxies idle for the relevant phase. No browser, imports,
telemetry or simultaneous benchmark. One API pool permits 5 connections versus 15
across three; baseline adds no pool. Neon latency, pool queueing, connection
warmness, cache state, run order, host contention and other Neon clients (including
existing hosting) can alter or reverse improvements. Record them in Notes. There
is no warm-up hidden in the 1000 requests; approve and record one separately if
needed. Actual read connectivity currently fails with ETIMEDOUT; station requests return
HTTP 500. Do not proceed until readiness has been re-established.

## Offline verification

    node --check benchmarks/q1b.mjs
    node --check benchmarks/result-validation.cjs
    node --test benchmarks/prepare.test.cjs
    ./benchmarks/preflight.tests.ps1
    ./scripts/validate-q1b.ps1
    git diff --check

PowerShell Parser.ParseFile checks all q1b scripts without executing managers or
runners. Unit tests use synthetic states/metrics and isolated temporary files,
never saved under benchmarks/results and never interpreted as real measurements.
Compose validation uses an empty CLI env file with --no-env-resolution and
--no-interpolate: no .env contents are read and no containers are started.
