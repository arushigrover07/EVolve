# Q1 requirement verification matrix

Status key: I = implemented; T = tested; E = genuine runtime evidence; R = report-ready.
Original rubric: Q1(a) 1 mark; (b) 1.5; (c) 1.5; (d) 1. Total 5 marks.

| Requirement | Implementation location | Test/command run | Result | Evidence artifact | Status |
|---|---|---|---|---|---|
| **Q1(a) scenario and busiest API** | `q1-report.md`; `backend/app.js` | Source inspection of `GET /api/stations` and frontend caller | Holiday departure search rush; SELECT join & aggregation, read-only | `q1-report.md` | I/T/E/R yes |
| **Q1(a) three backend containers** | `docker-compose.yml` | Docker inspect & health checks | Three running healthy API processes on internal port 5000 | `evidence/experiment-20261030-231913/verification/results.json` | I/T/E/R yes |
| **Q1(a) Nginx load balancing** | `frontend/nginx.compose.conf` | Native `nginx -t`; actual proxy probes | Configuration valid; requests distributed round-robin | `evidence/experiment-20261030-231913/q1a-distribution.csv` | I/T/E/R yes |
| **Q1(a) cloud database connection** | `backend/dbConfig.js`; `db.js` | TLS connection probe & station queries | Neon PostgreSQL connected; station reads successful (HTTP 200) | `evidence/experiment-20261030-231913/q1a-stations-summary.json` | I/T/E/R yes |
| **Q1(a) all three receive requests** | `scripts/collect-q1a.ps1` | 30 `GET /api/instance` through 5173 | 30 HTTP 200; UUID distribution: 14, 9, 7 | `evidence/experiment-20261030-231913/q1a-distribution-summary.json` | I/T/E/R yes |
| **Q1(a) equivalent station data** | `scripts/collect-q1a.ps1` | 12 `GET /api/stations` through 5173 | 12 HTTP 200 (4, 4, 4); matching SHA256 `8dc1a4fd...` | `evidence/experiment-20261030-231913/q1a-stations-summary.json` | I/T/E/R yes |
| **Q1(a/b) immutable image cohort** | `benchmarks/compose.three.override.yml`; `compose.rollback.yml` | Image alignment & rollback execution | Recreated on single image for tests; rolled back to originals | `docker ps`; `benchmarks/compose.rollback.yml` | I/T/E/R yes |
| **Q1(b) 1,000 requests, 1 backend** | `benchmarks/q1b.mjs`; `scripts/benchmark-q1b.ps1` | k6 v1.8.2 (20 VUs, 1,000 reqs) on port 5174 | 1,000 passed, 0 failed; 3.32 RPS, 5,980.36 ms avg latency | `evidence/experiment-20261030-231913/paired/One.json` | I/T/E/R yes (accepted) |
| **Q1(b) 1,000 requests, 3 backends** | Same workload & runner | k6 v1.8.2 (20 VUs, 1,000 reqs) on port 5173 | 993 passed, 7 failed; 3.81 RPS, 5,184.63 ms avg latency | `evidence/experiment-20261030-231913/paired/Three.json` | Completed; rejected by strict rate==0 threshold |
| **Q1(b) same tool and concurrency** | `q1b.mjs`; `result-validation.cjs` | k6 inspect & workload validation | k6 v1.8.2, 20 VUs, shared-iterations executor, 20s timeout | `evidence/experiment-20261030-231913/paired/One.meta.json` | I/T/E/R yes |
| **Q1(b) RPS / response time comparison** | `scripts/compare-q1b.ps1` | Tabulated performance metrics | +14.76% RPS improvement (3.32 to 3.81); 13.31% latency reduction | `evidence/experiment-20261030-231913/paired/`; `q1-report.md` | I/T/E/R yes (Three rejection preserved) |
| **Q1(c) instance stopped under load** | `scripts/run-q1c.ps1`; `q1c.mjs` | Automated stop of `backend3` at ~8.4s | `backend3` stopped during active in-flight load (18-20 VUs) | `evidence/experiment-20261030-231913/failure-summary.json` | I/T/E/R yes |
| **Q1(c) before failure count** | `benchmarks/nginx.failover-before.conf` | 1,000 reqs, 20 VUs, stop `backend3` | 69 failures (1x 500, 55x 502, 13x 504); 931 successes | `evidence/experiment-20261030-231913/failure/Before.result.json` | I/T/E/R yes |
| **Q1(c) after failure count** | `benchmarks/nginx.failover-after.conf` | 1,000 reqs, 20 VUs, stop `backend3` | 0 failures (0x 500, 0x 502, 0x 504); 1,000 successes | `evidence/experiment-20261030-231913/failure/After.result.json` | I/T/E/R yes (zero failures achieved) |
| **Q1(c) Nginx failover behavior** | Nginx retry & health configuration | Automated failover comparison | 100% failure reduction; zero failures demonstrated (`zeroFailuresDemonstrated: true`) | `evidence/experiment-20261030-231913/failure-summary.json` | I/T/E/R yes |
| **Q1(d) architecture diagram** | `architecture/evolve-q1.svg/.png/.mmd` | Visual review & syntax check | Actual local ports (5173, 5000), 3 backends, Nginx, Neon DB, Render | `architecture/evolve-q1.png` | I/T/E/R yes |
| **Q1(d) extension in distinct colour** | Purple proposed edge gateway | Visual inspection of SVG & PNG | Purple dashed box & arrows denoting on-premise edge gateway | `architecture/evolve-q1.svg` | I/T/E/R yes |
| **Q1(d) domain-specific explanation** | `q1-report.md` | Review against EV holiday rush | Short-TTL availability cache & telemetry buffer with central booking | `q1-report.md` | I/T/E/R yes |

All required Q1 experiments have been executed with genuine evidence stored under `evidence/experiment-20261030-231913/`.
Historical evidence from prior runs is preserved under `evidence/experiment-20261030-215820/`.
Runtime environment has been cleanly restored to original container image IDs and ordinary Nginx configuration.
