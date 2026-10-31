const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const bcrypt = require("bcrypt");
const { createApp, hashPassword, verifyPassword, BCRYPT_SALT_ROUNDS } = require("../app");

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
      assert.ok(step, "Unexpected database call");
      assert.match(sql, step.sql);
      if (step.params) assert.deepEqual(params, step.params);
      if (step.error) throw step.error;
      return { rows: step.rows || [] };
    }
  };
}

async function createTestClient(t, db, options = {}) {
  const app = createApp({ db, logger: quiet, instanceId: "test-login-api", ...options });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return async (path, method = "GET", body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000)
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
}

test("BCRYPT_SALT_ROUNDS is configured to 12", () => {
  assert.equal(BCRYPT_SALT_ROUNDS, 12);
});

test("hashPassword generates a valid 12-salt-round bcrypt hash", async () => {
  const plain = "OperatorSecurePass#2026";
  const hash = await hashPassword(plain, 12);
  assert.equal(typeof hash, "string");
  assert.match(hash, /^\$2[abxy]\$12\$[./A-Za-z0-9]{53}$/);
  assert.equal(await bcrypt.compare(plain, hash), true);
  assert.equal(await bcrypt.compare("WrongPassword", hash), false);
});

test("hashPassword rejects empty or non-string inputs", async () => {
  await assert.rejects(() => hashPassword(""), /non-empty string/);
  await assert.rejects(() => hashPassword(null), /non-empty string/);
  await assert.rejects(() => hashPassword(12345), /non-empty string/);
});

test("verifyPassword validates correct passwords and safely rejects mismatches / malformed hashes", async () => {
  const hash = await hashPassword("Secret123!");
  assert.equal(await verifyPassword("Secret123!", hash), true);
  assert.equal(await verifyPassword("WrongPassword", hash), false);
  assert.equal(await verifyPassword("Secret123!", "plaintext_password"), false);
  assert.equal(await verifyPassword("Secret123!", null), false);
  assert.equal(await verifyPassword(null, hash), false);
});

test("POST /api/login rejects requests missing email or password with 400", async (t) => {
  const db = mockDb(t);
  const request = await createTestClient(t, db);

  const missingEmail = await request("/api/login", "POST", { password: "password123" });
  assert.equal(missingEmail.status, 400);
  assert.equal(missingEmail.body.success, false);
  assert.equal(missingEmail.body.message, "Email and password are required");

  const missingPassword = await request("/api/login", "POST", { email: "operator@evolve.com" });
  assert.equal(missingPassword.status, 400);
  assert.equal(missingPassword.body.success, false);
  assert.equal(missingPassword.body.message, "Email and password are required");

  assert.equal(db.calls.length, 0);
});

test("POST /api/login rejects nonexistent user with 401", async (t) => {
  const db = mockDb(t, [
    {
      sql: /FROM users\s+WHERE LOWER\(email\) = LOWER\(\$1\)/,
      params: ["nonexistent@evolve.com"],
      rows: []
    }
  ]);
  const request = await createTestClient(t, db);

  const res = await request("/api/login", "POST", {
    email: "nonexistent@evolve.com",
    password: "AnyPassword123"
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Invalid email or password");
});

test("POST /api/login succeeds with valid password against salted bcrypt hash and never returns password_hash", async (t) => {
  const plainPassword = "SuperSecret#2026";
  const validHash = await bcrypt.hash(plainPassword, 12);

  const db = mockDb(t, [
    {
      sql: /FROM users\s+WHERE LOWER\(email\) = LOWER\(\$1\)/,
      params: ["operator@evolve.com"],
      rows: [
        {
          id: 42,
          name: "Operations Lead",
          email: "operator@evolve.com",
          password_hash: validHash,
          role: "operator",
          created_at: "2026-09-01T00:00:00.000Z"
        }
      ]
    }
  ]);
  const request = await createTestClient(t, db);

  const res = await request("/api/login", "POST", {
    email: "operator@evolve.com",
    password: plainPassword
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Login successful");
  assert.deepEqual(res.body.user, {
    id: 42,
    name: "Operations Lead",
    email: "operator@evolve.com",
    role: "operator"
  });
  // STRICT AUDIT: Ensure password_hash is NEVER leaked in response
  assert.equal(res.body.user.password_hash, undefined);
  assert.equal(res.body.password_hash, undefined);
});

test("POST /api/login rejects incorrect password against salted bcrypt hash with 401", async (t) => {
  const validHash = await bcrypt.hash("CorrectPassword#123", 12);

  const db = mockDb(t, [
    {
      sql: /FROM users\s+WHERE LOWER\(email\) = LOWER\(\$1\)/,
      params: ["operator@evolve.com"],
      rows: [
        {
          id: 42,
          name: "Operations Lead",
          email: "operator@evolve.com",
          password_hash: validHash,
          role: "operator"
        }
      ]
    }
  ]);
  const request = await createTestClient(t, db);

  const res = await request("/api/login", "POST", {
    email: "operator@evolve.com",
    password: "IncorrectPassword"
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Invalid email or password");
});

test("POST /api/login rejects universal 'demo123' bypass when account password is not demo123", async (t) => {
  const accountHash = await bcrypt.hash("RealOperatorPassword#999", 12);

  const db = mockDb(t, [
    {
      sql: /FROM users\s+WHERE LOWER\(email\) = LOWER\(\$1\)/,
      params: ["operator@evolve.com"],
      rows: [
        {
          id: 42,
          name: "Operations Lead",
          email: "operator@evolve.com",
          password_hash: accountHash,
          role: "operator"
        }
      ]
    }
  ]);
  const request = await createTestClient(t, db);

  // Submitting 'demo123' must be rejected now that universal backdoor is eliminated
  const res = await request("/api/login", "POST", {
    email: "operator@evolve.com",
    password: "demo123"
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Invalid email or password");
});

test("POST /api/login rejects plaintext password when database holds legacy plaintext (plaintext equality removed)", async (t) => {
  const db = mockDb(t, [
    {
      sql: /FROM users\s+WHERE LOWER\(email\) = LOWER\(\$1\)/,
      params: ["legacy@evolve.com"],
      rows: [
        {
          id: 99,
          name: "Legacy User",
          email: "legacy@evolve.com",
          password_hash: "plainTextPassword123", // legacy unhashed string
          role: "user"
        }
      ]
    }
  ]);
  const request = await createTestClient(t, db);

  // Even if user sends the exact plaintext match, it must NOT succeed without bcrypt hash
  const res = await request("/api/login", "POST", {
    email: "legacy@evolve.com",
    password: "plainTextPassword123"
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Invalid email or password");
});

test("POST /api/login rejects demo123 against legacy 'demo_password' prefix string", async (t) => {
  const db = mockDb(t, [
    {
      sql: /FROM users\s+WHERE LOWER\(email\) = LOWER\(\$1\)/,
      params: ["operator@evolve.com"],
      rows: [
        {
          id: 1,
          name: "Demo Operator",
          email: "operator@evolve.com",
          password_hash: "demo_password_operator_placeholder",
          role: "operator"
        }
      ]
    }
  ]);
  const request = await createTestClient(t, db);

  const res = await request("/api/login", "POST", {
    email: "operator@evolve.com",
    password: "demo123"
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Invalid email or password");
});
