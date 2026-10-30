# Initial Q1(a) Compose operation

This is an operational configuration guide, not runtime evidence. No distribution,
database connectivity, image startup or readiness has been demonstrated yet.

## Services and ports

The existing frontend service is also the single Nginx load balancer. It serves the
React build and proxies API requests. There is no second proxy container.

- frontend: Nginx port 80, published as host port 5173.
- backend1, backend2, backend3: the same backend image/code, internal port 5000;
  no published host ports. They communicate on the Compose default network.
- telemetry: one optional worker under the telemetry profile, no published port.
  Do not enable this profile during initial load-balancing verification.

Compose supplies the existing backend environment file to the API containers.
This stage never reads its contents, executes migrations or changes the database.
Compose overrides PORT=5000 and PG_POOL_MAX=5 for each API and sets
TELEMETRY_ENABLED=false. The API entry point never starts telemetry regardless
of that flag. The optional worker remains a separate, explicitly enabled process.

## Nginx and browser routing

frontend/nginx.compose.conf is mounted read-only over the frontend container's
default server configuration only in Compose. The original nginx.conf and image
startup command remain unchanged for existing deployment workflows.

The evolve_api upstream lists backend1:5000, backend2:5000 and backend3:5000.
It uses the default round-robin policy. Actual counts must be observed; equal
distribution is not asserted. Backend-generated X-Instance-Id is passed through,
and /api/instance reports the selected backend's opaque process UUID. The UUID is
stable during that container process lifetime and changes on restart.

/api/ paths (including /api/instance) and exact /health are proxied without URI
replacement. Nginx retains request methods, query strings and JSON bodies. API
caching is disabled. Connect timeout is 5 seconds; read/send inactivity timeouts
are 15 seconds. These are not a total request deadline. No failover tuning or
fault experiment is included. The default body-size limits remain in place.
Access logs omit URLs, query strings, bodies and authorization headers; never
send credentials in query strings. Nginx's own error logs are not an audit store.

The browser uses host port 5173 for both static files and API traffic. Compose
builds with VITE_API_URL=/; config.js maps this explicit sentinel to an empty
prefix, producing /api/stations rather than //api/stations. Rebuild the frontend
when changing this build-time setting. Root / still serves the SPA; the backend's
diagnostic root route remains internal, while /health is the proxy health path.

Outside Compose, explicit VITE_API_URL values and the existing empty/unset local
and Render fallbacks retain their previous behavior. The deployed frontend is
not changed to point at a local-only proxy.

## Liveness, readiness and database budget

Docker probes each API's local /health every 15 seconds (2-second fetch deadline,
3-second check timeout). No database query is made. frontend initially waits for
all three APIs to become live. This is startup ordering, not an ongoing Nginx
readiness check: Nginx has no configured active health probes and Docker health
status does not automatically remove an upstream. Database readiness remains
unverified; /health can succeed while database-backed APIs fail.

Three API pools x 5 connections = a maximum of 15 application-pool connections.
Pools are lazy, so this is a ceiling, not a startup allocation. With the optional
worker enabled, its configured limit of 5 would raise the ceiling to 20.
These figures exclude Render services, administration, importers and other
clients. Neon limits/pooling mode are unknown; approve the combined budget before
database-backed load. Edit the shared x-api pool setting to change all three API
limits consistently. TLS verification and bounded query settings remain intact.

## Offline validation

Run scripts/validate-compose.ps1 from PowerShell. It passes an empty temporary
CLI environment file and --no-env-resolution --no-interpolate to Compose config,
so neither the default .env nor backend service environment files are read.
Only a validation summary is printed. It starts no containers and contacts no DB.

Run backend npm test for mocked API/runtime and frontend configuration tests.
The frontend production build is offline when existing dependencies are present.
If a compatible native Nginx is available, its -t mode can validate configuration
without starting a service, but the Compose DNS names must resolve in that test
environment. No native Nginx validation or runtime success should be assumed.

## Commands to review for a later authorized runtime session

Do not run these until runtime testing and use of the configured database are
approved. Starting the default stack does not migrate data or enable telemetry,
but database-backed API requests can access data and existing write APIs remain
unprotected. Do not book, start sessions or enable telemetry in an initial check.

    docker compose build backend1 backend2 backend3 frontend
    docker compose create backend1 backend2 backend3 frontend
    docker compose start backend1 backend2 backend3
    docker compose ps

After confirming that all three backends are healthy, validate Nginx before
starting the normal frontend with this one-off command:

    docker compose run --rm --no-deps frontend nginx -t
    docker compose start frontend
    docker compose ps

The one-off check creates and starts a container, so it was NOT executed in this
offline stage. The normal frontend must be started only after all three APIs are
live. For a simpler startup after reviewing that limitation, use
`docker compose up -d --build backend1 backend2 backend3 frontend`.

Only after startup review, inspect process distribution without database access:

    1..12 | ForEach-Object { Invoke-RestMethod http://localhost:5173/api/instance }

Those requests report observed IDs, not benchmark throughput or equal balancing.
Recreating backend containers may change their IPs; recreate/reload frontend as
well for this initial static-upstream configuration. Recovery/failure testing is
outside this stage. No startup or request commands above have been executed.
