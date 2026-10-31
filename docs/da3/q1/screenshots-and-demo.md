# Genuine Screenshots and Three-Minute Demonstration Guide

Never generate terminal screenshots or replace missing measurements with synthetic
unit-test fixtures. Redact credentials, personal data, and unrelated terminal history.
Do not display `.env`, full `docker inspect`, raw environment dumps, or database connection strings.

---

## Verified Artifacts Available for Capture

All screenshots and demo assets must be captured directly from verified repository artifacts:

1. **Docker Container Topology & Liveness**:
   - Capture `docker ps` showing the 4 runtime containers:
     `evolve-frontend-1` on port `5173->80`, and `evolve-backend1-1`, `evolve-backend2-1`, `evolve-backend3-1` on internal port `5000`.
   - Point out that process health checks confirm container liveness.
2. **Q1(a) Request Distribution**:
   - Display `q1a-distribution.csv` / `q1a-distribution-summary.json` (30 requests across `/api/instance`: 14, 9, 7).
   - Display `q1a-stations.csv` / `q1a-stations-summary.json` (12 requests across `/api/stations`: 4, 4, 4) showing identical payload SHA-256 (`8dc1a4fd5ba2bcef7bfac5bac7c6e8979952d555fdea0ff14c2c8e3e15873dc2`).
3. **Q1(b) 1,000-Request Load Test Comparison**:
   - One backend (`paired/One.json`): 1,000 requests, 1,000 successes, **0 failures**, 3.32 RPS, 5,980.36 ms average latency (`status: accepted`).
   - Three backends (`paired/Three.json`): 1,000 requests, 993 successes, **7 failures**, 3.81 RPS (+14.76%), 5,184.63 ms average latency (-13.31%).
   - Transparently show that Three is marked **`rejected`** by the validator because 7 requests failed due to transient WAN connection pool queueing under concurrency.
4. **Q1(c) High Availability & Failover Resilience**:
   - Before failover (`failure/Before.result.json`): 1,000 requests with in-flight `backend3` stop; 69 failures (1x 500, 55x 502, 13x 504) with `proxy_next_upstream off;`.
   - After failover (`failure/After.result.json`): 1,000 requests with in-flight `backend3` stop; **0 failures** with bounded retries (`http_500..504`, 3 tries, 5s timeout).
   - Highlight the **100.0% failure reduction** achieved in this measured run while explicitly clarifying that retries mitigate single-node container loss, not universal network partitions.
5. **Architecture Diagram**:
   - Show `architecture/evolve-q1.svg` or `architecture/evolve-q1.png` highlighting local Compose ports (5173, 5000), round-robin Nginx proxy, Neon cloud database, Render hosted references, and the distinct **purple proposed edge gateway**.
6. **Automated Verification Suite**:
   - Show `./scripts/verify-q1.ps1` output: 11 checks passed cleanly; honestly acknowledge the 1 pre-existing frontend ESLint failure (17 warnings/errors in legacy React files from earlier milestones).

---

## Three-Minute Demonstration Script

### Minute 0:00–0:45 | Architecture & Holiday Peak Scenario
- **Opening**: Introduce EVolve (EV Charging Station Management Platform) and the holiday departure rush scenario where drivers simultaneously search for available chargers.
- **Busiest API**: Explain that `GET /api/stations` performs an aggregated read join between stations and chargers, making it the primary bottleneck during holiday peaks.
- **Topology**: Show the Docker Compose stack with Nginx on port 5173 routing round-robin to 3 internal backend replicas on port 5000, connected to a cloud Neon PostgreSQL database.

### Minute 0:45–1:30 | Q1(a) Distribution & Q1(b) Load Testing
- **Request Distribution**: Show the 30-request identity test (14 / 9 / 7) and 12-request station test (4 / 4 / 4), demonstrating that Nginx evenly distributes traffic and all replicas return matching station data.
- **Performance Comparison**: Present the controlled 1,000-request k6 benchmark (20 VUs):
  - Scaling to 3 backends improved throughput by **+14.76%** (3.32 to 3.81 RPS) and reduced average response time by **13.31%** (5,980 ms to 5,184 ms).
  - **Rubric Honesty**: Explain that One was accepted (0 failures), while Three was rejected because 7 requests timed out in the `pg-pool` queue due to transcontinental WAN latency to Ohio (~267 ms RTT).

### Minute 1:30–2:15 | Q1(c) High Availability & Failover Resilience
- **In-Flight Failure**: Show the failover test where `backend3` was stopped while 20 requests were actively in-flight.
- **Before vs. After**:
  - Before: Without failover retries, 69 requests failed (55x 502, 13x 504, 1x 500).
  - After: With Nginx configured to retry idempotent GET requests (`error timeout http_500 http_502 http_503 http_504`, bounded to 3 tries / 5s), all requests were seamlessly redirected to surviving nodes, achieving **0 failures (100% reduction)** in that run.
- **Restoration**: Confirm that the container stack was cleanly rolled back to its original image IDs with ordinary Nginx configuration.

### Minute 2:15–3:00 | Q1(d) Edge Extension & Submission Verification
- **Proposed Edge Extension**: Walk through the purple edge gateway component:
  - Local EV charging sites deploy edge gateways to cache charger availability with a short TTL (e.g., 5–10s) and buffer telemetry locally during cloud network drops.
  - Mitigates peak read traffic on the central cloud database while preserving central authority for bookings and billing.
- **Verification Summary**: Show the 11 passed verification checks and complete documentation traceability in `q1-report.md`, `q1-verification-matrix.md`, and `benchmarks/status.json`.
