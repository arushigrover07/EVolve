# Q1 operations and evidence provenance

All operations were local on branch da3. Existing uncommitted work was preserved.
No .env file content was read or copied. Docker inspections selected fields instead
of full Config.Env; Compose model checks used an empty CLI env file and disabled
service environment resolution. No production/Render endpoint was load-tested.

## Actually executed

- Repository branch/status, source/routes/configuration inspection and source hashes.
- Limited Docker inventory: exact container/image IDs, labels, mounts, ports,
  networks/aliases, health; limited image metadata/filesystem-layer comparison.
- Read the original local assignment PDF with pypdf; saved Q1 text and source hash.
- Thirty GET /api/instance calls through the actual local Nginx proxy. CSV records
  30 HTTP 200 responses; UUID counts 12, 10, 8. Per-service identity checks map UUIDs.
- Initial and repeated local GET /api/stations probes; all HTTP 500. Individual
  replicas also return HTTP 500. Saved hashes/status only, not response payload data.
- Sanitized read-only SELECT 1 via the existing configured pool, DNS/provider test,
  and IPv4-first diagnostic: configured Neon, DNS success, ETIMEDOUT. No database
  writes, migrations or credentials were used in output. The cause is not proven.
- Official portable k6 v1.8.2 download to ignored .local-tools, archive checksum
  verification and executable hash. No system package or application dependency added.
- Native k6 inspect of both workloads. Separate functional 20-request /health smoke
  with resolved gauges passed. It is not a Q1(b) performance benchmark.
- Native nginx -t for ordinary running configuration. Initial stdin-wrapper method
  failed; that attempt is retained. Unique regular /tmp wrapper files were then
  syntax-checked for all four benchmark/failure configurations and removed. No reload.
- Offline test/build/lint/syntax/model checks: exact commands, exit codes and logs
  are in verification/results.json. Latest source-dependent checks and counts are
  in verification/final-delta.json and benchmark-tests-final.txt.
- Generated and visually inspected architecture SVG/PNG; Mermaid and renderer editable.
- Final limited Docker inventory compared exact original container/image identities.

## Deliberately NOT executed

No image alignment, container recreation/start/stop/removal, baseline startup,
1000-request station benchmark, backend-stop/failover experiment, image build/pull/
retag/removal, broad cleanup, migration, application-data write, Render operation,
commit or push. Failed endpoint readiness prevented proceeding safely.

A portable tool download and transient native syntax-test files are the only tool/
container-filesystem additions; the temporary files were removed. No application
container, image, network, volume or loaded Nginx configuration was changed.

## Evidence interpretation

Synthetic test fixtures prove validator/recovery logic, not runtime performance.
A healthy process is not proof of database readiness. Client HTTP counts are not
backend-attempt or SQL-statement counts. A passing nginx -t is not failover evidence.
All real Q1(b)/(c) measurement cells remain unmeasured until successful experiments.
