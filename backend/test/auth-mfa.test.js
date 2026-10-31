const test = require("node:test");
const assert = require("node:assert/strict");
const {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateOtpAuthUrl,
  signToken,
  verifyToken,
  authenticateToken,
  authorizeRoles,
  resolveTokenSecret
} = require("../auth");

test("Base32 encode and decode handles binary data accurately", () => {
  const original = Buffer.from("Hello EVolve 2026! Authentication test.", "utf8");
  const encoded = base32Encode(original);
  assert.match(encoded, /^[A-Z2-7]+$/);

  const decoded = base32Decode(encoded);
  assert.equal(decoded.toString("utf8"), original.toString("utf8"));
});

test("generateTotpSecret returns valid 32-character Base32 string", () => {
  const secret = generateTotpSecret(20);
  assert.equal(secret.length, 32);
  assert.match(secret, /^[A-Z2-7]{32}$/);
});

test("generateTotpCode generates 6-digit numeric TOTP code", () => {
  const secret = generateTotpSecret();
  const code = generateTotpCode(secret);
  assert.equal(code.length, 6);
  assert.match(code, /^\d{6}$/);
});

test("verifyTotpCode validates matching code and tolerates +-1 step clock drift", () => {
  const secret = generateTotpSecret();
  const now = Date.now();

  // Current step code
  const currentCode = generateTotpCode(secret, now);
  assert.equal(verifyTotpCode(currentCode, secret, { timeMs: now }), true);

  // Past step (-30s) code
  const pastCode = generateTotpCode(secret, now - 30000);
  assert.equal(verifyTotpCode(pastCode, secret, { timeMs: now }), true);

  // Future step (+30s) code
  const futureCode = generateTotpCode(secret, now + 30000);
  assert.equal(verifyTotpCode(futureCode, secret, { timeMs: now }), true);

  // Distant past (-90s) code must be rejected with window=1
  const distantPastCode = generateTotpCode(secret, now - 90000);
  assert.equal(verifyTotpCode(distantPastCode, secret, { timeMs: now }), false);

  // Invalid code rejected
  assert.equal(verifyTotpCode("000000", secret, { timeMs: now }) && currentCode !== "000000", false);
  assert.equal(verifyTotpCode("abc123", secret, { timeMs: now }), false);
  assert.equal(verifyTotpCode("", secret, { timeMs: now }), false);
});

test("generateOtpAuthUrl generates valid URI for authenticator apps", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const url = generateOtpAuthUrl({ email: "demo@evolve.com", secret, issuer: "EVolve" });
  assert.ok(url.startsWith("otpauth://totp/EVolve:demo%40evolve.com"));
  assert.ok(url.includes(`secret=${secret}`));
  assert.ok(url.includes("issuer=EVolve"));
  assert.ok(url.includes("algorithm=SHA1"));
  assert.ok(url.includes("digits=6"));
  assert.ok(url.includes("period=30"));
});

test("signToken and verifyToken manage signed session tokens securely", () => {
  const payload = { userId: 42, email: "operator@evolve.com", role: "operator", mfaVerified: true };
  const token = signToken(payload);
  assert.equal(typeof token, "string");
  assert.equal(token.split(".").length, 3);

  const verified = verifyToken(token);
  assert.ok(verified);
  assert.equal(verified.userId, 42);
  assert.equal(verified.email, "operator@evolve.com");
  assert.equal(verified.role, "operator");
  assert.equal(verified.mfaVerified, true);
  assert.ok(verified.exp > Date.now());
});

test("verifyToken rejects tampered signatures and expired tokens", () => {
  const payload = { userId: 1, role: "operator" };
  const token = signToken(payload);

  // Tamper with payload part
  const parts = token.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ userId: 1, role: "admin" })).toString("base64url");
  const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
  assert.equal(verifyToken(tamperedToken), null);

  // Expired token
  const expiredToken = signToken(payload, undefined, -1000); // expired 1s ago
  assert.equal(verifyToken(expiredToken), null);
});

