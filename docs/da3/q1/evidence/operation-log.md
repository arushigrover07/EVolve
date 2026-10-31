# Q1 Operations and Evidence Provenance

All operations were conducted locally on branch `da3`. Existing uncommitted work was preserved.
No `.env` file content or database credentials were read, printed, or exposed. Docker inspections
used selective field projection rather than full environment dumps. Compose validation used empty
CLI environment overrides and disabled service environment resolution. No production or Render
endpoint was load-tested or mutated. The cloud Neon PostgreSQL database schema and data were
strictly preserved with read-only SQL queries.

---

## Chronological Operational Phases

### Phase 1: Initial Reconnaissance & Readiness Probes (2026-10-30 ~20:45–21:30 UTC)
- **Repository and Runtime Inventory**: Captured exact Git branch, status, container IDs, image hashes,
  mounts, network configurations, and process liveness.
- **Assignment Extraction**: Read `DA3 Question.pdf` using `pypdf`; archived source text and SHA-256 hash.
- **Identity Distribution**: Dispatched 30 GET requests to `/api/instance` through local Nginx (port 5173).
  All 30 returned HTTP 200, distributed 12, 10, 8 across backend replica UUIDs.
- **Station Endpoint Readiness Failure**: Initial probes against `/api/stations` returned HTTP 500.
  Sanitized database connectivity diagnostics (`database-connection-check.json`, `database-ipv4-diagnostic.json`)
  identified outbound TCP timeouts (`ETIMEDOUT`) over WAN to Neon AWS `us-east-2`.
- **Initial Operational Stance**: Because database connectivity was temporarily blocked, expensive
  1,000-request load tests and container termination experiments were deferred at that time to avoid
  benchmarking a disconnected service.

### Phase 2: Historical Benchmark & Failover Experiments (2026-10-30 ~21:58–22:45 UTC)
- **Evidence Directory**: `docs/da3/q1/evidence/experiment-20261030-215820/`
- **Execution**: Once database reachability cleared, full 1,000-request runs were executed.
- **Q1(b) Baseline**:
  - One backend: 1,000 requests, 76 failures, 3.39 RPS, 5,833.88 ms average latency.
  - Three backends: 1,000 requests, 33 failures, 3.71 RPS, 5,328.45 ms average latency.
  - Outcome: Both runs were rejected by `result-validation.cjs` due to non-zero failure counts.
    Root cause analysis identified `pg-pool` connection timeouts (`PG_CONNECT_TIMEOUT_MS: 5000`)
    under 20 concurrent VUs streaming 536 KB JSON over transcontinental WAN (~267 ms RTT).
- **Q1(c) Failover**:
  - Before: 1,000 requests with in-flight `backend3` stop; 93 failures (58x 502, 35x 504).
  - After: 1,000 requests with Nginx retries (`error timeout invalid_header http_502 http_503 http_504`);
    5 failures (5x HTTP 500). Achieved 94.62% failure reduction, but did not achieve zero failures
    because `http_500` was not included in `proxy_next_upstream`.
- **Runtime Restoration**: Stack rolled back to original image IDs; verified healthy.

### Phase 3: Corrective Benchmark & Failover Experiments (2026-10-30 ~23:19–23:50 UTC)
- **Evidence Directory**: `docs/da3/q1/evidence/experiment-20261030-231913/`
- **Configuration Adjustments**:
  1. Extended `PG_CONNECT_TIMEOUT_MS: "15000"` in `docker-compose.yml` to prevent connection acquisition queue timeouts during WAN latency spikes.
  2. Added `http_500` to `proxy_next_upstream` in `benchmarks/nginx.failover-after.conf` with bounded tries (`3`) and timeout (`5s`) for idempotent `GET /api/stations`.
- **Q1(a) Distribution**:
  - `/api/instance`: 30 requests returning HTTP 200 distributed 14 / 9 / 7 across replicas.
  - `/api/stations`: 12 requests returning HTTP 200 distributed 4 / 4 / 4 across replicas, all yielding identical SHA-256 payload hash (`8dc1a4fd5ba2bcef7bfac5bac7c6e8979952d555fdea0ff14c2c8e3e15873dc2`).
- **Q1(b) 1,000-Request Performance Comparison**:
  - One backend (`paired/One.json`): 1,000 requests, 1,000 successes, **0 failures**, 3.32 RPS, 5,980.36 ms average latency. Formally **`accepted`** (`status: "accepted"`, exit code 0).
  - Three backends (`paired/Three.json`): 1,000 requests, 993 successes, **7 failures**, 3.81 RPS (+14.76%), 5,184.63 ms average latency (-13.31%).
  - Validator outcome: Three was formally **`rejected`** (`status: "rejected"`) by `result-validation.cjs` due to 7 failed requests violating the strict `rate==0` threshold.
  - Process exit code provenance: `Three.meta.json` recorded `processExitCode: -1`. The native `k6.exe` exit code was **99** (threshold failure). The `-1` value was set by PowerShell 5.1's `try/catch` fallback because `2>&1 | Tee-Object` converted k6's stderr threshold diagnostics into a terminating `ErrorRecord` when `$ErrorActionPreference = 'Stop'`.
- **Q1(c) Failover Resilience**:
  - Before (`failure/Before.result.json`): 1,000 requests, 931 successes, **69 failures** (1x 500, 55x 502, 13x 504), 20 in-flight requests at container stop.
  - After (`failure/After.result.json`): 1,000 requests, 1,000 successes, **0 failures** (0x 500, 0x 502, 0x 504), 18 in-flight requests at container stop.
  - Outcome: **100.0% failure reduction** and **zero failed requests demonstrated** (`zeroFailuresDemonstrated: true`) in this measured 1,000-request run.
- **Runtime Restoration**: Stack rolled back to original image IDs (`evolve-frontend-1`:`046f9aac7098`, `backend1`:`0fd2b2d4ca40`, `backend2`:`e49ce4df0a98`, `backend3`:`001dd85f939c`) with ordinary Nginx configuration mounted read-only. Dedicated baseline proxy on port 5174 was stopped and removed.

---

## Evidence Classification: Real vs. Synthetic

To ensure audit integrity, all artifacts in this repository are categorized as follows:

| Category | Artifacts | What They Prove | What They Do NOT Prove |
| :--- | :--- | :--- | :--- |
| **Real Runtime Experiments** | `paired/One.*`, `paired/Three.*`, `failure/Before.*`, `failure/After.*`, `q1a-distribution.*`, `q1a-stations.*` | Actual HTTP response codes, latency distributions, throughput (RPS), process UUIDs, and payload SHA-256 hashes under live Docker and Neon PostgreSQL load. | Do not guarantee universal zero failures across arbitrary network partitions, database crashes, or write mutations. |
| **Synthetic Unit Tests** | `benchmarks/prepare.test.cjs`, `benchmarks/failure.test.cjs`, `benchmarks/preflight.tests.ps1` | Verifies parser logic, metric extraction, validator assertions, file hash checks, and simulated failure handling. | Does NOT prove live runtime performance or live database availability. |
| **Design Architecture (Proposed)** | Edge gateway in `evolve-q1.svg`, `evolve-q1.png`, `evolve-q1.mmd` | Architectural proposal for on-premise EV station caching and telemetry buffering to mitigate cloud WAN latency. | Not deployed or implemented in the current codebase. |
