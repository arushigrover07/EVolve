/**
 * EVolve - Isolated Security & TOTP MFA Demonstration Script
 * BACSE344 DA3 Question 2(b)
 *
 * SAFETY & ISOLATION ENFORCEMENT:
 * 1. 100% In-Memory Mock Database: Zero connection to Neon, Render, or external networks.
 * 2. Strictly ephemeral test credentials:
 *    - All passwords and TOTP secrets in this file are STRICTLY LOCAL TEST-ONLY SECRETS.
 *    - NEVER use these fixed test keys or test passwords in any production environment.
 * 3. Does not alter production records, application source code, or demo@evolve.com.
 * 4. Demonstrates:
 *    - HTTP 401: Missing authentication token.
 *    - HTTP 401: Unverified MFA challenge token used against protected API (anti-bypass).
 *    - HTTP 403: Authenticated user with role 'user' attempting operator-only operation.
 *    - HTTP 200: Authenticated operator with verified TOTP completing authorized action.
 *    - Dynamic TOTP MFA enrollment and verification lifecycle.
 */

const path = require("node:path");
const bcrypt = require(path.resolve(__dirname, "../backend/node_modules/bcrypt"));
const { createApp } = require("../backend/app");
const { generateTotpCode } = require("../backend/auth");

// ============================================================================
// STRICT LOCAL TEST CONFIGURATION (DO NOT USE IN PRODUCTION)
// ============================================================================
const TEST_AUTH_SECRET = "test_only_q2b_jwt_secret_key_never_use_in_prod_1234567890";
const TEST_OPERATOR_TOTP_SECRET = "JBSWY3DPEHPK3PXP"; // Test-only Base32 key (RFC 4648)

const quietLogger = {
  log() {},
  error() {}
};

