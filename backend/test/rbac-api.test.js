const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const bcrypt = require("bcrypt");
const { createApp, signToken, generateTotpSecret, generateTotpCode } = require("../app");

const quiet = { log() {}, error() {} };

function mockDb(t, steps = []) {
  const pending = [...steps];
  const calls = [];
  t.after(() => assert.equal(pending.length, 0, "Expected database calls were not made"));
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const step = pending.shift();
      assert.ok(step, `Unexpected database call: ${sql}`);
      assert.match(sql, step.sql);
      if (step.params) assert.deepEqual(params, step.params);
      if (step.error) throw step.error;
      return { rows: step.rows || [], rowCount: step.rowCount !== undefined ? step.rowCount : (step.rows ? step.rows.length : 1) };
    }
  };
}

async function createTestClient(t, db, options = {}) {
  const testSecret = "test_rbac_secret_key_1234567890";
  const app = createApp({ db, logger: quiet, instanceId: "test-rbac-api", authSecret: testSecret, ...options });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));

  return {
    testSecret,
    async request(path, method = "GET", body, headers = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000)
      });
      return { status: response.status, body: await response.json(), headers: response.headers };
    }
  };
}

test("PUT /api/stations/:id rejects unauthenticated request with 401", async (t) => {
  const db = mockDb(t, []);
  const client = await createTestClient(t, db);

  const res = await client.request("/api/stations/1", "PUT", {
    name: "Updated Station",
    location: "Downtown"
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /Authentication required/);
});

test("PUT /api/stations/:id rejects regular user role with 403 Forbidden", async (t) => {
  const db = mockDb(t, []);
  const client = await createTestClient(t, db);
  const userToken = signToken({ userId: 5, role: "user", mfaVerified: true }, client.testSecret);

  const res = await client.request(
    "/api/stations/1",
    "PUT",
    { name: "Updated Station", location: "Downtown" },
    { Authorization: `Bearer ${userToken}` }
  );

  assert.equal(res.status, 403);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /insufficient permissions/);
});

test("PUT /api/stations/:id allows operator role with 200 OK", async (t) => {
  const db = mockDb(t, [
    {
      sql: /UPDATE stations SET name = \$1/,
      params: ["Updated Central", "North Sector", "ACTIVE", null, null, "1"],
      rows: [{ id: 1, name: "Updated Central", location: "North Sector", status: "ACTIVE" }]
    }
  ]);
  const client = await createTestClient(t, db);
  const operatorToken = signToken({ userId: 1, role: "operator", mfaVerified: true }, client.testSecret);

  const res = await client.request(
    "/api/stations/1",
    "PUT",
    { name: "Updated Central", location: "North Sector" },
    { Authorization: `Bearer ${operatorToken}` }
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.name, "Updated Central");
});

test("DELETE /api/stations/:id rejects regular user with 403 and allows operator with 200", async (t) => {
  const client = await createTestClient(t, mockDb(t, [
    {
      sql: /DELETE FROM stations WHERE id = \$1/,
      params: ["1"],
      rows: [{ id: 1, name: "Decommissioned Station" }]
    }
  ]));

  const userToken = signToken({ userId: 9, role: "user", mfaVerified: true }, client.testSecret);
  const operatorToken = signToken({ userId: 2, role: "operator", mfaVerified: true }, client.testSecret);

  // 1. User denied
  const userRes = await client.request(
    "/api/stations/1",
    "DELETE",
    undefined,
    { Authorization: `Bearer ${userToken}` }
  );
  assert.equal(userRes.status, 403);

  // 2. Operator allowed
  const opRes = await client.request(
    "/api/stations/1",
    "DELETE",
    undefined,
    { Authorization: `Bearer ${operatorToken}` }
  );
  assert.equal(opRes.status, 200);
  assert.equal(opRes.body.success, true);
});

