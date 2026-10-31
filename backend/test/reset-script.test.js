const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const {
  TARGET_EMAIL,
  BCRYPT_SALT_ROUNDS,
  MIN_PASSWORD_LENGTH,
  sanitizeError,
  validatePassword,
  executeResetTransaction
} = require("../../scripts/reset-demo-password");

test("reset script configuration constants", () => {
  assert.equal(TARGET_EMAIL, "demo@evolve.com");
  assert.equal(BCRYPT_SALT_ROUNDS, 12);
  assert.equal(MIN_PASSWORD_LENGTH, 12);
});

test("bcrypt work factor 12 generates compliant $2b$12$ hash from >= 12 char password", async () => {
  const password = "ValidPassword2026!#";
  assert.ok(password.length >= MIN_PASSWORD_LENGTH);
  assert.notEqual(password.toLowerCase(), "demo123");

  const hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  assert.equal(hash.length, 60);
  assert.match(hash, /^\$2b\$12\$/);
  assert.equal(await bcrypt.compare(password, hash), true);
  assert.equal(await bcrypt.compare("WrongPassword123", hash), false);
});

test("exact password characters are preserved without silent trimming", async () => {
  const leadingTrailingSpace = "  P@sswordWithSpaces2026#  ";
  assert.ok(leadingTrailingSpace.length >= MIN_PASSWORD_LENGTH);
  const hash = await bcrypt.hash(leadingTrailingSpace, BCRYPT_SALT_ROUNDS);

  // Exact match succeeds
  assert.equal(await bcrypt.compare(leadingTrailingSpace, hash), true);
  // Trimmed version must NOT match because trimming was not silently applied
  assert.equal(await bcrypt.compare(leadingTrailingSpace.trim(), hash), false);
});

test("validatePassword enforces min length, rejects demo123, and requires match", () => {
  // Reject empty
  assert.throws(() => validatePassword("", ""), /Password cannot be empty/);

  // Reject demo123 (case insensitive)
  assert.throws(
    () => validatePassword("demo123", "demo123"),
    /Insecure password rejected: 'demo123'/
  );
  assert.throws(
    () => validatePassword("DEMO123", "DEMO123"),
    /Insecure password rejected: 'demo123'/
  );
  assert.throws(
    () => validatePassword("Demo123_ExtraLongPassword", "Demo123_ExtraLongPassword"),
    /Insecure password rejected: 'demo123'/
  );

  // Reject short
  assert.throws(
    () => validatePassword("shortPass1!", "shortPass1!"),
    /must be at least 12 characters/
  );

  // Reject mismatch
  assert.throws(
    () => validatePassword("ValidPassword123!", "DifferentPassword123!"),
    /Passwords do not match/
  );

  // Accept valid matching >= 12 character password
  assert.equal(validatePassword("ValidPassword123!", "ValidPassword123!"), true);
});

test("sanitizeError redacts PostgreSQL URLs with embedded credentials", () => {
  const rawUrlError = new Error("Connection failed at postgresql://user_app:supersecret99@ep-tiny-neon.us-east-2.aws.neon.tech:5432/neondb?sslmode=require");
  const sanitized = sanitizeError(rawUrlError);
  assert.ok(!sanitized.includes("user_app"), "Must redact username");
  assert.ok(!sanitized.includes("supersecret99"), "Must redact password");
  assert.ok(sanitized.includes("[REDACTED_URI]"), "Must replace with redacted URI token");
});

test("sanitizeError redacts raw PostgreSQL connection strings without credentials", () => {
  const rawDbUrl = "Failed to query database at postgres://internal-host.local:5432/evolve";
  const sanitized = sanitizeError(rawDbUrl);
  assert.ok(!sanitized.includes("postgres://internal-host.local:5432/evolve"));
  assert.ok(sanitized.includes("[REDACTED_DATABASE_URL]"));
});

test("sanitizeError redacts key-value connection string credentials (libpq, ODBC, ADO.NET)", () => {
  const libpqErr = "Connection failed: host=db.internal user=my_user password=my_top_secret_pass dbname=evolve_prod";
  const sanitizedLibpq = sanitizeError(libpqErr);
  assert.ok(!sanitizedLibpq.includes("my_user"), "Must redact user in libpq format");
  assert.ok(!sanitizedLibpq.includes("my_top_secret_pass"), "Must redact password in libpq format");
  assert.ok(sanitizedLibpq.includes("password=[REDACTED]"));
  assert.ok(sanitizedLibpq.includes("user=[REDACTED]"));

  const odbcErr = "Server=10.0.0.1;Database=test;User Id=dbadmin;Pwd=my_complex_pwd!;";
  const sanitizedOdbc = sanitizeError(odbcErr);
  assert.ok(!sanitizedOdbc.includes("dbadmin"), "Must redact User Id in ODBC format");
  assert.ok(!sanitizedOdbc.includes("my_complex_pwd!"), "Must redact Pwd in ODBC format");
  assert.ok(sanitizedOdbc.includes("User Id=[REDACTED]"));
  assert.ok(sanitizedOdbc.includes("Pwd=[REDACTED]"));
});

