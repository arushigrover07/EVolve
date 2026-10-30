# Q1 requirement verification matrix

Status key: I = implemented; T = tested; E = genuine runtime evidence; R = report-ready.
Original rubric: Q1(a) 1 mark; (b) 1.5; (c) 1.5; (d) 1. Total 5 marks.

| Requirement | Implementation location | Test/command run | Result | Evidence artifact | Status |
|---|---|---|---|---|---|
| **Q1(a) scenario and busiest API** | `q1-report.md`; `backend/app.js` | Source inspection of `GET /api/stations` and frontend caller | Holiday departure search rush; SELECT join & aggregation, read-only | `q1-report.md` | I/T/E/R yes |
| **Q1(a) three backend containers** | `docker-compose.yml` | Docker inspect & health checks | Three running healthy API processes on internal port 5000 | `evidence/runtime-before.json`; `runtime-after.json` | I/T/E/R yes |
| **Q1(a) Nginx load balancing** | `frontend/nginx.compose.conf` | Native `nginx -t`; actual proxy probes | Configuration valid; requests distributed round-robin | `evidence/nginx-runtime-validation.json`; `q1a-distribution.csv` | I/T/E/R yes |
| **Q1(a) cloud database connection** | `backend/dbConfig.js`; `db.js` | TLS connection probe & station queries | Neon PostgreSQL connected; station reads successful (HTTP 200) | `evidence/experiment-20261030-215820/stations-restored.json` | I/T/E/R yes |
| **Q1(a) all three receive requests** | `scripts/collect-q1a.ps1` | 30 `GET /api/instance` through 5173 | 30 HTTP 200; UUID distribution: 12, 8, 10 | `evidence/q1a-distribution.csv`; `instance-service-map.json` | I/T/E/R yes |
| **Q1(a) equivalent station data** | `scripts/q1b-runtime.ps1` | Station queries across 3 replicas | 12 HTTP 200 responses (5, 3, 4); matching SHA256 `8dc1a4fd...` | `evidence/experiment-20261030-215820/q1a-stations-summary.json` | I/T/E/R yes |
| **Q1(a/b) immutable image cohort** | `benchmarks/compose.three.override.yml`; `compose.rollback.yml` | Image alignment & rollback execution | Recreated on single image for tests; rolled back to originals | `evidence/experiment-20261030-215820/rollback.txt` | I/T/E/R yes |
| **Q1(b) 1,000 requests, 1 backend** | `benchmarks/q1b.mjs`; `scripts/benchmark-q1b.ps1` | k6 v1.8.2 (20 VUs, 1,000 reqs) on port 5174 | 924 passed, 76 failed; 3.39 RPS, 5,833.88 ms avg latency | `evidence/experiment-20261030-215820/paired/One.json` | Completed; rejected by strict rate==0 threshold |
| **Q1(b) 1,000 requests, 3 backends** | Same workload & runner | k6 v1.8.2 (20 VUs, 1,000 reqs) on port 5173 | 967 passed, 33 failed; 3.71 RPS, 5,328.45 ms avg latency | `evidence/experiment-20261030-215820/paired/Three.json` | Completed; rejected by strict rate==0 threshold |
| **Q1(b) same tool and concurrency** | `q1b.mjs`; `result-validation.cjs` | k6 inspect & workload validation | k6 v1.8.2, 20 VUs, shared-iterations executor, 20s timeout | `evidence/k6-tool.json`; `paired/One.meta.json` | I/T/E/R yes |
| **Q1(b) RPS / response time comparison** | `scripts/compare-q1b.ps1` | Tabulated performance metrics | +9.4% RPS improvement (3.39 to 3.71); 8.7% latency reduction | `evidence/experiment-20261030-215820/comparison.txt`; `q1-report.md` | Completed; zero-failure rejection documented |
| **Q1(c) instance stopped under load** | `scripts/run-q1c.ps1`; `q1c.mjs` | Automated stop of `backend3` at ~8.5s | `backend3` gracefully stopped during active in-flight load (18-20 VUs) | `evidence/experiment-20261030-215820/failure-summary.json` | I/T/E/R yes |
| **Q1(c) before failure count** | `benchmarks/nginx.failover-before.conf` | 1,000 reqs, 20 VUs, stop `backend3` | 93 failures (12x 500, 68x 502, 13x 504); 907 successes | `evidence/experiment-20261030-215820/failure/Before.result.json` | I/T/E/R yes |
| **Q1(c) after failure count** | `benchmarks/nginx.failover-after.conf` | 1,000 reqs, 20 VUs, stop `backend3` | 5 failures (5x 500, 0x 502, 0x 504); 995 successes | `evidence/experiment-20261030-215820/failure/After.result.json` | I/T/E/R yes |
| **Q1(c) Nginx failover behavior** | Nginx retry & health configuration | Automated failover comparison | 94.62% failure reduction; 100% gateway errors eliminated; 5 origin 500s remained | `evidence/experiment-20261030-215820/failure-comparison.json` | I/T/E/R yes |
| **Q1(d) architecture diagram** | `architecture/evolve-q1.svg/.png/.mmd` | Visual review & syntax check | Actual local ports (5173, 5000), 3 backends, Nginx, Neon DB, Render | `architecture/evolve-q1.png` | I/T/E/R yes |
| **Q1(d) extension in distinct colour** | Purple proposed edge gateway | Visual inspection of SVG & PNG | Purple dashed box & arrows denoting on-premise edge gateway | `architecture/evolve-q1.svg` | I/T/E/R yes |
| **Q1(d) domain-specific explanation** | `q1-report.md` | Review against EV holiday rush | Short-TTL availability cache & telemetry buffer with central booking | `q1-report.md` | I/T/E/R yes |

All required Q1 experiments have been executed with genuine evidence stored under `evidence/experiment-20261030-215820/`.
Runtime environment has been cleanly restored to original container image IDs and ordinary Nginx configuration.
