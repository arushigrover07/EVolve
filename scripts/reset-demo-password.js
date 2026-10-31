/**
 * EVolve - Controlled Demo Account Password Reset Script
 *
 * BACSE344 DA3 Question 2(a)
 *
 * STRICT SAFEGUARDS ENFORCED:
 * 1. Collects and validates password and computes bcrypt hash BEFORE opening the database transaction,
 *    preventing locks from being held during interactive prompt input.
 * 2. Strictly targets ONLY LOWER(email) = LOWER('demo@evolve.com').
 * 3. Interactive, non-echoing password entry required; no environment variable or CLI flag input path.
 * 4. Enforces >= 12 character length, rejects 'demo123', rejects confirmation mismatch, preserves exact characters (no silent trim).
 * 5. Computes salted bcrypt hash with work factor 12 ($2b$12$).
 * 6. Declares and initializes database module before entering the main try block, with safe non-masking cleanup.
 * 7. Opens transaction (BEGIN) and acquires exclusive row lock via parameterized SELECT ... FOR UPDATE.
 * 8. Verifies exactly 1 matching account exists before updating.
 * 9. Executes parameterized UPDATE and asserts rowCount === 1.
 * 10. Explicitly tracks whether COMMIT was attempted: if COMMIT fails or connection drops during COMMIT,
 *     marks the state as UNCERTAIN/IN-DOUBT and forbids assuming it was rolled back.
 * 11. Sanitizes all error messages to guarantee database credentials, connection strings, query parameters,
 *     and bearer tokens are never exposed in logs or console output.
 * 12. Reports only safe metadata (ID, role, hash length, format classification); never prints passwords or hashes.
 */

const path = require("node:path");
const fs = require("node:fs");
const readline = require("node:readline");
const { Writable } = require("node:stream");
const bcrypt = require(path.resolve(__dirname, "../backend/node_modules/bcrypt"));

const TARGET_EMAIL = "demo@evolve.com";
const BCRYPT_SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 12;

const PRE_CHECK_SQL = `
  SELECT
    id,
    name,
    email,
    role,
    LENGTH(password_hash) AS hash_length,
    CASE
      WHEN password_hash LIKE '$2b$%' THEN 'bcrypt-2b'
      WHEN password_hash LIKE '$2a$%' THEN 'bcrypt-2a'
      WHEN password_hash LIKE '$argon2%' THEN 'argon2'
      WHEN password_hash LIKE 'demo_%' THEN 'demo-prefix-placeholder'
      WHEN password_hash IS NULL THEN 'null'
      ELSE 'plaintext-or-custom'
    END AS format_classification,
    created_at
  FROM users
  WHERE LOWER(email) = LOWER($1)
  FOR UPDATE;
`;

const UPDATE_SQL = `
  UPDATE users
  SET password_hash = $1
  WHERE id = $2 AND LOWER(email) = LOWER($3)
  RETURNING id, role, LENGTH(password_hash) AS new_hash_length;
`;

