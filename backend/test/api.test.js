const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createApp } = require("../app");

const quiet = { log() {}, error() {} };
function database(t, steps = []) {
  const pending = [...steps];
  const calls = [];
  t.after(() => assert.equal(pending.length, 0, "Expected database calls were not made"));
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const step = pending.shift();
      assert.ok(step, "Unexpected database call");
      assert.match(sql, step.sql);
      if (step.params) assert.deepEqual(params, step.params);
      if (step.error) throw step.error;
      return { rows: step.rows || [] };
    }
  };
}
async function client(t, db, options = {}) {
  const app = createApp({ db, logger: quiet, instanceId: "test-api", ...options });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return async (path, method = "GET", body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3000)
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
}
const booking = { user_id: 1, charger_id: 7, start_time: "2026-11-01T10:00:00Z", end_time: "2026-11-01T11:00:00Z" };

test("construction, root, liveness and instance identification do not query database", async (t) => {
  const db = database(t);
  const request = await client(t, db);
  assert.deepEqual((await request("/")).body, { message: "EVolve backend is running!" });
  const health = await request("/health");
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: "ok" });
  assert.equal(health.headers.get("x-instance-id"), "test-api");
  assert.deepEqual((await request("/api/instance")).body, { instanceId: "test-api" });
  assert.equal(db.calls.length, 0);
});

test("instance identifiers are opaque, stable per app and distinct between apps", async (t) => {
  const db = database(t);
  const first = await client(t, db, { instanceId: undefined });
  const second = await client(t, db, { instanceId: undefined });
  const a = (await first("/api/instance")).body.instanceId;
  const b = (await second("/api/instance")).body.instanceId;
  assert.match(a, /^[a-f0-9-]{36}$/);
  assert.notEqual(a, b);
  assert.equal((await first("/health")).headers.get("x-instance-id"), a);
  assert.throws(() => createApp({ db, instanceId: "invalid/header" }), /Invalid instance identifier/);
});

for (const [path, sql, rows, params] of [
  ["/api/stations", /LEFT JOIN chargers/, [{ id: 1, name: "Station", total_chargers: 2, available_chargers: 1, charging_chargers: 1 }]],
  ["/api/stations/1", /WHERE s.id = \$1/, [{ id: 1, name: "Station" }], ["1"]],
  ["/api/chargers", /SELECT \* FROM chargers ORDER BY/, [{ id: 7, station_id: 1, power_kw: "22.00", status: "AVAILABLE" }]],
  ["/api/chargers?station_id=1", /WHERE station_id = \$1/, [{ id: 7 }], ["1"]],
  ["/api/chargers/7", /WHERE id = \$1/, [{ id: 7 }], ["7"]]
]) {
  test(`existing response shape: ${path}`, async (t) => {
    const request = await client(t, database(t, [{ sql, rows, params }]));
    const result = await request(path);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, /\/\d+$/.test(path) ? rows[0] : rows);
  });
}

for (const resource of ["stations", "chargers"]) {
  test(`${resource} detail missing returns 404`, async (t) => {
    const request = await client(t, database(t, [{ sql: /SELECT/, rows: [] }]));
    const result = await request(`/api/${resource}/999`);
    assert.equal(result.status, 404);
    assert.equal(result.body.success, false);
  });
}

test("nearby stations retain distance calculation and order", async (t) => {
  const request = await client(t, database(t, [{ sql: /latitude IS NOT NULL/, rows: [
    { id: 2, latitude: 1, longitude: 0 }, { id: 1, latitude: 0, longitude: 0 }
  ] }]));
  const result = await request("/api/stations/nearby?latitude=0&longitude=0");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.map((x) => [x.id, x.distance_km]), [[1, 0], [2, 111.19]]);
});

test("nearby coordinates validation makes no database calls", async (t) => {
  const request = await client(t, database(t));
  assert.equal((await request("/api/stations/nearby")).status, 400);
  assert.equal((await request("/api/stations/nearby?latitude=91&longitude=0")).status, 400);
});

for (const [name, body, message] of [
  ["missing fields", {}, "user_id, charger_id, start_time, and end_time are required"],
  ["invalid date", { ...booking, start_time: "invalid" }, "Invalid start_time or end_time format"],
  ["reversed times", { ...booking, end_time: booking.start_time }, "end_time must be after start_time"]
]) {
  test(`booking validation: ${name}`, async (t) => {
    const request = await client(t, database(t));
    const result = await request("/api/bookings", "POST", body);
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { success: false, message });
  });
}

test("booking creation rejects missing charger", async (t) => {
  const request = await client(t, database(t, [{ sql: /FROM chargers/, params: [7] }]));
  assert.equal((await request("/api/bookings", "POST", booking)).status, 404);
});

test("booking overlap rejects conflict without insert", async (t) => {
  const request = await client(t, database(t, [
    { sql: /FROM chargers/, rows: [{ id: 7 }] },
    { sql: /status != 'CANCELLED'/, params: [7, booking.end_time, booking.start_time], rows: [{ id: 2 }] }
  ]));
  const result = await request("/api/bookings", "POST", booking);
  assert.equal(result.status, 409);
  assert.equal(result.body.message, "Charger is already booked for the selected time slot");
});