test("sanitizeError redacts query-string secrets and API tokens", () => {
  const urlWithParams = "Request to https://api.cloud.internal/auth?token=sec_tok_8899&password=cleartext123&apiKey=ak_9900&secret=s3cr3t timed out";
  const sanitized = sanitizeError(urlWithParams);
  assert.ok(!sanitized.includes("sec_tok_8899"), "Must redact token query param");
  assert.ok(!sanitized.includes("cleartext123"), "Must redact password query param");
  assert.ok(!sanitized.includes("ak_9900"), "Must redact apiKey query param");
  assert.ok(!sanitized.includes("s3cr3t"), "Must redact secret query param");
  assert.ok(sanitized.includes("token=[REDACTED]"));
  assert.ok(sanitized.includes("password=[REDACTED]"));
  assert.ok(sanitized.includes("apiKey=[REDACTED]"));
  assert.ok(sanitized.includes("secret=[REDACTED]"));
});

test("sanitizeError redacts Authorization header tokens (Bearer, Basic)", () => {
  const bearerErr = "401 Unauthorized for Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.secretSignature";
  const sanitizedBearer = sanitizeError(bearerErr);
  assert.ok(!sanitizedBearer.includes("eyJhbGciOi"), "Must redact Bearer token content");
  assert.ok(sanitizedBearer.includes("Bearer [REDACTED]"));

  const basicErr = "Invalid credentials header Basic dXNlcjpwYXNzd29yZA==";
  const sanitizedBasic = sanitizeError(basicErr);
  assert.ok(!sanitizedBasic.includes("dXNlcjpwYXNzd29yZA=="), "Must redact Basic auth content");
  assert.ok(sanitizedBasic.includes("Basic [REDACTED]"));
});

test("sanitizeError safely handles null, undefined, and non-error objects", () => {
  assert.equal(sanitizeError(null), "Unknown error");
  assert.equal(sanitizeError(undefined), "Unknown error");
  assert.equal(sanitizeError("Plain string error without secrets"), "Plain string error without secrets");
});

