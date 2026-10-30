# EVolve: Digital Assignment 3 - Question 1

BACSE344 Cloud Infrastructure and Architecture | Branch `da3` | 30 October 2026 (IST)

## Outcome and evidence boundary

Question 1 totals **5 marks**: (a) 1, (b) 1.5, (c) 1.5, (d) 1. The original
`DA3 Question.pdf` was read; its exact Q1 text and source SHA256 are preserved in
[evidence/assignment-q1.txt](evidence/assignment-q1.txt) and
[evidence/assignment-source.json](evidence/assignment-source.json).

This report documents the executed experiments and evidence gathered under
[evidence/experiment-20261030-215820/](evidence/experiment-20261030-215820/).
Following an initial period where database connections experienced intermittent
latency/timeouts, full cloud database connectivity was confirmed and all Q1 runtime
experiments were completed:

1. **Q1(a) Request distribution**: Verified across 3 backend replicas using both
   30 identity requests (`/api/instance`: 12, 8, 10) and 12 database-backed station
   requests (`/api/stations`: 5, 3, 4) with 100% success and identical data SHA256.
2. **Q1(b) 1,000-request performance comparison**: Measured 1 backend (3.39 RPS,
   5,833.88 ms avg latency) versus 3 backends (3.71 RPS, 5,328.45 ms avg latency),
   demonstrating a **+9.4% RPS improvement** and an **8.7% latency reduction**.
   Both runs were rejected by the zero-failure acceptance criterion (`http_req_failed rate==0`,
   k6 exit code 99) due to cloud database connection pool queueing under load.
3. **Q1(c) Failover resilience**: Stopped `backend3` during active load (1,000 requests,
   20 VUs). Failures decreased from **93/1,000 (9.3%)** in the baseline to **5/1,000 (0.5%)**
   with Nginx failover—a measured **94.62% failure reduction**. Nginx failover
   completely eliminated all HTTP 502 (Bad Gateway) and 504 (Gateway Timeout) errors;
   the remaining 5 failures were HTTP 500 origin errors caused by database pool limits.
4. **Q1(d) Architecture diagram**: Complete architecture diagram with local ports,
   3 backends, Nginx proxy, Neon cloud database, Render hosted references, and a proposed
   purple edge gateway extension with domain-specific rationale.
5. **Restoration**: The original four image IDs and ordinary Nginx configuration were
   fully restored and verified healthy, returning HTTP 200 with identical station hashes.

Machine-readable execution details are recorded in [benchmarks/status.json](benchmarks/status.json)
and [q1-verification-matrix.md](q1-verification-matrix.md).

---

## Q1(a): EV charging peak and scaled architecture - 1 mark

### Domain scenario and busiest API

A holiday departure rush near a campus and adjoining highway causes many EV drivers
to search for charging stations and available chargers simultaneously. EVolve's station-list
UI fetches **GET /api/stations**. In `backend/app.js`, this route joins `stations` with
`chargers` and aggregates total, available, and charging counts, ordered by station ID.
It is the busiest shared read path during peak demand. It performs read-only SQL queries
without mutating bookings, sessions, or billing records.

### Actual local setup

- `frontend`: Serves the React build and runs the Nginx load balancer on container port 80,
  published at host port **5173**.
- `backend1`, `backend2`, `backend3`: Three replicas of the backend API listening on internal
  port **5000** on the shared `evolve_default` Docker network (no published host ports).
- Nginx upstream `evolve_api` round-robins across `backend1:5000`, `backend2:5000`, and `backend3:5000`.
- Connection pooling: Each backend instance is capped at `PG_POOL_MAX=5` (15 total connections
  across the three replicas) connecting via TLS to the cloud Neon PostgreSQL database.
- Telemetry worker is disabled in the API processes (`TELEMETRY_ENABLED=false`).

### Verified distribution evidence

1. **Identity requests (`/api/instance`)**:
   `./scripts/collect-q1a.ps1` sent 30 requests through host port 5173. All 30 returned
   HTTP 200 with matching process UUIDs across instances:
   - `84340d27-c6eb-41b6-9b92-6f9e52e32916`: **12 requests** (40%)
   - `8bb2c825-4a13-4492-b391-5f44329d8f9f`: **8 requests** (27%)
   - `c3ed4594-8a4e-4b71-9a8b-167b0a096489`: **10 requests** (33%)
   Detailed log: [evidence/q1a-distribution.csv](evidence/q1a-distribution.csv).

