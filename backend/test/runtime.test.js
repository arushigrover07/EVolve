const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const { spawnSync } = require("node:child_process");
const { createTelemetryService } = require("../services/telemetryService");
const { startWorker } = require("../workers/telemetryWorker");
const { startServer } = require("../server");
const { registerShutdown } = require("../shutdown");
const { poolConfig } = require("../dbConfig");
const { Client } = require("pg");
const quiet = { log() {}, error() {} };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("entry-point imports never load database or start telemetry", () => {
  const child = spawnSync(process.execPath, ["-e", `
    const Module = require('node:module');
    const original = Module._load;
    Module._load = function(id, ...args) {
      if (id === './db' || id === '../db' || id === 'pg') throw new Error('Database module must not load');
      return original.call(this, id, ...args);
    };
    require('./app'); require('./server'); require('./workers/telemetryWorker');
  `], { cwd: require("node:path").join(__dirname, ".."), encoding: "utf8", timeout: 3000 });
  assert.equal(child.status, 0, "Import must succeed without database configuration");
  assert.equal(child.stdout, "");
  assert.equal(child.stderr, "");
});

test("API listens without startup queries and closes database once", async () => {
  let queries = 0;
  let ended = 0;
  const runtime = startServer({ db: { query() { queries++; throw new Error("Unexpected query"); }, async end() { ended++; } }, port: 0, logger: quiet });
  try {
    await once(runtime.server, "listening");
    assert.equal(queries, 0);
    const response = await fetch(`http://127.0.0.1:${runtime.server.address().port}/health`);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.equal(queries, 0);
  } finally { await runtime.stop(); }
  await runtime.stop();
  assert.equal(ended, 1);
  assert.equal(runtime.server.listening, false);
});

test("HTTP shutdown drains an active request before ending pool", async () => {
  const entered = deferred();
  const release = deferred();
  const events = [];
  const runtime = startServer({ db: {
    async query() { entered.resolve(); await release.promise; events.push("query finished"); return { rows: [] }; },
    async end() { events.push("pool ended"); }
  }, port: 0, logger: quiet });
  try {
    await once(runtime.server, "listening");
    const response = fetch(`http://127.0.0.1:${runtime.server.address().port}/api/stations`).then(async (r) => { assert.equal(r.status, 200); await r.json(); });
    await Promise.race([entered.promise, response.then(() => { throw new Error("Request completed before reaching database mock"); })]);
    const stopping = runtime.stop();
    await flush();
    assert.deepEqual(events, []);
    release.resolve();
    await response;
    await stopping;
    assert.deepEqual(events, ["query finished", "pool ended"]);
  } finally { release.resolve(); await runtime.stop(); }
});

test("telemetry retains toggling, counts, utilization and metric inserts", async () => {
  const calls = [];
  const rows = [[{ id: 7, status: "AVAILABLE" }], [], [{ id: 1 }], [{ available_chargers: "1", active_sessions: "2", total_chargers: "3" }], []];
  const service = createTelemetryService({ logger: quiet, random: () => 0, db: { async query(sql, params) { calls.push({ sql, params }); return { rows: rows.shift() }; } } });
  await service.runTelemetryCycle();
  assert.equal(rows.length, 0);
  assert.match(calls[0].sql, /status IN \('AVAILABLE', 'CHARGING'\)/);
  assert.deepEqual(calls[1].params, ["CHARGING", 7]);
  assert.deepEqual(calls[3].params, [1]);
  assert.match(calls[4].sql, /INSERT INTO metrics/);
  assert.deepEqual(calls[4].params, [1, 1, 2, 66.67]);
  await service.stop();
});

test("telemetry coalesces overlapping cycles and waits on stop", async () => {
  const gate = deferred();
  let calls = 0;
  const service = createTelemetryService({ logger: quiet, db: { async query() { calls++; if (calls === 1) await gate.promise; return { rows: [] }; } } });
  const first = service.runTelemetryCycle();
  const second = service.runTelemetryCycle();
  assert.equal(first, second);
  assert.equal(calls, 1);
  let stopped = false;
  const stop = service.stop().then(() => { stopped = true; });
  await flush();
  assert.equal(stopped, false);
  gate.resolve();
  await Promise.all([first, second, stop]);
  assert.equal(calls, 2);
  assert.equal(stopped, true);
});