test("executeResetTransaction succeeds when target account exists and update affects 1 row", async () => {
  const queryLog = [];
  const mockClient = {
    query: async (sql, params) => {
      queryLog.push({ sql: sql.trim().split("\n")[0], params });
      if (sql.includes("BEGIN")) return {};
      if (sql.includes("FOR UPDATE")) {
        return {
          rows: [{
            id: 1,
            name: "Demo Operator",
            email: "demo@evolve.com",
            role: "operator",
            hash_length: 32,
            format_classification: "plaintext-or-custom",
            created_at: new Date().toISOString()
          }]
        };
      }
      if (sql.includes("UPDATE users")) {
        return {
          rowCount: 1,
          rows: [{ id: 1, role: "operator", new_hash_length: 60 }]
        };
      }
      if (sql.includes("COMMIT")) return {};
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const dummyHash = "$2b$12$e8rO2o6tVbT3N.r1F4hG4e5m8qKz3a9p0l1o2i3u4y5t6r7e8w9q0";
  const result = await executeResetTransaction(mockClient, dummyHash, TARGET_EMAIL, () => {});

  assert.equal(result.status, "COMMITTED");
  assert.equal(result.result.id, 1);
  assert.equal(result.result.role, "operator");
  assert.equal(result.result.new_hash_length, 60);

  // Verify full transaction lifecycle executed
  assert.ok(queryLog.some(q => q.sql.includes("BEGIN;")));
  assert.ok(queryLog.some(q => q.sql.includes("SELECT") && q.params[0] === TARGET_EMAIL));
  assert.ok(queryLog.some(q => q.sql.includes("UPDATE") && q.params[0] === dummyHash));
  assert.ok(queryLog.some(q => q.sql.includes("COMMIT;")));
});

test("executeResetTransaction rolls back when target account is not found", async () => {
  let rolledBack = false;
  const mockClient = {
    query: async (sql) => {
      if (sql.includes("BEGIN")) return {};
      if (sql.includes("FOR UPDATE")) return { rows: [] };
      if (sql.includes("ROLLBACK")) {
        rolledBack = true;
        return {};
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const result = await executeResetTransaction(mockClient, "dummyHash", TARGET_EMAIL, () => {});
  assert.equal(result.status, "ABORTED");
  assert.match(result.error.message, /No account found matching 'demo@evolve.com'/);
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackSucceeded, true);
  assert.equal(rolledBack, true);
});

test("executeResetTransaction rolls back when multiple accounts match (ambiguity guard)", async () => {
  let rolledBack = false;
  const mockClient = {
    query: async (sql) => {
      if (sql.includes("BEGIN")) return {};
      if (sql.includes("FOR UPDATE")) return { rows: [{ id: 1 }, { id: 2 }] };
      if (sql.includes("ROLLBACK")) {
        rolledBack = true;
        return {};
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const result = await executeResetTransaction(mockClient, "dummyHash", TARGET_EMAIL, () => {});
  assert.equal(result.status, "ABORTED");
  assert.match(result.error.message, /Ambiguous state: 2 accounts found/);
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackSucceeded, true);
  assert.equal(rolledBack, true);
});

test("executeResetTransaction rolls back when UPDATE affects 0 rows", async () => {
  let rolledBack = false;
  const mockClient = {
    query: async (sql) => {
      if (sql.includes("BEGIN")) return {};
      if (sql.includes("FOR UPDATE")) return { rows: [{ id: 1, role: "operator" }] };
      if (sql.includes("UPDATE users")) return { rowCount: 0, rows: [] };
      if (sql.includes("ROLLBACK")) {
        rolledBack = true;
        return {};
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const result = await executeResetTransaction(mockClient, "dummyHash", TARGET_EMAIL, () => {});
  assert.equal(result.status, "ABORTED");
  assert.match(result.error.message, /UPDATE affected 0 rows instead of exactly 1/);
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackSucceeded, true);
  assert.equal(rolledBack, true);
});

test("executeResetTransaction handles ROLLBACK error safely without throwing unhandled exception", async () => {
  const mockClient = {
    query: async (sql) => {
      if (sql.includes("BEGIN")) return {};
      if (sql.includes("FOR UPDATE")) return { rows: [] }; // trigger abort
      if (sql.includes("ROLLBACK")) {
        throw new Error("Connection terminated during rollback");
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const result = await executeResetTransaction(mockClient, "dummyHash", TARGET_EMAIL, () => {});
  assert.equal(result.status, "ABORTED");
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackSucceeded, false);
  assert.match(result.rollbackError.message, /Connection terminated during rollback/);
});

test("executeResetTransaction handles uncertain COMMIT outcome and forbids assuming rollback", async () => {
  let rollbackAttempted = false;
  const mockClient = {
    query: async (sql) => {
      if (sql.includes("BEGIN")) return {};
      if (sql.includes("FOR UPDATE")) return { rows: [{ id: 1, role: "operator", format_classification: "custom" }] };
      if (sql.includes("UPDATE users")) return { rowCount: 1, rows: [{ id: 1, role: "operator", new_hash_length: 60 }] };
      if (sql.includes("COMMIT")) {
        // Simulate transcontinental network timeout or connection reset during COMMIT packet
        const netErr = new Error("Connection dropped: ETIMEDOUT during COMMIT to ep-neon.aws.neon.tech");
        throw netErr;
      }
      if (sql.includes("ROLLBACK")) {
        rollbackAttempted = true;
        return {};
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const result = await executeResetTransaction(mockClient, "dummyHash", TARGET_EMAIL, () => {});

  assert.equal(result.status, "UNCERTAIN_COMMIT");
  assert.equal(result.commitAttempted, true);
  assert.equal(result.commitSucceeded, false);
  assert.match(result.error.message, /ETIMEDOUT during COMMIT/);
  assert.equal(rollbackAttempted, false, "Must NEVER issue a rollback when COMMIT state is in-doubt");
});

test("executeResetTransaction handles failure at BEGIN without attempting rollback", async () => {
  let rollbackAttempted = false;
  const mockClient = {
    query: async (sql) => {
      if (sql.includes("BEGIN")) {
        throw new Error("Connection refused: database server starting up");
      }
      if (sql.includes("ROLLBACK")) {
        rollbackAttempted = true;
        return {};
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const result = await executeResetTransaction(mockClient, "dummyHash", TARGET_EMAIL, () => {});
  assert.equal(result.status, "ABORTED");
  assert.match(result.error.message, /Connection refused/);
  assert.equal(result.rollbackAttempted, false, "Cannot issue rollback if BEGIN itself failed");
  assert.equal(rollbackAttempted, false);
});

test("sanitizeError handles mixed-case, quoted, and bracketed connection parameters without leaking secrets", () => {
  const mixedAndQuoted = `
    "Password"="SecretPass1!"
    'pwd'='SecretPass2!'
    [Password]="SecretPass3!"
    "User Id"="MyAdminUser"
    'username'='SecretUser'
  `;
  const sanitized = sanitizeError(mixedAndQuoted);
  assert.ok(!sanitized.includes("SecretPass1!"));
  assert.ok(!sanitized.includes("SecretPass2!"));
  assert.ok(!sanitized.includes("SecretPass3!"));
  assert.ok(!sanitized.includes("MyAdminUser"));
  assert.ok(!sanitized.includes("SecretUser"));
});

test("sanitizeError is idempotent under nested sanitization and never reintroduces secrets", () => {
  const complexError = "Failed: postgresql://admin_user:secret_pass_123@db.neon.tech/neondb?password=another_secret&token=tok_456 with Bearer eyJhbGciOi";
  const pass1 = sanitizeError(complexError);
  const pass2 = sanitizeError(pass1);
  const pass3 = sanitizeError(pass2);

  assert.equal(pass1, pass2);
  assert.equal(pass2, pass3);
  assert.ok(!pass1.includes("admin_user"));
  assert.ok(!pass1.includes("secret_pass_123"));
  assert.ok(!pass1.includes("another_secret"));
  assert.ok(!pass1.includes("tok_456"));
  assert.ok(!pass1.includes("eyJhbGciOi"));
});