2. **Database-backed station queries (`/api/stations`)**:
   Under [evidence/experiment-20261030-215820/q1a-stations-summary.json](evidence/experiment-20261030-215820/q1a-stations-summary.json),
   12 successive database-backed requests were routed across all three backends:
   - `backend1` (`84340d27...`): **5 requests**
   - `backend2` (`8bb2c825...`): **3 requests**
   - `backend3` (`c3ed4594...`): **4 requests**
   All 12 returned HTTP 200 with identical station payload SHA256:
   `8dc1a4fd5ba2bcef7bfac5bac7c6e8979952d555fdea0ff14c2c8e3e15873dc2`.

---

## Q1(b): One backend versus three - 1.5 marks

### Controlled protocol

Load testing was conducted using portable native **k6 v1.8.2** (`.local-tools/k6-v1.8.2-windows-amd64/k6.exe`).
Both test runs strictly adhered to the same parameters:
- **Target endpoint**: `GET /api/stations`
- **Total requests**: Exactly 1,000 measured client requests
- **Concurrency**: 20 virtual users (VUs)
- **Request timeout**: 20 seconds
- **Warm-up**: 0 warm-up requests
- **Workload configuration**: Shared iterations (`shared-iterations` executor)
- **One backend baseline**: Routed to single backend via dedicated proxy at `127.0.0.1:5174`
- **Three backends**: Routed to the 3-backend cluster via proxy at `127.0.0.1:5173`

### Measured performance results

| Metric | One backend (Baseline) | Three backends (Scaled) | Measured Improvement |
|---|---:|---:|---:|
| **Target URL** | `http://127.0.0.1:5174/api/stations` | `http://127.0.0.1:5173/api/stations` | — |
| **Total client requests** | 1,000 | 1,000 | Identical load |
| **Concurrency** | 20 VUs | 20 VUs | Identical |
| **Successful requests (HTTP 200)** | 924 | 967 | +43 requests (+4.7%) |
| **Failed requests** | 76 | 33 | -43 failures (-56.6%) |
| **Requests per second (RPS)** | **3.39 RPS** | **3.71 RPS** | **+9.4% improvement** |
| **Average response time** | **5,833.88 ms** | **5,328.45 ms** | **8.7% reduction** (faster) |
| **Median response time** | 5,750.70 ms | 5,233.15 ms | 9.0% reduction |
| **95th percentile latency** | 7,183.49 ms | 6,839.81 ms | 4.8% reduction |
| **Total test duration** | 294.89 s | 269.52 s | 25.37 s faster |

- **RPS calculation**: `((3.710355 - 3.391098) / 3.391098) * 100 = +9.41%`
- **Average latency reduction**: `((5833.883446 - 5328.449515) / 5833.883446) * 100 = 8.66%` (~8.7%)

### Acceptance criterion evaluation

- **Result**: **REJECTED by the zero-failure acceptance criterion.**
- **Reason**: The benchmark validation harness enforces `http_req_failed rate==0`. Because the 1-backend
  run experienced 76 failed requests and the 3-backend run experienced 33 failed requests, k6 exited with code 99.
  Consequently, `result-validation.cjs` rejected the automated comparison run.
- **Root cause analysis**: Failures were HTTP 500 errors caused by connection pool contention (`PG_POOL_MAX=5`)
  and network query latency to the remote Neon PostgreSQL cloud database under 20 concurrent clients,
  rather than application crashes or local server faults. Scaling to 3 backends expanded total pool capacity
  from 5 to 15 connections, cutting failures by more than half (76 down to 33) and boosting throughput by 9.4%.

Raw artifact references:
- 1-Backend: [evidence/experiment-20261030-215820/paired/One.json](evidence/experiment-20261030-215820/paired/One.json)
- 3-Backends: [evidence/experiment-20261030-215820/paired/Three.json](evidence/experiment-20261030-215820/paired/Three.json)

---

## Q1(c): Failure handling - 1.5 marks

### Implemented experiment and retry policy

To test failover resilience under active traffic, 1,000 requests at 20 VUs were executed while one backend
instance (`backend3`) was actively stopped during the run (at offset ~8.5 seconds with 18-20 in-flight requests):

1. **Before configuration (`benchmarks/nginx.failover-before.conf`)**:
   Standard round-robin load balancing without automated retries or fast failover.