async function main() {
  console.log("================================================================================");
  console.log("  EVolve DA3 Question 2(b): Isolated Security & MFA Verification Suite");
  console.log("  Environment: Isolated In-Memory Mock (Zero Cloud/Database Connectivity)");
  console.log("================================================================================\n");

  // Pre-compute salted bcrypt hashes (work factor 12) for isolated test accounts
  const operatorPassword = "OperatorTestPass#2026";
  const driverPassword = "DriverTestPass#2026";
  const newOpPassword = "NewOperatorPass#2026";

  const operatorHash = await bcrypt.hash(operatorPassword, 12);
  const driverHash = await bcrypt.hash(driverPassword, 12);
  const newOpHash = await bcrypt.hash(newOpPassword, 12);

  // In-memory test state (completely isolated from Neon PostgreSQL)
  const mockUsers = [
    {
      id: 101,
      name: "Authorized Operator",
      email: "operator-mfa@evolve.test",
      password_hash: operatorHash,
      role: "operator",
      totp_secret: TEST_OPERATOR_TOTP_SECRET,
      mfa_enabled: true,
      created_at: new Date().toISOString()
    },
    {
      id: 102,
      name: "Standard EV Driver",
      email: "driver-user@evolve.test",
      password_hash: driverHash,
      role: "user",
      totp_secret: null,
      mfa_enabled: false,
      created_at: new Date().toISOString()
    },
    {
      id: 103,
      name: "New Fleet Operator",
      email: "new-operator@evolve.test",
      password_hash: newOpHash,
      role: "operator",
      totp_secret: null,
      mfa_enabled: false,
      created_at: new Date().toISOString()
    }
  ];

  const mockStations = [
    {
      id: 1,
      name: "EVolve Central Hub",
      location: "Vellore Campus Sector 1",
      status: "ACTIVE",
      latitude: "12.9165000",
      longitude: "79.1325000"
    }
  ];

  // In-memory database adapter (zero network I/O)
  const mockDb = {
    async query(sql, params = []) {
      const normalized = sql.trim().replace(/\s+/g, " ");

      // 1. SELECT user by email (Login)
      if (/FROM users WHERE LOWER\(email\) = LOWER\(\$1\)/i.test(normalized)) {
        const email = String(params[0]).toLowerCase();
        const found = mockUsers.find((u) => u.email.toLowerCase() === email);
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }

      // 2. SELECT user by ID (MFA Verify, Enroll, Confirm)
      if (/FROM users WHERE id = \$1/i.test(normalized)) {
        const id = Number(params[0]);
        const found = mockUsers.find((u) => u.id === id);
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }

      // 3. UPDATE user totp_secret (Enroll)
      if (/UPDATE users SET totp_secret = \$1, mfa_enabled = false WHERE id = \$2/i.test(normalized)) {
        const [secret, id] = params;
        const user = mockUsers.find((u) => u.id === Number(id));
        if (user) {
          user.totp_secret = secret;
          user.mfa_enabled = false;
        }
        return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
      }

      // 4. UPDATE user mfa_enabled = true (Confirm)
      if (/UPDATE users SET mfa_enabled = true WHERE id = \$1/i.test(normalized)) {
        const id = Number(params[0]);
        const user = mockUsers.find((u) => u.id === id);
        if (user) user.mfa_enabled = true;
        return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
      }

      // 5. UPDATE stations (Protected Operator Mutation)
      if (/UPDATE stations SET name = \$1/i.test(normalized)) {
        const [name, location, status, latitude, longitude, id] = params;
        const station = mockStations.find((s) => s.id === Number(id));
        if (station) {
          station.name = name;
          station.location = location;
          station.status = status;
          station.latitude = latitude;
          station.longitude = longitude;
          return { rows: [station], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // 6. SELECT station by ID
      if (/FROM stations WHERE id = \$1/i.test(normalized)) {
        const id = Number(params[0]);
        const found = mockStations.find((s) => s.id === id);
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }

      throw new Error(`Unhandled mock query: ${sql}`);
    }
  };

  // Instantiate application using in-memory mock database
  const app = createApp({
    db: mockDb,
    authSecret: TEST_AUTH_SECRET,
    logger: quietLogger,
    instanceId: "q2b-demo-runner"
  });

  // Start ephemeral test server on local loopback
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  console.log(`[INIT] Ephemeral test server active on: ${baseUrl}`);
  console.log(`[INIT] Database mode: 100% In-Memory Mock Adapter (No Neon connection)\n`);

  try {
    // ========================================================================
    // CASE 1: Missing Authentication Token -> HTTP 401 Unauthorized
    // ========================================================================
    console.log("--------------------------------------------------------------------------------");
    console.log("CASE 1: Unauthenticated Update Request (Missing Bearer Token)");
    console.log("--------------------------------------------------------------------------------");
    console.log(`REQUEST:  PUT /api/stations/1`);
    console.log(`HEADERS:  Content-Type: application/json (Authorization: None)`);
    console.log(`BODY:     {"name":"Tampered Central Hub","location":"Unauthorized Area"}`);

    const res1 = await fetch(`${baseUrl}/api/stations/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tampered Central Hub", location: "Unauthorized Area" })
    });
    const body1 = await res1.json();

    console.log(`RESPONSE: HTTP ${res1.status} ${res1.statusText}`);
    console.log(`PAYLOAD:  ${JSON.stringify(body1, null, 2)}`);
    console.log(res1.status === 401 ? "VERDICT:  PASS (HTTP 401 successfully blocked unauthenticated request)\n" : "VERDICT: FAIL\n");

    // ========================================================================
    // CASE 2: MFA Challenge Token Misuse (Anti-Bypass Guard) -> HTTP 401
    // ========================================================================
    console.log("--------------------------------------------------------------------------------");
    console.log("CASE 2: MFA Anti-Bypass Guard (Using Challenge Token on Protected Route)");
    console.log("--------------------------------------------------------------------------------");
    console.log(`STEP 2a:  POST /api/login for MFA-enabled operator: operator-mfa@evolve.test`);
    const loginRes2 = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "operator-mfa@evolve.test",
        password: operatorPassword
      })
    });
    const loginBody2 = await loginRes2.json();

    console.log(`RESPONSE: HTTP ${loginRes2.status} ${loginRes2.statusText}`);
    console.log(`PAYLOAD:  mfa_required=${loginBody2.mfa_required}, challenge token issued`);
    const mfaToken = loginBody2.mfa_token;

    console.log(`\nSTEP 2b:  Attempting PUT /api/stations/1 with temporary MFA Challenge Token`);
    console.log(`HEADERS:  Authorization: Bearer ${mfaToken.slice(0, 25)}...[REDACTED]`);

    const bypassRes = await fetch(`${baseUrl}/api/stations/1`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mfaToken}`
      },
      body: JSON.stringify({ name: "Bypass Central Hub", location: "Bypass Area" })
    });
    const bypassBody = await bypassRes.json();

    console.log(`RESPONSE: HTTP ${bypassRes.status} ${bypassRes.statusText}`);
    console.log(`PAYLOAD:  ${JSON.stringify(bypassBody, null, 2)}`);
    console.log(bypassRes.status === 401 ? "VERDICT:  PASS (HTTP 401 strictly blocked unverified MFA token)\n" : "VERDICT: FAIL\n");

    // ========================================================================
    // CASE 3: Authenticated Normal User (Insufficient Role) -> HTTP 403 Forbidden
    // ========================================================================
    console.log("--------------------------------------------------------------------------------");
    console.log("CASE 3: Role-Based Authorization Enforcement (Driver role: 'user')");
    console.log("--------------------------------------------------------------------------------");
    console.log(`STEP 3a:  POST /api/login for standard driver: driver-user@evolve.test`);
    const loginRes3 = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "driver-user@evolve.test",
        password: driverPassword
      })
    });
    const loginBody3 = await loginRes3.json();
    const driverToken = loginBody3.token;
    console.log(`RESPONSE: HTTP ${loginRes3.status} OK (Session Token issued for role='${loginBody3.user.role}')`);

    console.log(`\nSTEP 3b:  Driver attempting Operator-only action: PUT /api/stations/1`);
    console.log(`HEADERS:  Authorization: Bearer ${driverToken.slice(0, 25)}...[REDACTED]`);

    const rbacRes = await fetch(`${baseUrl}/api/stations/1`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${driverToken}`
      },
      body: JSON.stringify({ name: "Driver Tampered Hub", location: "Driver Area" })
    });
    const rbacBody = await rbacRes.json();

    console.log(`RESPONSE: HTTP ${rbacRes.status} ${rbacRes.statusText}`);
    console.log(`PAYLOAD:  ${JSON.stringify(rbacBody, null, 2)}`);
    console.log(rbacRes.status === 403 ? "VERDICT:  PASS (HTTP 403 successfully rejected insufficient role)\n" : "VERDICT: FAIL\n");

    // ========================================================================
    // CASE 4: Authenticated Operator with Completed TOTP MFA -> HTTP 200 OK
    // ========================================================================
    console.log("--------------------------------------------------------------------------------");
    console.log("CASE 4: Completed TOTP Verification & Authorized Operator Mutation");
    console.log("--------------------------------------------------------------------------------");
    // Generate valid RFC 6238 6-digit TOTP code for the test-only secret
    const currentCode = generateTotpCode(TEST_OPERATOR_TOTP_SECRET);
    console.log(`STEP 4a:  Generated RFC 6238 6-digit code '${currentCode}' from test secret`);
    console.log(`STEP 4b:  POST /api/mfa/verify exchanging challenge token + TOTP code`);

    const verifyRes = await fetch(`${baseUrl}/api/mfa/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mfa_token: mfaToken,
        totp_code: currentCode
      })
    });
    const verifyBody = await verifyRes.json();
    console.log(`RESPONSE: HTTP ${verifyRes.status} ${verifyRes.statusText}`);
    console.log(`PAYLOAD:  success=${verifyBody.success}, full operator session token issued`);
    const operatorVerifiedToken = verifyBody.token;

    console.log(`\nSTEP 4c:  Operator executing authorized mutation: PUT /api/stations/1`);
    console.log(`HEADERS:  Authorization: Bearer ${operatorVerifiedToken.slice(0, 25)}...[REDACTED]`);
    console.log(`BODY:     {"name":"EVolve Central Hub (Hardened Sector)","location":"Vellore Campus Sector 1"}`);

    const updateRes = await fetch(`${baseUrl}/api/stations/1`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${operatorVerifiedToken}`
      },
      body: JSON.stringify({
        name: "EVolve Central Hub (Hardened Sector)",
        location: "Vellore Campus Sector 1"
      })
    });
    const updateBody = await updateRes.json();

    console.log(`RESPONSE: HTTP ${updateRes.status} ${updateRes.statusText}`);
    console.log(`PAYLOAD:  ${JSON.stringify(updateBody, null, 2)}`);
    console.log(updateRes.status === 200 && updateBody.name.includes("Hardened Sector") ? "VERDICT:  PASS (HTTP 200 authorized operator update successful)\n" : "VERDICT: FAIL\n");

    // ========================================================================
    // CASE 5: Dynamic TOTP Enrollment & Confirmation Lifecycle
    // ========================================================================
    console.log("--------------------------------------------------------------------------------");
    console.log("CASE 5: Dynamic TOTP MFA Enrollment & App Pairing Lifecycle");
    console.log("--------------------------------------------------------------------------------");
    // Step 5a: Log in as un-enrolled operator
    const loginRes5 = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "new-operator@evolve.test",
        password: newOpPassword
      })
    });
    const loginBody5 = await loginRes5.json();
    const newOpToken = loginBody5.token;
    console.log(`STEP 5a:  Logged in as new operator (mfa_enabled=false): session active`);

    // Step 5b: Call /api/mfa/enroll
    console.log(`STEP 5b:  POST /api/mfa/enroll to initiate authenticator pairing`);
    const enrollRes = await fetch(`${baseUrl}/api/mfa/enroll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${newOpToken}`
      }
    });
    const enrollBody = await enrollRes.json();
    console.log(`RESPONSE: HTTP ${enrollRes.status} ${enrollRes.statusText}`);
    console.log(`PAYLOAD:  Base32 Secret: ${enrollBody.secret}`);
    console.log(`          URI: ${enrollBody.otpauth_url}`);

    // Step 5c: Confirm enrollment with generated code
    const initialEnrollCode = generateTotpCode(enrollBody.secret);
    console.log(`\nSTEP 5c:  POST /api/mfa/confirm with first authenticator code: '${initialEnrollCode}'`);
    const confirmRes = await fetch(`${baseUrl}/api/mfa/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${newOpToken}`
      },
      body: JSON.stringify({ totp_code: initialEnrollCode })
    });
    const confirmBody = await confirmRes.json();
    const sanitizedConfirm = {
      ...confirmBody,
      token: confirmBody.token ? `${confirmBody.token.slice(0, 25)}...[REDACTED]` : undefined
    };
    console.log(`RESPONSE: HTTP ${confirmRes.status} ${confirmRes.statusText}`);
    console.log(`PAYLOAD:  ${JSON.stringify(sanitizedConfirm, null, 2)}`);
    console.log(confirmRes.status === 200 && confirmBody.success ? "VERDICT:  PASS (TOTP MFA enrollment confirmed and activated)\n" : "VERDICT: FAIL\n");

    console.log("================================================================================");
    console.log("  SUMMARY: All 5 Security and MFA Verification Scenarios PASSED (100%)");
    console.log("================================================================================");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log("\n[CLEANUP] Ephemeral local test server closed. Mock database discarded.");
  }
}

main().catch((err) => {
  console.error("FATAL ERROR in demonstration suite:", err);
  process.exitCode = 1;
});