test("telemetry schedules only after completion and cancels its timer", async () => {
  const gate = deferred();
  const timers = [];
  const cancelled = [];
  let calls = 0;
  const service = createTelemetryService({ logger: quiet, intervalMs: 10000,
    schedule(callback, delay) { timers.push({ callback, delay }); return 42; },
    cancel(id) { cancelled.push(id); },
    db: { async query() { calls++; if (calls === 1) await gate.promise; return { rows: [] }; } }
  });
  service.start(); service.start();
  assert.equal(calls, 1);
  assert.equal(timers.length, 0);
  gate.resolve(); await flush();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 10000);
  await service.stop();
  assert.deepEqual(cancelled, [42]);
});

test("stopping during an active scheduled cycle prevents rescheduling", async () => {
  const gate = deferred();
  let scheduled = 0;
  const service = createTelemetryService({ logger: quiet,
    schedule() { scheduled++; }, db: { async query() { await gate.promise; return { rows: [] }; } }
  });
  service.start();
  const stopping = service.stop();
  gate.resolve(); await stopping; await flush();
  assert.equal(scheduled, 0);
});

test("restarting during a draining cycle does not create two scheduler loops", async () => {
  const gate = deferred();
  let schedules = 0;
  const service = createTelemetryService({ logger: quiet,
    schedule() { schedules++; return 1; }, cancel() {},
    db: { async query() { await gate.promise; return { rows: [] }; } }
  });
  service.start();
  const oldStop = service.stop();
  service.start();
  gate.resolve(); await oldStop; await flush();
  assert.equal(schedules, 1);
  await service.stop();
});

test("a failed telemetry cycle logs no private detail and permits the next cycle", async () => {
  const logs = [];
  let calls = 0;
  const service = createTelemetryService({ logger: { ...quiet, error(message) { logs.push(message); } },
    db: { async query() { if (++calls === 1) throw new Error("private-database-detail"); return { rows: [] }; } }
  });
  await service.runTelemetryCycle();
  await service.runTelemetryCycle();
  assert.equal(calls, 3);
  assert.deepEqual(logs, ["Simulated telemetry cycle failed [UNCLASSIFIED]"]);
  await service.stop();
});

test("worker refuses disabled startup before any database activity", () => {
  let touched = false;
  assert.throws(() => startWorker({ env: {}, db: { query() { touched = true; } } }), /TELEMETRY_ENABLED=true/);
  assert.equal(touched, false);
});

test("enabled worker starts explicitly and drains before closing its pool", async () => {
  const gate = deferred();
  let ended = false;
  const worker = startWorker({ env: { TELEMETRY_ENABLED: "true" }, logger: quiet,
    db: { async query() { await gate.promise; assert.equal(ended, false); return { rows: [] }; }, async end() { ended = true; } }
  });
  const stop = worker.stop();
  assert.equal(ended, false);
  gate.resolve(); await stop;
  assert.equal(ended, true);
});

test("SIGTERM/SIGINT share one draining shutdown and remove listeners", async () => {
  const signals = new EventEmitter();
  const gate = deferred();
  const events = [];
  const shutdown = registerShutdown({ signals, logger: quiet,
    close: async () => { events.push("close"); await gate.promise; },
    db: { async end() { events.push("end"); } }
  });
  signals.emit("SIGTERM"); signals.emit("SIGINT");
  assert.deepEqual(events, ["close"]);
  gate.resolve(); await shutdown.stop();
  assert.deepEqual(events, ["close", "end"]);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
  assert.equal(signals.listenerCount("SIGINT"), 0);
});

test("shutdown has a bounded force-close deadline", async () => {
  const signals = new EventEmitter();
  const gate = deferred();
  const timeout = deferred();
  let forced = 0;
  let ended = 0;
  const shutdown = registerShutdown({ signals, logger: quiet, timeoutMs: 10,
    close: () => gate.promise, forceClose: () => { forced++; }, onTimeout: timeout.resolve,
    db: { async end() { ended++; } }
  });
  const stopping = shutdown.stop();
  await timeout.promise;
  assert.equal(forced, 1);
  gate.resolve(); await stopping;
  assert.equal(ended, 1);
});

test("pool defaults are bounded and enforce certificate verification after pg parsing", () => {
  // Reserved .invalid hostname; no connection is attempted and no credentials are used.
  const config = poolConfig({ DATABASE_URL: "postgresql://database.invalid/example?sslmode=no-verify&ssl=true&sslnegotiation=direct" });
  assert.equal(config.max, 5);
  assert.equal(config.connectionTimeoutMillis, 5000);
  assert.equal(config.idleTimeoutMillis, 30000);
  assert.equal(config.query_timeout, 10000);
  assert.equal(config.statement_timeout, 10000);
  const client = new Client(config);
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
});

