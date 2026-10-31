/**
 * EVolve - Authentication, TOTP MFA, and Role-Based Authorization
 *
 * BACSE344 DA3 Question 2(b)
 *
 * Features:
 * 1. RFC 6238 TOTP Multi-Factor Authentication compatible with Google Authenticator,
 *    Microsoft Authenticator, and standard authenticator apps.
 * 2. Cryptographic session token signing (HMAC-SHA256) with constant-time verification.
 * 3. Role-Based Access Control (RBAC) middleware protecting Update and Delete operations.
 * 4. Zero third-party dependencies (uses standard node:crypto).
 */

const crypto = require("node:crypto");

function resolveTokenSecret() {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("FATAL: JWT_SECRET or SESSION_SECRET must be configured in production environments");
  }
  return "evolve_da3_secure_token_secret_key_2026";
}

const TOKEN_SECRET = resolveTokenSecret();
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const MFA_TOKEN_EXPIRY_MS = 5 * 60 * 1000;    // 5 minutes for MFA challenge

// RFC 4648 Base32 alphabet
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Encodes a buffer to RFC 4648 Base32 string (without padding).
 */
function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decodes an RFC 4648 Base32 string into a Buffer.
 */
function base32Decode(base32Str) {
  const cleanStr = base32Str.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (let i = 0; i < cleanStr.length; i++) {
    const char = cleanStr[i];
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }
    value = (value << 5) | val;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generates a cryptographically random Base32 TOTP secret.
 * Default 20 bytes (160 bits) yields a 32-character Base32 string.
 */
function generateTotpSecret(byteLength = 20) {
  const buffer = crypto.randomBytes(byteLength);
  return base32Encode(buffer);
}

/**
 * Computes an RFC 6238 / RFC 4226 TOTP code for a given secret and timestamp.
 */
function generateTotpCode(secretBase32, timeMs = Date.now(), periodSec = 30, digits = 6) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timeMs / 1000 / periodSec);

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", key);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  // Dynamic truncation (RFC 4226 Section 5.4)
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, "0");
}

/**
 * Verifies a submitted TOTP code against the secret, allowing a configurable clock drift window.
 * Default window = 1 allows 1 step before, current step, and 1 step after (±30s).
 */
function verifyTotpCode(submittedCode, secretBase32, { window = 1, timeMs = Date.now(), periodSec = 30, digits = 6 } = {}) {
  if (typeof submittedCode !== "string" || !secretBase32) {
    return false;
  }
  const cleanCode = submittedCode.trim();
  if (cleanCode.length !== digits || !/^\d+$/.test(cleanCode)) {
    return false;
  }

  try {
    for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
      const checkTime = timeMs + errorWindow * periodSec * 1000;
      const expectedCode = generateTotpCode(secretBase32, checkTime, periodSec, digits);

      // Constant-time comparison
      const bufA = Buffer.from(cleanCode, "utf8");
      const bufB = Buffer.from(expectedCode, "utf8");
      if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Generates standard otpauth:// URI for authenticator app enrollment.
 */
function generateOtpAuthUrl({ email, secret, issuer = "EVolve" }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Signs a payload into a tamper-proof compact session token (header.payload.signature).
 */
function signToken(payload, secret = TOKEN_SECRET, expiresInMs = TOKEN_EXPIRY_MS) {
  const header = { alg: "HS256", typ: "JWT" };
  const exp = Date.now() + expiresInMs;
  const fullPayload = { ...payload, exp, iat: Date.now() };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto.createHmac("sha256", secret).update(dataToSign).digest("base64url");
  return `${dataToSign}.${signature}`;
}

/**
 * Verifies and decodes a signed session token. Returns null if invalid or expired.
 */
function verifyToken(tokenString, secret = TOKEN_SECRET) {
  if (typeof tokenString !== "string" || !tokenString) return null;
  const parts = tokenString.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const expectedSig = crypto.createHmac("sha256", secret).update(dataToSign).digest("base64url");

  const sigBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (typeof payload !== "object" || payload === null) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
      return null; // Expired or missing exp claim
    }
    if (typeof payload.iat !== "number") {
      return null; // Missing issuance timestamp claim
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Express Middleware: Enforces valid authentication token.
 * Rejects requests with 401 if token is missing, invalid, expired, or if MFA is incomplete.
 */
function authenticateToken(secret = TOKEN_SECRET) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required: missing or malformed Bearer token"
      });
    }

    const token = authHeader.slice(7).trim();
    const payload = verifyToken(token, secret);

    if (!payload) {
      return res.status(401).json({
        success: false,
        message: "Invalid, expired, or tampered authentication token"
      });
    }

    // If token indicates that MFA verification is still pending or not verified
    if (!payload.mfaVerified || payload.mfaRequired) {
      return res.status(401).json({
        success: false,
        message: "Multi-factor authentication (TOTP) verification required"
      });
    }

    req.user = payload;
    next();
  };
}

/**
 * Express Middleware Factory: Restricts access to specific domain roles.
 * Rejects with 403 Forbidden if user's role is not in allowedRoles.
 */
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: user identity or role missing"
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: insufficient permissions. Role '${req.user.role}' is not authorized for this operation. Required: [${allowedRoles.join(", ")}]`
      });
    }

    next();
  };
}

module.exports = {
  TOKEN_SECRET,
  TOKEN_EXPIRY_MS,
  MFA_TOKEN_EXPIRY_MS,
  resolveTokenSecret,
  base32Encode,
  base32Decode,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateOtpAuthUrl,
  signToken,
  verifyToken,
  authenticateToken,
  authorizeRoles
};