test("PUT /api/chargers/:id and DELETE /api/chargers/:id enforce operator role", async (t) => {
  const db = mockDb(t, [
    {
      sql: /UPDATE chargers SET station_id = \$1/,
      params: [1, "DC_FAST", 50, "AVAILABLE", "7"],
      rows: [{ id: 7, power_kw: 50 }]
    },
    {
      sql: /DELETE FROM chargers WHERE id = \$1/,
      params: ["7"],
      rows: [{ id: 7 }]
    }
  ]);
  const client = await createTestClient(t, db);
  const userToken = signToken({ userId: 3, role: "user", mfaVerified: true }, client.testSecret);
  const opToken = signToken({ userId: 1, role: "operator", mfaVerified: true }, client.testSecret);

  // Unauthenticated rejected
  const unauth = await client.request("/api/chargers/7", "PUT", { station_id: 1, charger_type: "DC_FAST", power_kw: 50 });
  assert.equal(unauth.status, 401);

  // User role rejected
  const userPut = await client.request("/api/chargers/7", "PUT", { station_id: 1, charger_type: "DC_FAST", power_kw: 50 }, { Authorization: `Bearer ${userToken}` });
  assert.equal(userPut.status, 403);

  // Operator permitted
  const opPut = await client.request("/api/chargers/7", "PUT", { station_id: 1, charger_type: "DC_FAST", power_kw: 50 }, { Authorization: `Bearer ${opToken}` });
  assert.equal(opPut.status, 200);

  // Operator delete permitted
  const opDel = await client.request("/api/chargers/7", "DELETE", undefined, { Authorization: `Bearer ${opToken}` });
  assert.equal(opDel.status, 200);
});

test("PUT /api/bookings/:id prevents regular user from modifying other users' bookings", async (t) => {
  const db = mockDb(t, [
    // Database returns booking owned by user_id = 99
    {
      sql: /SELECT user_id FROM bookings WHERE id = \$1/,
      params: ["10"],
      rows: [{ user_id: 99 }]
    }
  ]);
  const client = await createTestClient(t, db);
  // Attacker token has user_id = 12
  const attackerToken = signToken({ userId: 12, role: "user", mfaVerified: true }, client.testSecret);

  const res = await client.request(
    "/api/bookings/10",
    "PUT",
    {
      user_id: 12,
      charger_id: 1,
      start_time: "2026-11-01T10:00:00Z",
      end_time: "2026-11-01T11:00:00Z"
    },
    { Authorization: `Bearer ${attackerToken}` }
  );

  assert.equal(res.status, 403);
  assert.match(res.body.message, /only update your own bookings/);
});

test("PUT /api/bookings/:id permits user to update their own booking", async (t) => {
  const db = mockDb(t, [
    {
      sql: /SELECT user_id FROM bookings WHERE id = \$1/,
      params: ["10"],
      rows: [{ user_id: 12 }]
    },
    {
      sql: /UPDATE bookings SET user_id = \$1/,
      params: [12, 1, "2026-11-01T10:00:00Z", "2026-11-01T11:00:00Z", "BOOKED", "10"],
      rows: [{ id: 10, user_id: 12, status: "BOOKED" }]
    }
  ]);
  const client = await createTestClient(t, db);
  const ownerToken = signToken({ userId: 12, role: "user", mfaVerified: true }, client.testSecret);

  const res = await client.request(
    "/api/bookings/10",
    "PUT",
    {
      user_id: 12,
      charger_id: 1,
      start_time: "2026-11-01T10:00:00Z",
      end_time: "2026-11-01T11:00:00Z"
    },
    { Authorization: `Bearer ${ownerToken}` }
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.id, 10);
});

test("PUT /api/sessions/:id and DELETE /api/sessions/:id enforce operator role", async (t) => {
  const db = mockDb(t, [
    {
      sql: /UPDATE charging_sessions SET booking_id = \$1/,
      params: [1, "2026-10-31T01:00:00Z", null, 15, 180, "5"],
      rows: [{ id: 5, amount: 180 }]
    },
    {
      sql: /DELETE FROM charging_sessions WHERE id = \$1/,
      params: ["5"],
      rows: [{ id: 5 }]
    }
  ]);
  const client = await createTestClient(t, db);
  const userToken = signToken({ userId: 7, role: "user", mfaVerified: true }, client.testSecret);
  const opToken = signToken({ userId: 1, role: "operator", mfaVerified: true }, client.testSecret);

  // User denied
  const userRes = await client.request(
    "/api/sessions/5",
    "PUT",
    { booking_id: 1, start_time: "2026-10-31T01:00:00Z", energy_used_kwh: 15 },
    { Authorization: `Bearer ${userToken}` }
  );
  assert.equal(userRes.status, 403);

  // Operator allowed
  const opRes = await client.request(
    "/api/sessions/5",
    "PUT",
    { booking_id: 1, start_time: "2026-10-31T01:00:00Z", energy_used_kwh: 15 },
    { Authorization: `Bearer ${opToken}` }
  );
  assert.equal(opRes.status, 200);

  // Operator delete allowed
  const opDel = await client.request(
    "/api/sessions/5",
    "DELETE",
    undefined,
    { Authorization: `Bearer ${opToken}` }
  );
  assert.equal(opDel.status, 200);
});