2. **After configuration (`benchmarks/nginx.failover-after.conf`)**:
   - Upstream server health parameters: `max_fails=1 fail_timeout=30s`.
   - Fast connection timeout: `proxy_connect_timeout 1s`.
   - Bounded idempotent request retries on `GET /api/stations`:
     `proxy_next_upstream error timeout http_502 http_503 http_504;`
     `proxy_next_upstream_tries 3;`
     `proxy_next_upstream_timeout 5s;`
   - Scoped strictly to read requests; non-idempotent methods are not retried.

### Measured before-and-after failure counts

| Metric | Before failover configuration | After failover configuration | Measured Change |
|---|---:|---:|---:|
| **Total client requests** | 1,000 | 1,000 | Identical load |
| **Concurrency / VUs** | 20 | 20 | Identical |
| **Instance stopped** | `backend3` (~8.5s into test) | `backend3` (~8.4s into test) | Identical fault injection |
| **Successful requests (HTTP 200)** | 907 | 995 | **+88 requests** |
| **Total failed requests** | **93** | **5** | **-88 failures (94.62% reduction)** |
| **HTTP 502 (Bad Gateway)** | **68** | **0** | **100% eliminated** |
| **HTTP 504 (Gateway Timeout)** | **13** | **0** | **100% eliminated** |
| **HTTP 500 (Internal Server Error)** | 12 | 5 | -7 errors |
| **Transport errors / client timeouts** | 0 | 0 | 0 |
| **Failure rate** | 9.3% | 0.5% | Reduced from 9.3% to 0.5% |

- **Failure reduction calculation**: `((93 - 5) / 93) * 100 = 94.62%`

### Technical analysis and zero-failure evaluation

- **Gateway resilience**: In the baseline run, terminating `backend3` generated **81 gateway errors**
  (68 HTTP 502s and 13 HTTP 504s) as Nginx routed traffic to an unreachable container.
  In the after-failover run, Nginx's retry policy immediately re-routed in-flight requests to surviving
  healthy backends (`backend1` and `backend2`), **reducing gateway errors to exactly 0**.
- **Origin database errors**: Five HTTP 500 responses occurred in the after-failover run. Because these
  originated from the cloud database pool timeout rather than an unreachable backend container, Nginx
  safely returned the response without retrying non-gateway errors.
- **Outcome**: Failures were reduced by **94.62%** (from 93 to 5), but absolute zero failures was
  not achieved due to remote Neon database latency under high concurrency.
- **Recovery verification**: After the test, `backend3` was restarted, verified healthy, and returned to
  the cluster ([evidence/experiment-20261030-215820/failure-summary.json](evidence/experiment-20261030-215820/failure-summary.json)).

---

## Q1(d): Actual architecture and proposed edge extension - 1 mark

![Actual local setup, separate hosted references and proposed edge gateway](architecture/evolve-q1.png)

Editable sources:
- Mermaid: [architecture/evolve-q1.mmd](architecture/evolve-q1.mmd)
- Vector graphic: [architecture/evolve-q1.svg](architecture/evolve-q1.svg)
- Renderer script: [render-q1-architecture.py](../../../scripts/render-q1-architecture.py)

### Component descriptions

1. **Local load-balanced cluster (Blue)**:
   - `frontend`: React SPA served via Nginx on container port 80, published at host **5173**.
   - `evolve_api` upstream: Round-robins across three Node.js Express backend containers (`backend1:5000`,
     `backend2:5000`, `backend3:5000`) on internal Docker network `evolve_default`.
   - Local test tools: k6 v1.8.2 and PowerShell automated benchmark runners.
2. **Cloud database (Red boundary)**:
   - Managed **Neon PostgreSQL** accessed via TLS. Provides persistent storage for stations, chargers,
     bookings, and sessions.
3. **Hosted cloud deployment (Grey)**:
   - **Render** cloud platform hosting the deployed frontend (`evolve-frontend-g9rs.onrender.com`) and
     backend API (`evolve-qvy1.onrender.com`) from previous deployment milestones.
4. **Proposed edge/fog extension (Purple)**:
   - **Proposed EV Charging-Site Edge Gateway**: Positioned on-premise at high-traffic EV charging plazas.
   - **Edge caching**: Caches recent station and charger availability (`GET /api/stations`) with a short
     TTL (e.g., 5 seconds) to handle local driver search surges without overloading the cloud WAN connection.
   - **Telemetry buffering**: Buffers local charging session metrics and telemetry during intermittent
     cellular/WAN dropouts, forward-syncing to the central API when connectivity is restored.
   - **Central consistency**: Slot bookings and billing calculations remain strictly centralized to prevent
     double-booking conflicts.