// Sanitize errors so connection strings, passwords, or credentials cannot leak into logs
function sanitizeError(err) {
  if (!err) return "Unknown error";
  let msg = typeof err === "string" ? err : (err.message || String(err));

  // 1. Redact URIs with embedded credentials (e.g. postgres://user:pass@host/db or http://user:pass@host)
  msg = msg.replace(/(?:[a-zA-Z][a-zA-Z0-9+.-]*):\/\/[^\s/@]+@[^\s"'<>]+/gi, "[REDACTED_URI]");

  // 2. Redact remaining raw PostgreSQL connection URLs (e.g. postgres://host/db or postgresql://...)
  msg = msg.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[REDACTED_DATABASE_URL]");

  // 3. Redact key-value credentials in connection strings (libpq, ODBC, ADO.NET, etc.)
  // Handles plain, mixed-case, and quoted keys (e.g. password=..., "Password"=..., [pwd]=..., 'secret'=...)
  msg = msg.replace(/(?:["'\[]?)\b(password|pwd|secret|token|api_?key|auth_?token)\b(?:["'\]]?)\s*=\s*(?:'[^']*'|"[^"]*"|[^\s"';&]+)/gi, "$1=[REDACTED]");
  msg = msg.replace(/(?:["'\[]?)\b(user\s*id|uid|user|username)\b(?:["'\]]?)\s*=\s*(?:'[^']*'|"[^"]*"|[^\s"';&]+)/gi, "$1=[REDACTED]");

  // 4. Redact query-string secrets (e.g. ?token=..., &password=..., ?secret=..., ?apiKey=...)
  msg = msg.replace(/([?&](?:password|pwd|secret|token|apiKey|api_key|auth|access_token)=)[^&\s]+/gi, "$1[REDACTED]");

  // 5. Redact HTTP Authorization tokens (Bearer, Basic)
  msg = msg.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
  msg = msg.replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]");

  return msg;
}

// Password validation rules
function validatePassword(pass1, pass2) {
  if (!pass1) {
    throw new Error("Password cannot be empty.");
  }
  if (pass1.toLowerCase() === "demo123" || pass1.toLowerCase().includes("demo123")) {
    throw new Error("Insecure password rejected: 'demo123' cannot be reused. Choose a strong, distinct password.");
  }
  if (pass1.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long (received ${pass1.length}).`);
  }
  if (pass1 !== pass2) {
    throw new Error("Passwords do not match.");
  }
  return true;
}

// Load DATABASE_URL from backend/.env into process memory if not already present
function loadEnvSafe() {
  if (process.env.DATABASE_URL) return;
  const envPath = path.resolve(__dirname, "../backend/.env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// Non-echoing terminal prompt for secure password entry
function promptPasswordHidden(query) {
  return new Promise((resolve) => {
    let muted = false;
    const mutableStdout = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) process.stdout.write(chunk, encoding);
        callback();
      }
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true
    });

    process.stdout.write(query);
    muted = true;

    rl.question("", (answer) => {
      muted = false;
      process.stdout.write("\n");
      rl.close();
      // Exact string returned; do NOT trim whitespace
      resolve(answer);
    });
  });
}

async function getSecurePassword() {
  const pass1 = await promptPasswordHidden("Enter new password for demo@evolve.com (min 12 chars): ");
  const pass2 = await promptPasswordHidden("Confirm new password: ");
  validatePassword(pass1, pass2);
  return pass1;
}

/**
 * Executes the database transaction to update the target account's password.
 * Tracks transaction state, ensures SELECT ... FOR UPDATE, enforces rowCount === 1,
 * and explicitly distinguishes between clean rollbacks and in-doubt/uncertain COMMIT outcomes.
 */
async function executeResetTransaction(client, newHash, targetEmail = TARGET_EMAIL, log = console.log) {
  let inTransaction = false;
  let commitAttempted = false;
  let commitSucceeded = false;
  let preCheckUser = null;
  let updateResult = null;

  try {
    log("- Transaction started (BEGIN).");
    await client.query("BEGIN;");
    inTransaction = true;

    const preCheck = await client.query(PRE_CHECK_SQL, [targetEmail]);
    if (!preCheck || !preCheck.rows || preCheck.rows.length === 0) {
      throw new Error(`ABORT: No account found matching '${targetEmail}'.`);
    }
    if (preCheck.rows.length > 1) {
      throw new Error(`ABORT: Ambiguous state: ${preCheck.rows.length} accounts found matching '${targetEmail}'.`);
    }

    preCheckUser = preCheck.rows[0];
    log("- Exclusive row lock acquired (FOR UPDATE).");
    log(`- Account ID: ${preCheckUser.id}`);
    log(`- Role: ${preCheckUser.role}`);
    log(`- Current Storage Format: ${preCheckUser.format_classification}`);
    log(`- Current Stored Field Length: ${preCheckUser.hash_length} characters`);
    log(`- Created At: ${preCheckUser.created_at}`);

    log("\n[Stage 4: Parameterized Row Mutation]");
    updateResult = await client.query(UPDATE_SQL, [newHash, preCheckUser.id, targetEmail]);

    if (!updateResult || updateResult.rowCount !== 1) {
      const count = updateResult ? updateResult.rowCount : 0;
      throw new Error(`ABORT: UPDATE affected ${count} rows instead of exactly 1.`);
    }

    log("\n[Stage 5: Transaction Finalization]");
    commitAttempted = true;
    await client.query("COMMIT;");
    commitSucceeded = true;
    inTransaction = false;
    log("- Transaction committed successfully (COMMIT).");

    return {
      status: "COMMITTED",
      user: preCheckUser,
      result: updateResult.rows[0]
    };
  } catch (err) {
    if (inTransaction) {
      if (commitAttempted && !commitSucceeded) {
        return {
          status: "UNCERTAIN_COMMIT",
          error: err,
          commitAttempted: true,
          commitSucceeded: false
        };
      }

      let rollbackSucceeded = false;
      let rollbackError = null;
      try {
        await client.query("ROLLBACK;");
        rollbackSucceeded = true;
      } catch (rbErr) {
        rollbackError = rbErr;
      }

      return {
        status: "ABORTED",
        error: err,
        rollbackAttempted: true,
        rollbackSucceeded,
        rollbackError
      };
    }

    return {
      status: "ABORTED",
      error: err,
      rollbackAttempted: false,
      rollbackSucceeded: false,
      rollbackError: null
    };
  }
}

async function run() {
  console.log("=================================================");
  console.log("EVolve - Demo Account Password Reset (DA3 Q2a)");
  console.log("=================================================");
  console.log(`Target account: ${TARGET_EMAIL}`);

  // STAGE 1: Collect & validate credential BEFORE opening database connection or transaction
  console.log("\n[Stage 1: Interactive Credential Input & Validation]");
  let newPassword;
  try {
    newPassword = await getSecurePassword();
  } catch (inputErr) {
    console.error("\n❌ Input Error:", sanitizeError(inputErr));
    process.exitCode = 1;
    return;
  }

  // STAGE 2: Compute salted bcrypt hash BEFORE opening database transaction
  console.log("\n[Stage 2: Cryptographic Hash Generation]");
  console.log(`- Computing salted bcrypt hash with work factor (salt rounds): ${BCRYPT_SALT_ROUNDS}...`);
  const newHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
  console.log(`- Hash generated successfully.`);
  console.log(`  * Prefix: ${newHash.slice(0, 7)}`);
  console.log(`  * Length: ${newHash.length} characters`);
  console.log(`  * Format: bcrypt $2b$ work-factor 12`);

  // Clear plaintext password reference from memory
  newPassword = null;

  // STAGE 3: Declare and initialize db BEFORE entering main try block
  loadEnvSafe();
  let db = null;
  try {
    db = require(path.resolve(__dirname, "../backend/db.js"));
  } catch (dbInitErr) {
    console.error("\n❌ Database module initialization failed:", sanitizeError(dbInitErr));
    process.exitCode = 1;
    return;
  }

  // STAGE 4: Database Connection & Transaction Execution
  let client = null;

  try {
    console.log("\n[Stage 3: Database Connection & Transaction]");
    try {
      client = await db.pool.connect();
    } catch (connErr) {
      throw new Error(`Failed to acquire database connection: ${sanitizeError(connErr)}`);
    }

    const txResult = await executeResetTransaction(client, newHash, TARGET_EMAIL);

    if (txResult.status === "COMMITTED") {
      console.log("\n[Stage 6: Post-Update Confirmation]");
      console.log(`- Updated Account ID: ${txResult.result.id}`);
      console.log(`- Account Role: ${txResult.result.role}`);
      console.log(`- New Format Classification: bcrypt-2b ($2b$12$)`);
      console.log(`- New Stored Hash Length: ${txResult.result.new_hash_length} characters`);
      console.log("- Rows mutated: exactly 1");
      console.log("\nReset operation complete. Ready for login verification.");
    } else if (txResult.status === "UNCERTAIN_COMMIT") {
      console.error("\n⚠️ CRITICAL TRANSACTION STATUS: UNCERTAIN / IN-DOUBT");
      console.error("- A COMMIT command was issued, but the connection dropped or threw an error before confirmation.");
      console.error("- The transaction may have committed or aborted on the remote server.");
      console.error("- DO NOT retry or issue an unverified rollback. You MUST verify database state independently before taking further action.");
      console.error("- Underlying error:", sanitizeError(txResult.error));
      process.exitCode = 1;
    } else {
      if (txResult.rollbackSucceeded) {
        console.log("- Transaction safely rolled back (ROLLBACK).");
      } else if (txResult.rollbackAttempted) {
        console.error("- ROLLBACK attempt failed or connection was lost:", sanitizeError(txResult.rollbackError));
      }
      console.error("\n❌ OPERATION ABORTED:", sanitizeError(txResult.error));
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("\n❌ OPERATION ABORTED:", sanitizeError(err));
    process.exitCode = 1;
  } finally {
    // Safe cleanup that never masks the original error
    if (client) {
      try {
        client.release();
      } catch (releaseErr) {
        console.error("Warning: Failed to release client connection cleanly:", sanitizeError(releaseErr));
      }
    }
    if (db && db.pool && typeof db.pool.end === "function") {
      try {
        await db.pool.end();
      } catch (poolCloseErr) {
        console.error("Warning: Failed to close database pool cleanly:", sanitizeError(poolCloseErr));
      }
    }
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  run,
  TARGET_EMAIL,
  BCRYPT_SALT_ROUNDS,
  MIN_PASSWORD_LENGTH,
  PRE_CHECK_SQL,
  UPDATE_SQL,
  sanitizeError,
  validatePassword,
  loadEnvSafe,
  executeResetTransaction
};