test("pool overrides are explicit and TLS disabling is restricted to loopback", () => {
  const config = poolConfig({ DATABASE_URL: "postgresql://localhost/example", PG_SSL: "false", PG_POOL_MAX: "2", PG_CONNECT_TIMEOUT_MS: "123", PG_IDLE_TIMEOUT_MS: "456", PG_QUERY_TIMEOUT_MS: "789", PG_STATEMENT_TIMEOUT_MS: "999" });
  assert.equal(config.ssl, false);
  assert.equal(config.max, 2);
  assert.equal(config.connectionTimeoutMillis, 123);
  assert.equal(config.idleTimeoutMillis, 456);
  assert.equal(config.query_timeout, 789);
  assert.equal(config.statement_timeout, 999);
  assert.throws(() => poolConfig({ DATABASE_URL: "postgresql://database.invalid/example", PG_SSL: "false" }), /loopback/);
  assert.throws(() => poolConfig({ DATABASE_URL: "postgresql://localhost/example?host=database.invalid", PG_SSL: "false" }), /loopback/);
  for (const name of ["PG_POOL_MAX", "PG_CONNECT_TIMEOUT_MS", "PG_IDLE_TIMEOUT_MS", "PG_QUERY_TIMEOUT_MS", "PG_STATEMENT_TIMEOUT_MS"]) {
    for (const value of ["0", "-1", "invalid", "1.5"]) assert.throws(() => poolConfig({ DATABASE_URL: "postgresql://localhost/example", [name]: value }), /Invalid/);
  }
  assert.throws(() => poolConfig({}), /DATABASE_URL is required/);
  assert.throws(() => poolConfig({ DATABASE_URL: "invalid" }), /^Error: Invalid DATABASE_URL$/);
});

test("pool rejects duplicate host parameters before TLS validation", () => {
  for (const hosts of ["host=localhost&host=database.invalid", "host=database.invalid&host=localhost", "host=localhost&host=localhost"]) {
    for (const PG_SSL of ["false", "true"]) {
      assert.throws(() => poolConfig({ DATABASE_URL: `postgresql://localhost/example?${hosts}`, PG_SSL }), /^Error: Duplicate database host parameters are not allowed$/);
    }
  }
});

test("pool checks a single effective host when TLS is explicitly disabled", () => {
  assert.throws(() => poolConfig({ DATABASE_URL: "postgresql://localhost/example?host=database.invalid", PG_SSL: "false" }), /loopback/);
  const client = new Client(poolConfig({ DATABASE_URL: "postgresql://database.invalid/example?host=localhost", PG_SSL: "false" }));
  assert.equal(client.connectionParameters.host, "localhost");
  assert.equal(client.connectionParameters.ssl, false);
});

test("pool URL timeout parameters cannot override validated defaults or overrides", () => {
  for (const overrides of [{}, { PG_QUERY_TIMEOUT_MS: "1234", PG_STATEMENT_TIMEOUT_MS: "5678" }]) {
    const config = poolConfig({ DATABASE_URL: "postgresql://database.invalid/example?query_timeout=0&statement_timeout=0&query_timeout=1&statement_timeout=1", ...overrides });
    const client = new Client(config);
    assert.equal(client.connectionParameters.query_timeout, Number(overrides.PG_QUERY_TIMEOUT_MS || 10000));
    assert.equal(client.connectionParameters.statement_timeout, Number(overrides.PG_STATEMENT_TIMEOUT_MS || 10000));
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  }
});

test("pool preserves normal host and unrelated URL options with verified TLS", () => {
  const config = poolConfig({ DATABASE_URL: "postgresql://database.invalid:5432/example?host=replica.invalid&application_name=evolve-test&connect_timeout=5" });
  const client = new Client(config);
  assert.equal(client.connectionParameters.host, "replica.invalid");
  assert.equal(client.connectionParameters.database, "example");
  assert.equal(client.connectionParameters.port, 5432);
  assert.equal(client.connectionParameters.application_name, "evolve-test");
  assert.equal(new URL(config.connectionString).searchParams.get("connect_timeout"), "5");
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
});