---

## Restoration and final health verification

Following the completion of all benchmarking and failover experiments, the runtime environment was rolled back
to its baseline state:
1. **Container images**: Restored the original distinct image IDs (`0fd2b2d4ca40`, `e49ce4df0a98`, `001dd85f939c`,
   and `046f9aac7098`) via `compose.rollback.yml` ([evidence/experiment-20261030-215820/rollback.txt](evidence/experiment-20261030-215820/rollback.txt)).
2. **Nginx configuration**: Restored the ordinary `frontend/nginx.compose.conf` mount.
3. **Health checks**: All three backend instances and the frontend proxy were confirmed healthy, returning
   HTTP 200 with identical station data hashes (`8dc1a4fd5ba2bcef7bfac5bac7c6e8979952d555fdea0ff14c2c8e3e15873dc2`)
   under [evidence/experiment-20261030-215820/stations-restored.json](evidence/experiment-20261030-215820/stations-restored.json).

---

## Appendix: all 30 observed proxy requests (Q1a Identity)

| Request | HTTP status | Backend instance ID | Succeeded |
|---:|---:|---|---|
| 1 | 200 | `84340d27-c6eb-41b6-9b92-6f9e52e32916` | True |
| 2 | 200 | `84340d27-c6eb-41b6-9b92-6f9e52e32916` | True |
| 3 | 200 | `84340d27-c6eb-41b6-9b92-6f9e52e32916` | True |
| 4 | 200 | `c3ed4594-8a4e-4b71-9a8b-167b0a096489` | True |
| 5 | 200 | `8bb2c825-4a13-4492-b391-5f44329d8f9f` | True |
| 6 | 200 | `84340d27-c6eb-41b6-9b92-6f9e52e32916` | True |
| 7 | 200 | `c3ed4594-8a4e-4b71-9a8b-167b0a096489` | True |
| 8 | 200 | `8bb2c825-4a13-4492-b391-5f44329d8f9f` | True |
| 9 | 200 | `84340d27-c6eb-41b6-9b92-6f9e52e32916` | True |
| 10 | 200 | `c3ed4594-8a4e-4b71-9a8b-167b0a096489` | True |
| 11 | 200 | `8bb2c825-4a13-4492-b391-5f44329d8f9f` | True |
| 12 | 200 | `84340d27-c6eb-41b6-9b92-6f9e52e32916` | True |
| 13 | 200 | `c3ed4594-8a4e-4b71-9a8b-167b0a096489` | True |
| 14 | 200 | `8bb2c825-4a13-4492-b391-5f44329d8f9f` | True |
| 15 | 200 | `84340d27-c6eb-41b6-9b92-6f9e52e32916` | True |
| 16 | 200 | `c3ed4594-8a4e-4b71-9a8b-167b0a096489` | True |
| 17 | 200 | `8bb2c825-4a13-4492-b391-5f44329d8f9f` | True |
| 18 | 200 | `84340d27-c6eb-41b6-9b92-6f9e52e32916` | True |
| 19 | 200 | `84340d27-c6eb-41b6-9b92-6f9e52e32916` | True |
| 20 | 200 | `c3ed4594-8a4e-4b71-9a8b-167b0a096489` | True |
| 21 | 200 | `8bb2c825-4a13-4492-b391-5f44329d8f9f` | True |
| 22 | 200 | `84340d27-c6eb-41b6-9b92-6f9e52e32916` | True |
| 23 | 200 | `c3ed4594-8a4e-4b71-9a8b-167b0a096489` | True |
| 24 | 200 | `c3ed4594-8a4e-4b71-9a8b-167b0a096489` | True |
| 25 | 200 | `8bb2c825-4a13-4492-b391-5f44329d8f9f` | True |
| 26 | 200 | `84340d27-c6eb-41b6-9b92-6f9e52e32916` | True |
| 27 | 200 | `c3ed4594-8a4e-4b71-9a8b-167b0a096489` | True |
| 28 | 200 | `8bb2c825-4a13-4492-b391-5f44329d8f9f` | True |
| 29 | 200 | `84340d27-c6eb-41b6-9b92-6f9e52e32916` | True |
| 30 | 200 | `c3ed4594-8a4e-4b71-9a8b-167b0a096489` | True |