test("booking creation preserves fields and default status", async (t) => {
  const row = { id: 3, ...booking, status: "BOOKED" };
  const request = await client(t, database(t, [
    { sql: /FROM chargers/, rows: [{ id: 7 }] },
    { sql: /FROM bookings/, rows: [] },
    { sql: /INSERT INTO bookings/, params: [1, 7, booking.start_time, booking.end_time, "BOOKED"], rows: [row] }
  ]));
  const result = await request("/api/bookings", "POST", booking);
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, row);
});

for (const path of ["/api/sessions", "/api/sessions/start"]) {
  test(`${path} validates booking and rejects duplicate active session`, async (t) => {
    const request = await client(t, database(t, [
      { sql: /FROM bookings/, params: [3], rows: [{ id: 3, charger_id: 7 }] },
      { sql: /end_time IS NULL/, params: [3], rows: [{ id: 4 }] }
    ]));
    assert.equal((await request(path, "POST", {})).status, 400);
    const result = await request(path, "POST", { booking_id: 3 });
    assert.equal(result.status, 409);
    assert.deepEqual(result.body.session, { id: 4 });
  });
  test(`${path} starts session and marks charger charging`, async (t) => {
    const db = database(t, [
      { sql: /FROM bookings/, rows: [{ id: 3, charger_id: 7 }] },
      { sql: /end_time IS NULL/ },
      { sql: /INSERT INTO charging_sessions/, rows: [{ id: 4, booking_id: 3, end_time: null }] },
      { sql: /UPDATE chargers SET status = 'CHARGING'/, params: [7] }
    ]);
    const request = await client(t, db);
    const result = await request(path, "POST", { booking_id: 3 });
    assert.equal(result.status, 201);
    assert.deepEqual(result.body, { id: 4, booking_id: 3, end_time: null });
    assert.equal(db.calls[2].params[0], 3);
    assert.ok(Number.isFinite(Date.parse(db.calls[2].params[1])));
  });
}

test("session creation retains 12 INR/kWh billing", async (t) => {
  const request = await client(t, database(t, [
    { sql: /FROM bookings/, rows: [{ id: 3, charger_id: 7 }] },
    { sql: /end_time IS NULL/ },
    { sql: /INSERT INTO charging_sessions/, params: [3, booking.start_time, booking.end_time, 2.125, 25.5], rows: [{ id: 4, amount: "25.50" }] }
  ]));
  const result = await request("/api/sessions", "POST", { booking_id: 3, start_time: booking.start_time, end_time: booking.end_time, energy_used_kwh: 2.125 });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, { id: 4, amount: "25.50" });
});

test("session completion bills at 12 INR/kWh and releases charger", async (t) => {
  const db = database(t, [
    { sql: /WHERE cs.id = \$1/, params: ["4"], rows: [{ id: 4, charger_id: 7 }] },
    { sql: /UPDATE charging_sessions/, rows: [{ id: 4, amount: "25.50" }] },
    { sql: /UPDATE chargers SET status = 'AVAILABLE'/, params: [7] }
  ]);
  const request = await client(t, db);
  const result = await request("/api/sessions/4/complete", "POST", { energy_used_kwh: 2.125 });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true, message: "Charging session completed successfully", rate_per_kwh: 12, energy_used_kwh: 2.125, amount: 25.5, session: { id: 4, amount: "25.50" } });
  assert.deepEqual(db.calls[1].params.slice(1), [2.125, 25.5, "4"]);
  assert.ok(Number.isFinite(Date.parse(db.calls[1].params[0])));
});

test("session completion validates energy before querying", async (t) => {
  const request = await client(t, database(t));
  for (const body of [{}, { energy_used_kwh: -1 }, { energy_used_kwh: "invalid" }]) {
    assert.equal((await request("/api/sessions/4/complete", "POST", body)).status, 400);
  }
});

test("session completion missing session returns 404", async (t) => {
  const request = await client(t, database(t, [{ sql: /FROM charging_sessions/ }]));
  assert.equal((await request("/api/sessions/4/complete", "POST", { energy_used_kwh: 0 })).status, 404);
});

test("database errors are sanitized in response and logs", async (t) => {
  const logs = [];
  const request = await client(t, database(t, [{ sql: /SELECT/, error: Object.assign(new Error("private-database-detail"), { code: "08006" }) }]), { logger: { ...quiet, error: (message) => logs.push(message) } });
  const result = await request("/api/stations");
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { success: false, message: "Failed to fetch stations from database", error: "Internal server error" });
  assert.deepEqual(logs, ["Error fetching stations: [08006]"]);
});

test("malformed JSON returns a sanitized 400", async (t) => {
  const server = createApp({ db: database(t), logger: quiet }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/bookings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{", signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, message: "Invalid JSON body" });
});