test("Full TOTP MFA Workflow: Login -> MFA Challenge -> Verify -> Protected Access", async (t) => {
  const secret = generateTotpSecret(20);
  const passwordHash = await bcrypt.hash("OperatorSecurePass123!", 12);

  const db = mockDb(t, [
    // Step 1: POST /api/login for MFA-enabled user
    {
      sql: /FROM users\s+WHERE LOWER\(email\) = LOWER\(\$1\)/,
      params: ["mfa_operator@evolve.com"],
      rows: [
        {
          id: 88,
          name: "MFA Operator",
          email: "mfa_operator@evolve.com",
          password_hash: passwordHash,
          role: "operator",
          totp_secret: secret,
          mfa_enabled: true
        }
      ]
    },
    // Step 2: POST /api/mfa/verify
    {
      sql: /SELECT id, name, email, role, totp_secret, mfa_enabled FROM users WHERE id = \$1/,
      params: [88],
      rows: [
        {
          id: 88,
          name: "MFA Operator",
          email: "mfa_operator@evolve.com",
          role: "operator",
          totp_secret: secret,
          mfa_enabled: true
        }
      ]
    },
    // Step 3: Access protected PUT endpoint
    {
      sql: /UPDATE stations SET name = \$1/,
      params: ["Secured Station", "City Center", "ACTIVE", null, null, "3"],
      rows: [{ id: 3, name: "Secured Station" }]
    }
  ]);

  const client = await createTestClient(t, db);

  // Step 1: User logs in with password
  const loginRes = await client.request("/api/login", "POST", {
    email: "mfa_operator@evolve.com",
    password: "OperatorSecurePass123!"
  });

  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.body.success, true);
  assert.equal(loginRes.body.mfa_required, true);
  assert.ok(loginRes.body.mfa_token, "Must provide temporary MFA challenge token");

  const mfaToken = loginRes.body.mfa_token;

  // Verify that mfa_token CANNOT be used to access protected APIs directly (anti-bypass guard)
  const bypassAttempt = await client.request(
    "/api/stations/3",
    "PUT",
    { name: "Secured Station", location: "City Center" },
    { Authorization: `Bearer ${mfaToken}` }
  );
  assert.equal(bypassAttempt.status, 401);
  assert.match(bypassAttempt.body.message, /Multi-factor authentication.*required/);

  // Step 2: Submit valid 6-digit TOTP code
  const currentTotp = generateTotpCode(secret);
  const verifyRes = await client.request("/api/mfa/verify", "POST", {
    mfa_token: mfaToken,
    totp_code: currentTotp
  });

  assert.equal(verifyRes.status, 200);
  assert.equal(verifyRes.body.success, true);
  assert.ok(verifyRes.body.token, "Must issue full verified access token");
  const fullAccessToken = verifyRes.body.token;

  // Step 3: Use full access token to access protected API
  const authorizedRes = await client.request(
    "/api/stations/3",
    "PUT",
    { name: "Secured Station", location: "City Center" },
    { Authorization: `Bearer ${fullAccessToken}` }
  );

  assert.equal(authorizedRes.status, 200);
  assert.equal(authorizedRes.body.name, "Secured Station");
});

