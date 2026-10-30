# Stage 1 backend operation

## Commands

From backend/: `npm start` (or `node server.js`) runs only the HTTP API.
`npm test` runs the Node test runner with injected database mocks; no credentials or database service are required.
Supply environment variables through the process/container environment as before. The API does not read .env files.

`npm run worker:telemetry` requires TELEMETRY_ENABLED=true in its process environment.
For Docker, `docker compose --profile telemetry up --build` explicitly enables the worker alongside the existing services.
Default `docker compose up --build` starts no worker. No replica or load-balancer configuration is added.
Run exactly ONE telemetry worker for a database. The non-overlap guard is local to that worker, not a distributed lock.
Do not run these services with a production database for a test: the explicit worker writes immediately.

## API lifecycle

app.js constructs the app using an injected database; it performs no startup queries or listening.
server.js owns listening and SIGINT/SIGTERM shutdown. Stop accepting requests, drain active HTTP requests,
then close the database pool. The worker cancels scheduling, drains its in-flight cycle, then closes its pool.
A 15-second shutdown deadline forces exit on a stuck drain; Compose allows 20 seconds.
The deadline is configurable using SHUTDOWN_TIMEOUT_MS. Forced shutdown cannot guarantee completion of in-flight writes.

GET /health returns {"status":"ok"}: process liveness only, not database readiness.
GET /api/instance and the X-Instance-Id response header expose only a generated per-process UUID.
It is stable for the process lifetime and changes after restart; it contains no host/configuration data.
Existing route payloads, validation and INR 12/kWh billing are retained, except raw internal error details are sanitized.
Logs retain fixed operation context and standard five-character database error codes, never error messages or stacks.
Existing authentication and authorization weaknesses are intentionally outside this stage.

## Database configuration

DATABASE_URL is required. Pool creation is lazy and no startup connectivity probe is made.
Defaults (per process): PG_POOL_MAX=5, PG_CONNECT_TIMEOUT_MS=5000, PG_IDLE_TIMEOUT_MS=30000,
PG_QUERY_TIMEOUT_MS=10000 and PG_STATEMENT_TIMEOUT_MS=10000. Values must be positive integers.
Total connections must include every future API replica, the worker and the existing hosting services.

TLS verifies certificates by default. URL SSL flags are removed before pg parses the URL so they cannot
replace the explicit verification settings (see https://node-postgres.com/features/ssl).
Use platform trust / NODE_EXTRA_CA_CERTS for a necessary custom CA; do not disable verification for Neon.
PG_SSL=false is allowed only for an explicitly isolated loopback PostgreSQL server without TLS.
The implementation never logs the connection URL and the test suite never opens database connections.
Real Neon TLS connectivity and the live schema remain unverified.

## Migration review (not executed)

The only schema mutation in ordinary API startup was adding station latitude/longitude columns.
It is extracted into database/migrations/001_station_coordinates.sql. There is no automatic migration runner.
Code review: it adds only missing coordinate columns, is transactional, has bounded lock/statement waits,
and contains no data deletion, table replacement, users/metrics definitions, or inferred live-schema changes.
The migration deliberately qualifies public.stations. Before any execution, inspect the target schema,
confirm this schema name, existing column definitions, permissions and an isolated rehearsal plan.
An existing column with an incompatible type is left unchanged and requires a separately reviewed decision.
This file is ready for human review; it has NOT been validated or run against PostgreSQL or Neon.
Missing users/metrics definitions in schema.sql and booking/session transaction races remain out of scope.

## Telemetry semantics

The first cycle is immediate; subsequent cycles wait 10 seconds after completion (TELEMETRY_INTERVAL_MS override).
This changes fixed-rate scheduling to completion-based scheduling to prevent overlap.
The same random AVAILABLE/CHARGING toggle, station counts and utilization snapshots are retained.
Concurrent manual invocations share the existing cycle. Errors are sanitized and a later scheduled cycle can retry.
No additional worker is created by importing the service or starting the API.
The simulator can still change a real session's charger status; resolving this domain behavior is deferred.

## Verification limits

Mocked HTTP tests protect route contracts and billing but do not prove SQL correctness against a live schema,
database transactions, distributed concurrency safety, Neon TLS connectivity, image startup or Render deployment.
No production configuration, frontend source, MFA, RBAC or load balancing is changed in this stage.

## Stage 1 verification record

Executed on the da3 working tree: syntax checks for every backend JavaScript file, backend tests,
frontend production build using existing dependencies, and Git whitespace checks.
The initial restricted HTTP tests failed because local socket connections were denied (EACCES).
The authorized rerun permits only the test design's local mock-backed HTTP activity; no database is contacted.
Frontend build completed successfully. Existing frontend lint failures recorded in the audit were not modified.
No dependency installation was needed. Docker image build/start and migration execution were not attempted.

Final backend test run: 42 passed, 0 failed. Route review verified all 27 original route definitions and all route SQL statements are preserved; changes are limited to startup schema removal and error sanitization.