test("authenticateToken middleware enforces valid session and blocks unverified MFA", () => {
  const authMiddleware = authenticateToken();

  // Test missing auth header
  let statusResult = null;
  let jsonResult = null;
  const mockRes = () => ({
    status: (s) => {
      statusResult = s;
      return { json: (j) => { jsonResult = j; } };
    }
  });

  authMiddleware({ headers: {} }, mockRes(), () => assert.fail("Should not call next"));
  assert.equal(statusResult, 401);
  assert.match(jsonResult.message, /missing or malformed Bearer token/);

  // Test token with pending MFA
  const pendingMfaToken = signToken({ userId: 1, role: "operator", mfaRequired: true, mfaVerified: false });
  authMiddleware({ headers: { authorization: `Bearer ${pendingMfaToken}` } }, mockRes(), () => assert.fail("Should not call next"));
  assert.equal(statusResult, 401);
  assert.match(jsonResult.message, /Multi-factor authentication.*required/);

  // Test valid verified token
  const validToken = signToken({ userId: 1, role: "operator", mfaVerified: true });
  let nextCalled = false;
  const req = { headers: { authorization: `Bearer ${validToken}` } };
  authMiddleware(req, mockRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.userId, 1);
  assert.equal(req.user.role, "operator");
});

test("authorizeRoles middleware enforces domain roles and rejects insufficient permissions with 403", () => {
  const operatorOnly = authorizeRoles("operator", "admin");

  let statusResult = null;
  let jsonResult = null;
  const mockRes = () => ({
    status: (s) => {
      statusResult = s;
      return { json: (j) => { jsonResult = j; } };
    }
  });

  // Role 'user' attempting operator-only operation
  operatorOnly({ user: { userId: 5, role: "user" } }, mockRes(), () => assert.fail("Should not call next"));
  assert.equal(statusResult, 403);
  assert.match(jsonResult.message, /insufficient permissions/);

  // Role 'operator' permitted
  let nextCalled = false;
  operatorOnly({ user: { userId: 5, role: "operator" } }, mockRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("resolveTokenSecret refuses hardcoded fallback in production environment", () => {
  const origEnv = process.env.NODE_ENV;
  const origSecret = process.env.JWT_SECRET;
  const origSession = process.env.SESSION_SECRET;

  try {
    delete process.env.JWT_SECRET;
    delete process.env.SESSION_SECRET;
    process.env.NODE_ENV = "production";

    assert.throws(
      () => resolveTokenSecret(),
      /FATAL: JWT_SECRET or SESSION_SECRET must be configured in production/
    );

    // When secret is provided in production, it succeeds
    process.env.JWT_SECRET = "production_super_secret_key_12345";
    assert.equal(resolveTokenSecret(), "production_super_secret_key_12345");
  } finally {
    process.env.NODE_ENV = origEnv;
    if (origSecret !== undefined) process.env.JWT_SECRET = origSecret; else delete process.env.JWT_SECRET;
    if (origSession !== undefined) process.env.SESSION_SECRET = origSession; else delete process.env.SESSION_SECRET;
  }
});

test("verifyToken enforces required claims: rejects tokens without exp or iat", () => {
  const secret = "test-secret";
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

  // Missing exp
  const payloadNoExp = Buffer.from(JSON.stringify({ userId: 1, iat: Date.now() })).toString("base64url");
  const data1 = `${header}.${payloadNoExp}`;
  const sig1 = require("node:crypto").createHmac("sha256", secret).update(data1).digest("base64url");
  assert.equal(verifyToken(`${data1}.${sig1}`, secret), null);

  // Missing iat
  const payloadNoIat = Buffer.from(JSON.stringify({ userId: 1, exp: Date.now() + 10000 })).toString("base64url");
  const data2 = `${header}.${payloadNoIat}`;
  const sig2 = require("node:crypto").createHmac("sha256", secret).update(data2).digest("base64url");
  assert.equal(verifyToken(`${data2}.${sig2}`, secret), null);
});
