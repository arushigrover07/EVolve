# Files changed in this Q1 milestone

Existing Stage 1/Q1 preparation changes were already present and preserved. This
inventory lists files modified or created during the initial and corrective DA3 Question 1
benchmarking and documentation workflows.

## Application & Compose Configuration
- `docker-compose.yml`: Set `PG_CONNECT_TIMEOUT_MS: "15000"` in backend service environment to eliminate `pg-pool` client acquisition queue timeouts over WAN.

## Benchmark & Proxy Configurations
- `benchmarks/nginx.failover-after.conf`: Added `http_500` to `proxy_next_upstream` for the idempotent `GET /api/stations` route with bounded tries (`3`) and timeout (`5s`).
- `benchmarks/nginx.failover-before.conf`: Initial failover baseline with `proxy_next_upstream off;`.
- `benchmarks/nginx.one.conf`: Baseline single-backend proxy configuration.
- `benchmarks/nginx.three.conf`: Scaled 3-backend proxy configuration.
- `benchmarks/compose.one.yml`: Compose definition for dedicated baseline proxy.
- `benchmarks/compose.three.override.yml`: Image alignment override.
- `benchmarks/compose.failover.override.yml`: Overlay for failover phase configurations.
- `benchmarks/compose.rollback.yml`: Pinned original four immutable image IDs and ordinary Nginx mount for clean rollback.

## Test Scripts & Tools
- `scripts/q1b-runtime.ps1`: Runtime inspection utilities with Windows PowerShell 5.1 Docker template quote escaping.
- `scripts/benchmark-q1b.ps1`: Q1(b) 1,000-request runner with cross-platform .NET 4.8 / PowerShell 5.1 compatibility.
- `scripts/collect-q1a.ps1`: Q1(a) distribution collector with PowerShell 5.1 compatibility.
- `scripts/run-q1c.ps1`: Q1(c) failover controller with .NET 4.8 `ProcessStartInfo.Arguments` compatibility.
- `scripts/manage-q1b-baseline.ps1`: Manages dedicated baseline proxy lifecycle.
- `scripts/compare-q1b.ps1`: Independent Q1(b) comparator.
- `scripts/render-q1-architecture.py`: Architecture SVG and PNG generator with updated verified connections and purple proposed edge gateway.
- `scripts/verify-q1.ps1`: Automated 12-check verification suite.
- `benchmarks/preflight.tests.ps1`: 76 synthetic preflight and mocked recovery checks.
- `benchmarks/prepare.test.cjs`: Benchmark unit tests.
- `benchmarks/failure.test.cjs`: Failover configuration unit tests.
- `benchmarks/result-validation.cjs`: Q1(b) result validator.
- `benchmarks/failure-validation.cjs`: Q1(c) failure validator and comparator.

## Documentation & Evidence
- `docs/da3/q1/q1-report.md`: Complete DA3 Question 1 submission report with verified Q1(a)–Q1(d) results.
- `docs/da3/q1/q1-verification-matrix.md`: Traceability matrix mapping every rubric requirement to verified artifacts.
- `docs/da3/q1/benchmarks/status.json`: Machine-readable summary of all experiment metrics and validation outcomes.
- `docs/da3/q1/changed-files.md`: This file.
- `docs/da3/q1/screenshots-and-demo.md`: Structured three-minute demo script and verified screenshot capture guide.
- `docs/da3/q1/evidence/operation-log.md`: Chronological operational log distinguishing initial probes, historical runs, corrective runs, and synthetic vs runtime evidence.
- `docs/da3/q1/architecture/evolve-q1.png`: Architecture diagram export.
- `docs/da3/q1/architecture/evolve-q1.svg`: Scalable vector diagram with distinct purple proposed edge gateway.
- `docs/da3/q1/architecture/evolve-q1.mmd`: Mermaid architecture source.
- `docs/da3/q1/evidence/experiment-20261030-231913/**`: Corrective experiment evidence (Q1(a) distributions, Q1(b) paired runs, Q1(c) before/after failure logs, verification suite results).
- `docs/da3/q1/evidence/experiment-20261030-215820/**`: Preserved historical evidence from earlier benchmark runs.