test("POST /api/mfa/verify rejects invalid TOTP code with 401", async (t) => {
  const secret = generateTotpSecret(20);
  const client = await createTestClient(t, mockDb(t, [
    {
      sql: /SELECT id, name, email, role, totp_secret, mfa_enabled FROM users WHERE id = \$1/,
      params: [88],
      rows: [
        {
          id: 88,
          totp_secret: secret,
          mfa_enabled: true
        }
      ]
    }
  ]));

  const mfaToken = signToken({ userId: 88, role: "operator", mfaRequired: true, mfaVerified: false }, client.testSecret);

  const res = await client.request("/api/mfa/verify", "POST", {
    mfa_token: mfaToken,
    totp_code: "999999" // Deliberately incorrect TOTP code
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /Invalid or expired TOTP code/);
});

test("PUT /api/bookings/:id prevents user from altering ownership user_id via request body", async (t) => {
  const db = mockDb(t, [
    {
      sql: /SELECT user_id FROM bookings WHERE id = \$1/,
      params: ["15"],
      rows: [{ user_id: 12 }]
    },
    {
      sql: /UPDATE bookings SET user_id = \$1/,
      params: [12, 1, "2026-11-01T10:00:00Z", "2026-11-01T11:00:00Z", "BOOKED", "15"],
      rows: [{ id: 15, user_id: 12, status: "BOOKED" }]
    }
  ]);
  const client = await createTestClient(t, db);
  const userToken = signToken({ userId: 12, role: "user", mfaVerified: true }, client.testSecret);

  // User attempts to change user_id to 999
  const res = await client.request(
    "/api/bookings/15",
    "PUT",
    {
      user_id: 999, // Tampered user_id
      charger_id: 1,
      start_time: "2026-11-01T10:00:00Z",
      end_time: "2026-11-01T11:00:00Z"
    },
    { Authorization: `Bearer ${userToken}` }
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.user_id, 12); // user_id forced to authenticated user ID 12
});

test("MFA enrollment lifecycle: enroll -> confirm -> re-enroll requires current TOTP", async (t) => {
  const secret = generateTotpSecret(20);
  const validCode = generateTotpCode(secret);

  const db = mockDb(t, [
    // 1. Initial enroll: user has mfa_enabled = false
    {
      sql: /SELECT id, email, totp_secret, mfa_enabled FROM users WHERE id = \$1/,
      params: [50],
      rows: [{ id: 50, email: "user50@evolve.com", totp_secret: null, mfa_enabled: false }]
    },
    {
      sql: /UPDATE users SET totp_secret = \$1, mfa_enabled = false WHERE id = \$2/
    },
    // 2. Confirm enrollment with valid TOTP code
    {
      sql: /SELECT id, name, email, role, totp_secret FROM users WHERE id = \$1/,
      params: [50],
      rows: [{ id: 50, name: "User 50", email: "user50@evolve.com", role: "user", totp_secret: secret }]
    },
    {
      sql: /UPDATE users SET mfa_enabled = true WHERE id = \$1/,
      params: [50],
      rows: [{ id: 50 }]
    },
    // 3. Re-enroll attempt without current TOTP code when mfa_enabled is active -> 403 Forbidden
    {
      sql: /SELECT id, email, totp_secret, mfa_enabled FROM users WHERE id = \$1/,
      params: [50],
      rows: [{ id: 50, email: "user50@evolve.com", totp_secret: secret, mfa_enabled: true }]
    }
  ]);

  const client = await createTestClient(t, db);
  const userToken = signToken({ userId: 50, email: "user50@evolve.com", role: "user", mfaVerified: true }, client.testSecret);

  // 1. Initial enrollment
  const enrollRes = await client.request(
    "/api/mfa/enroll",
    "POST",
    {},
    { Authorization: `Bearer ${userToken}` }
  );
  assert.equal(enrollRes.status, 200);
  assert.equal(enrollRes.body.success, true);
  assert.ok(enrollRes.body.secret);
  assert.ok(enrollRes.body.otpauth_url);

  // 2. Confirm enrollment
  const confirmRes = await client.request(
    "/api/mfa/confirm",
    "POST",
    { totp_code: validCode },
    { Authorization: `Bearer ${userToken}` }
  );
  assert.equal(confirmRes.status, 200);
  assert.equal(confirmRes.body.success, true);
  assert.ok(confirmRes.body.token);

  // 3. Re-enrollment without current TOTP code is rejected
  const reEnrollBlocked = await client.request(
    "/api/mfa/enroll",
    "POST",
    {},
    { Authorization: `Bearer ${userToken}` }
  );
  assert.equal(reEnrollBlocked.status, 403);
  assert.match(reEnrollBlocked.body.message, /current 6-digit TOTP code is required/);
});

test("POST /api/sessions/:id/complete security: unauthenticated and invalid tokens rejected", async (t) => {
  const client = await createTestClient(t, mockDb(t, []));

  // 1. Unauthenticated request rejected with 401
  const unauthRes = await client.request("/api/sessions/4/complete", "POST", { energy_used_kwh: 5 });
  assert.equal(unauthRes.status, 401);
  assert.equal(unauthRes.body.success, false);
  assert.match(unauthRes.body.message, /Authentication required/);

  // 2. Tampered / invalid token rejected with 401
  const invalidRes = await client.request(
    "/api/sessions/4/complete",
    "POST",
    { energy_used_kwh: 5 },
    { Authorization: "Bearer invalid.tampered.token" }
  );
  assert.equal(invalidRes.status, 401);
  assert.equal(invalidRes.body.success, false);

  // 3. MFA-only challenge token rejected with 401
  const mfaChallengeToken = signToken(
    { userId: 1, role: "user", mfaRequired: true, mfaVerified: false },
    client.testSecret
  );
  const mfaRes = await client.request(
    "/api/sessions/4/complete",
    "POST",
    { energy_used_kwh: 5 },
    { Authorization: `Bearer ${mfaChallengeToken}` }
  );
  assert.equal(mfaRes.status, 401);
  assert.equal(mfaRes.body.success, false);
  assert.match(mfaRes.body.message, /Multi-factor authentication/);

  // 4. Unauthorized role rejected with 403
  const guestToken = signToken(
    { userId: 99, role: "guest", mfaVerified: true },
    client.testSecret
  );
  const guestRes = await client.request(
    "/api/sessions/4/complete",
    "POST",
    { energy_used_kwh: 5 },
    { Authorization: `Bearer ${guestToken}` }
  );
  assert.equal(guestRes.status, 403);
  assert.equal(guestRes.body.success, false);
  assert.match(guestRes.body.message, /insufficient permissions/);
});

test("POST /api/sessions/:id/complete authorization: ownership checks and role permissions", async (t) => {
  const db = mockDb(t, [
    // 1. Regular user attempting to complete another user's session (session owner is user 42, requester is user 10)
    {
      sql: /SELECT cs\.\*, b\.charger_id, b\.user_id FROM charging_sessions cs/,
      params: ["7"],
      rows: [{ id: 7, booking_id: 1, charger_id: 2, user_id: 42 }]
    },
    // 2. Regular user completing their own session (session owner is user 10, requester is user 10)
    {
      sql: /SELECT cs\.\*, b\.charger_id, b\.user_id FROM charging_sessions cs/,
      params: ["7"],
      rows: [{ id: 7, booking_id: 1, charger_id: 2, user_id: 10 }]
    },
    {
      sql: /UPDATE charging_sessions SET end_time = \$1, energy_used_kwh = \$2, amount = \$3 WHERE id = \$4/,
      rows: [{ id: 7, energy_used_kwh: 5, amount: "60.00" }]
    },
    {
      sql: /UPDATE chargers SET status = 'AVAILABLE' WHERE id = \$1/,
      params: [2],
      rows: [{ id: 2, status: "AVAILABLE" }]
    },
    // 3. Operator completing another user's session (session owner is user 42, operator is user 99)
    {
      sql: /SELECT cs\.\*, b\.charger_id, b\.user_id FROM charging_sessions cs/,
      params: ["8"],
      rows: [{ id: 8, booking_id: 2, charger_id: 3, user_id: 42 }]
    },
    {
      sql: /UPDATE charging_sessions SET end_time = \$1, energy_used_kwh = \$2, amount = \$3 WHERE id = \$4/,
      rows: [{ id: 8, energy_used_kwh: 10, amount: "120.00" }]
    },
    {
      sql: /UPDATE chargers SET status = 'AVAILABLE' WHERE id = \$1/,
      params: [3],
      rows: [{ id: 3, status: "AVAILABLE" }]
    },
    // 4. Admin completing session
    {
      sql: /SELECT cs\.\*, b\.charger_id, b\.user_id FROM charging_sessions cs/,
      params: ["9"],
      rows: [{ id: 9, booking_id: 3, charger_id: 4, user_id: 42 }]
    },
    {
      sql: /UPDATE charging_sessions SET end_time = \$1, energy_used_kwh = \$2, amount = \$3 WHERE id = \$4/,
      rows: [{ id: 9, energy_used_kwh: 15, amount: "180.00" }]
    },
    {
      sql: /UPDATE chargers SET status = 'AVAILABLE' WHERE id = \$1/,
      params: [4],
      rows: [{ id: 4, status: "AVAILABLE" }]
    }
  ]);

  const client = await createTestClient(t, db);
  const user10Token = signToken({ userId: 10, role: "user", mfaVerified: true }, client.testSecret);
  const opToken = signToken({ userId: 99, role: "operator", mfaVerified: true }, client.testSecret);
  const adminToken = signToken({ userId: 100, role: "admin", mfaVerified: true }, client.testSecret);

  // 1. Regular user fails to complete another user's session -> 403 Forbidden
  const forbiddenRes = await client.request(
    "/api/sessions/7/complete",
    "POST",
    { energy_used_kwh: 5 },
    { Authorization: `Bearer ${user10Token}` }
  );
  assert.equal(forbiddenRes.status, 403);
  assert.equal(forbiddenRes.body.success, false);
  assert.match(forbiddenRes.body.message, /only complete your own charging sessions/);

  // 2. Regular user succeeds completing own session -> 200 OK
  const ownRes = await client.request(
    "/api/sessions/7/complete",
    "POST",
    { energy_used_kwh: 5 },
    { Authorization: `Bearer ${user10Token}` }
  );
  assert.equal(ownRes.status, 200);
  assert.equal(ownRes.body.success, true);
  assert.equal(ownRes.body.amount, 60);

  // 3. Operator succeeds completing session for any user -> 200 OK
  const opRes = await client.request(
    "/api/sessions/8/complete",
    "POST",
    { energy_used_kwh: 10 },
    { Authorization: `Bearer ${opToken}` }
  );
  assert.equal(opRes.status, 200);
  assert.equal(opRes.body.success, true);
  assert.equal(opRes.body.amount, 120);

  // 4. Admin succeeds completing session -> 200 OK
  const adminRes = await client.request(
    "/api/sessions/9/complete",
    "POST",
    { energy_used_kwh: 15 },
    { Authorization: `Bearer ${adminToken}` }
  );
  assert.equal(adminRes.status, 200);
  assert.equal(adminRes.body.success, true);
  assert.equal(adminRes.body.amount, 180);
});

test("POST /api/sessions/:id/complete input validation and tamper-resistance", async (t) => {
  const db = mockDb(t, [
    // Database call for successful tamper-resistance test
    {
      sql: /SELECT cs\.\*, b\.charger_id, b\.user_id FROM charging_sessions cs/,
      params: ["10"],
      rows: [{ id: 10, booking_id: 5, charger_id: 1, user_id: 1 }]
    },
    {
      sql: /UPDATE charging_sessions SET end_time = \$1, energy_used_kwh = \$2, amount = \$3 WHERE id = \$4/,
      rows: [{ id: 10, energy_used_kwh: 10, amount: "120.00" }]
    },
    {
      sql: /UPDATE chargers SET status = 'AVAILABLE' WHERE id = \$1/,
      params: [1],
      rows: [{ id: 1, status: "AVAILABLE" }]
    }
  ]);

  const client = await createTestClient(t, db);
  const opToken = signToken({ userId: 1, role: "operator", mfaVerified: true }, client.testSecret);
  const authHeader = { Authorization: `Bearer ${opToken}` };

  // 1. Invalid session IDs rejected with 400
  for (const badId of ["abc", "-5", "0", "1.5"]) {
    const res = await client.request(`/api/sessions/${badId}/complete`, "POST", { energy_used_kwh: 10 }, authHeader);
    assert.equal(res.status, 400, `Expected 400 for bad ID: ${badId}`);
    assert.match(res.body.message, /Valid numeric session ID is required/);
  }

  // 2. Invalid energy values rejected with 400 (without querying database)
  const invalidEnergies = [
    {},
    { energy_used_kwh: null },
    { energy_used_kwh: true },
    { energy_used_kwh: false },
    { energy_used_kwh: "" },
    { energy_used_kwh: "   " },
    { energy_used_kwh: -0.1 },
    { energy_used_kwh: -50 },
    { energy_used_kwh: "not-a-number" },
    { energy_used_kwh: Infinity },
    { energy_used_kwh: -Infinity }
  ];

  for (const payload of invalidEnergies) {
    const res = await client.request("/api/sessions/10/complete", "POST", payload, authHeader);
    assert.equal(res.status, 400, `Expected 400 for payload: ${JSON.stringify(payload)}`);
    assert.match(res.body.message, /Valid non-negative energy_used_kwh is required/);
  }

  // 3. Client-supplied amount or tariff cannot override server calculation
  // Client attempts to claim amount: 0 and rate_per_kwh: 0 for 10 kWh charge
  const tamperPayload = {
    energy_used_kwh: 10,
    amount: 0,
    rate_per_kwh: 0,
    tariff: 0,
    user_id: 9999
  };
  const res = await client.request("/api/sessions/10/complete", "POST", tamperPayload, authHeader);
  assert.equal(res.status, 200);
  // Server must strictly enforce ₹12/kWh -> 10 * 12 = 120
  assert.equal(res.body.rate_per_kwh, 12);
  assert.equal(res.body.energy_used_kwh, 10);
  assert.equal(res.body.amount, 120);
});
