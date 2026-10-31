const express = require("express");
const cors = require("cors");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcrypt");
const { logError } = require("./logging");
const {
  TOKEN_SECRET,
  MFA_TOKEN_EXPIRY_MS,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateOtpAuthUrl,
  signToken,
  verifyToken,
  authenticateToken,
  authorizeRoles
} = require("./auth");

const BCRYPT_SALT_ROUNDS = 12;

async function hashPassword(plainPassword, saltRounds = BCRYPT_SALT_ROUNDS) {
  if (typeof plainPassword !== "string" || plainPassword.length === 0) {
    throw new Error("Password must be a non-empty string");
  }
  return bcrypt.hash(plainPassword, saltRounds);
}

async function verifyPassword(plainPassword, hashedPassword) {
  if (typeof plainPassword !== "string" || typeof hashedPassword !== "string" || !hashedPassword) {
    return false;
  }
  try {
    return await bcrypt.compare(plainPassword, hashedPassword);
  } catch {
    return false;
  }
}

function createApp({ db, instanceId = randomUUID(), logger = console, authSecret = TOKEN_SECRET } = {}) {
  if (!db || typeof db.query !== "function") throw new TypeError("A database dependency is required");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(instanceId)) throw new TypeError("Invalid instance identifier");
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("X-Instance-Id", instanceId);
    next();
  });
  app.use(cors());
  app.use(express.json());

  // Security middlewares bound to the app instance's token secret
  const requireAuth = authenticateToken(authSecret);
  const requireRole = (...roles) => authorizeRoles(...roles);
  // Liveness only: does not query the database or imply database readiness.
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.get("/api/instance", (req, res) => res.json({ instanceId }));


// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "EVolve backend is running!"
  });
});

// ==========================================
// STATIONS CRUD ENDPOINTS
// ==========================================


// Helper function to calculate distance between two coordinates in km using Haversine formula
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const EARTH_RADIUS_KM = 6371;

  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const radLat1 = lat1 * (Math.PI / 180);
  const radLat2 = lat2 * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(radLat1) * Math.cos(radLat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = EARTH_RADIUS_KM * c;
  return Number(distance.toFixed(2));
}

// GET /api/stations/nearby - Find stations nearest to user coordinates (Must be before /:id)
app.get("/api/stations/nearby", async (req, res) => {
  const { latitude, longitude } = req.query;

  // Validate presence and numeric validity of latitude and longitude
  if (
    latitude === undefined ||
    longitude === undefined ||
    isNaN(Number(latitude)) ||
    isNaN(Number(longitude))
  ) {
    return res.status(400).json({
      success: false,
      message: "Valid latitude and longitude query parameters are required"
    });
  }

  const userLat = Number(latitude);
  const userLon = Number(longitude);

  if (userLat < -90 || userLat > 90 || userLon < -180 || userLon > 180) {
    return res.status(400).json({
      success: false,
      message: "Latitude must be between -90 and 90, and longitude between -180 and 180"
    });
  }

  try {
    const result = await db.query(
      "SELECT * FROM stations WHERE latitude IS NOT NULL AND longitude IS NOT NULL"
    );

    const stationsWithDistance = result.rows.map((station) => {
      const stationLat = Number(station.latitude);
      const stationLon = Number(station.longitude);

      const distance_km = calculateHaversineDistance(
        userLat,
        userLon,
        stationLat,
        stationLon
      );

      return {
        ...station,
        distance_km: distance_km
      };
    });

    // Sort by distance from nearest to farthest
    stationsWithDistance.sort((a, b) => a.distance_km - b.distance_km);

    res.json(stationsWithDistance);
  } catch (error) {
    logError(logger, "Error fetching nearby stations:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch nearby stations",
      error: "Internal server error"
    });
  }
});

// 1. GET /api/stations - Fetch all stations from PostgreSQL database with aggregated charger counts
app.get("/api/stations", async (req, res) => {
  try {
    const queryText = `
      SELECT 
        s.*,
        COALESCE(COUNT(c.id), 0)::int AS total_chargers,
        COALESCE(COUNT(c.id) FILTER (WHERE c.status = 'AVAILABLE'), 0)::int AS available_chargers,
        COALESCE(COUNT(c.id) FILTER (WHERE c.status = 'CHARGING'), 0)::int AS charging_chargers
      FROM stations s
      LEFT JOIN chargers c ON c.station_id = s.id
      GROUP BY s.id
      ORDER BY s.id ASC
    `;
    const result = await db.query(queryText);
    res.json(result.rows);
  } catch (error) {
    logError(logger, "Error fetching stations:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch stations from database",
      error: "Internal server error"
    });
  }
});

// 2. GET /api/stations/:id - Fetch single station by ID
app.get("/api/stations/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const queryText = `
      SELECT 
        s.*,
        COALESCE(COUNT(c.id), 0)::int AS total_chargers,
        COALESCE(COUNT(c.id) FILTER (WHERE c.status = 'AVAILABLE'), 0)::int AS available_chargers,
        COALESCE(COUNT(c.id) FILTER (WHERE c.status = 'CHARGING'), 0)::int AS charging_chargers
      FROM stations s
      LEFT JOIN chargers c ON c.station_id = s.id
      WHERE s.id = $1
      GROUP BY s.id
    `;
    const result = await db.query(queryText, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Station not found"
      });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logError(logger, "Error fetching station:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch station",
      error: "Internal server error"
    });
  }
});

// 3. POST /api/stations - Create a new station (supports latitude & longitude)
app.post("/api/stations", async (req, res) => {
  const { name, location, status = "ACTIVE", latitude, longitude } = req.body;

  if (!name || !location) {
    return res.status(400).json({
      success: false,
      message: "Name and location are required"
    });
  }

  try {
    const result = await db.query(
      "INSERT INTO stations (name, location, status, latitude, longitude) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [name, location, status, latitude !== undefined ? latitude : null, longitude !== undefined ? longitude : null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logError(logger, "Error creating station:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create station",
      error: "Internal server error"
    });
  }
});

// 4. PUT /api/stations/:id - Update an existing station by ID (Restricted: operator, admin)
app.put("/api/stations/:id", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const { id } = req.params;
  const { name, location, status = "ACTIVE", latitude, longitude } = req.body;

  if (!name || !location) {
    return res.status(400).json({
      success: false,
      message: "Name and location are required"
    });
  }

  try {
    const result = await db.query(
      "UPDATE stations SET name = $1, location = $2, status = $3, latitude = $4, longitude = $5 WHERE id = $6 RETURNING *",
      [name, location, status, latitude !== undefined ? latitude : null, longitude !== undefined ? longitude : null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Station not found"
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logError(logger, "Error updating station:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update station",
      error: "Internal server error"
    });
  }
});

// 5. DELETE /api/stations/:id - Delete a station by ID (Restricted: operator, admin)
app.delete("/api/stations/:id", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      "DELETE FROM stations WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Station not found"
      });
    }

    res.json({
      success: true,
      message: "Station deleted successfully",
      station: result.rows[0]
    });
  } catch (error) {
    logError(logger, "Error deleting station:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete station",
      error: "Internal server error"
    });
  }
});

// ==========================================
// CHARGERS CRUD ENDPOINTS
// ==========================================

// 1. GET /api/chargers - Fetch chargers from PostgreSQL (supports station_id filter)
app.get("/api/chargers", async (req, res) => {
  const { station_id } = req.query;
  try {
    if (station_id) {
      const result = await db.query(
        "SELECT * FROM chargers WHERE station_id = $1 ORDER BY id ASC",
        [station_id]
      );
      return res.json(result.rows);
    }

    const result = await db.query("SELECT * FROM chargers ORDER BY id ASC");
    res.json(result.rows);
  } catch (error) {
    logError(logger, "Error fetching chargers:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch chargers from database",
      error: "Internal server error"
    });
  }
});

// 2. GET /api/chargers/:id - Fetch single charger by ID
app.get("/api/chargers/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query("SELECT * FROM chargers WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Charger not found"
      });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logError(logger, "Error fetching charger:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch charger",
      error: "Internal server error"
    });
  }
});

// 3. POST /api/chargers - Create a new charger
app.post("/api/chargers", async (req, res) => {
  const { station_id, charger_type, power_kw, status = "AVAILABLE" } = req.body;

  if (!station_id || !charger_type || !power_kw) {
    return res.status(400).json({
      success: false,
      message: "station_id, charger_type, and power_kw are required"
    });
  }

  try {
    const result = await db.query(
      "INSERT INTO chargers (station_id, charger_type, power_kw, status) VALUES ($1, $2, $3, $4) RETURNING *",
      [station_id, charger_type, power_kw, status]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logError(logger, "Error creating charger:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create charger",
      error: "Internal server error"
    });
  }
});

// 4. PUT /api/chargers/:id - Update an existing charger by ID (Restricted: operator, admin)
app.put("/api/chargers/:id", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const { id } = req.params;
  const { station_id, charger_type, power_kw, status = "AVAILABLE" } = req.body;

  if (!station_id || !charger_type || !power_kw) {
    return res.status(400).json({
      success: false,
      message: "station_id, charger_type, and power_kw are required"
    });
  }

  try {
    const result = await db.query(
      "UPDATE chargers SET station_id = $1, charger_type = $2, power_kw = $3, status = $4 WHERE id = $5 RETURNING *",
      [station_id, charger_type, power_kw, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Charger not found"
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logError(logger, "Error updating charger:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update charger",
      error: "Internal server error"
    });
  }
});

// 5. DELETE /api/chargers/:id - Delete a charger by ID (Restricted: operator, admin)
app.delete("/api/chargers/:id", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      "DELETE FROM chargers WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Charger not found"
      });
    }

    res.json({
      success: true,
      message: "Charger deleted successfully",
      charger: result.rows[0]
    });
  } catch (error) {
    logError(logger, "Error deleting charger:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete charger",
      error: "Internal server error"
    });
  }
});

// ==========================================
// AUTHENTICATION ENDPOINTS
// ==========================================

// POST /api/login - Authenticate user against PostgreSQL users table
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const queryText = `
      SELECT id, name, email, password_hash, role, totp_secret, mfa_enabled, created_at
      FROM users
      WHERE LOWER(email) = LOWER($1)
    `;
    const result = await db.query(queryText, [email.trim()]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const user = result.rows[0];

    // Cryptographically verify submitted password against stored salted bcrypt hash
    // Constant-time comparison mitigates timing attacks; invalid hash formats safely return false
    const isPasswordValid = await verifyPassword(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Return safe user payload (never include password, hash, or secret)
    const isMfaActive = Boolean(user.mfa_enabled && user.totp_secret);

    if (isMfaActive) {
      const mfaChallengeToken = signToken(
        { userId: user.id, email: user.email, role: user.role, mfaRequired: true, mfaVerified: false },
        authSecret,
        MFA_TOKEN_EXPIRY_MS
      );
      return res.json({
        success: true,
        mfa_required: true,
        mfa_token: mfaChallengeToken,
        message: "Password verified. Please enter the 6-digit TOTP code from your authenticator app."
      });
    }

    const sessionToken = signToken(
      { userId: user.id, email: user.email, role: user.role, mfaRequired: false, mfaVerified: true },
      authSecret
    );

    res.json({
      success: true,
      message: "Login successful",
      token: sessionToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    logError(logger, "Error during user login:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred during authentication",
      error: "Internal server error"
    });
  }
});

// POST /api/mfa/verify - Verify 6-digit TOTP code and issue fully authenticated session token
app.post("/api/mfa/verify", async (req, res) => {
  try {
    const { mfa_token, totp_code } = req.body;
    const authHeader = req.headers.authorization;
    const token = mfa_token || (authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null);

    if (!token || !totp_code) {
      return res.status(400).json({
        success: false,
        message: "MFA challenge token and 6-digit totp_code are required"
      });
    }

    const payload = verifyToken(token, authSecret);
    if (!payload || !payload.userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired MFA authentication token"
      });
    }

    const userResult = await db.query(
      "SELECT id, name, email, role, totp_secret, mfa_enabled FROM users WHERE id = $1",
      [payload.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User account not found"
      });
    }

    const user = userResult.rows[0];
    if (!user.totp_secret) {
      return res.status(400).json({
        success: false,
        message: "TOTP MFA is not configured for this account. Please enroll first."
      });
    }

    const isCodeValid = verifyTotpCode(totp_code, user.totp_secret);
    if (!isCodeValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired TOTP code. Please check your authenticator application."
      });
    }

    const fullSessionToken = signToken(
      { userId: user.id, email: user.email, role: user.role, mfaRequired: false, mfaVerified: true },
      authSecret
    );

    res.json({
      success: true,
      message: "MFA verification successful",
      token: fullSessionToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    logError(logger, "Error during TOTP verification:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred during MFA verification",
      error: "Internal server error"
    });
  }
});

// POST /api/mfa/enroll - Begin TOTP enrollment for the authenticated user
app.post("/api/mfa/enroll", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const email = req.user.email;

    const userCheck = await db.query(
      "SELECT id, email, totp_secret, mfa_enabled FROM users WHERE id = $1",
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User account not found"
      });
    }

    const currentUser = userCheck.rows[0];

    // If MFA is currently active, require current TOTP code to prevent unauthorized replacement or disabling
    if (currentUser.mfa_enabled && currentUser.totp_secret) {
      const { current_totp_code } = req.body;
      if (!current_totp_code || !verifyTotpCode(current_totp_code, currentUser.totp_secret)) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: current 6-digit TOTP code is required to reconfigure or replace an active MFA setup"
        });
      }
    }

    const secret = generateTotpSecret(20);
    const otpauthUrl = generateOtpAuthUrl({ email, secret, issuer: "EVolve" });

    // Store pending secret (with mfa_enabled = false until confirmed)
    await db.query(
      "UPDATE users SET totp_secret = $1, mfa_enabled = false WHERE id = $2",
      [secret, userId]
    );

    res.json({
      success: true,
      message: "TOTP enrollment initiated. Scan the QR code or enter the secret in your authenticator app, then confirm with a 6-digit code.",
      secret: secret,
      otpauth_url: otpauthUrl
    });
  } catch (error) {
    logError(logger, "Error initiating TOTP enrollment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initiate TOTP enrollment",
      error: "Internal server error"
    });
  }
});

// POST /api/mfa/confirm - Complete TOTP enrollment by verifying the first code
app.post("/api/mfa/confirm", requireAuth, async (req, res) => {
  try {
    const { totp_code } = req.body;
    const userId = req.user.userId;

    if (!totp_code) {
      return res.status(400).json({
        success: false,
        message: "6-digit totp_code is required"
      });
    }

    const userResult = await db.query(
      "SELECT id, name, email, role, totp_secret FROM users WHERE id = $1",
      [userId]
    );

    if (userResult.rows.length === 0 || !userResult.rows[0].totp_secret) {
      return res.status(400).json({
        success: false,
        message: "No pending TOTP enrollment found. Call /api/mfa/enroll first."
      });
    }

    const user = userResult.rows[0];
    const isValid = verifyTotpCode(totp_code, user.totp_secret);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid TOTP code. Enrollment confirmation failed."
      });
    }

    await db.query("UPDATE users SET mfa_enabled = true WHERE id = $1", [userId]);

    const verifiedToken = signToken(
      { userId: user.id, email: user.email, role: user.role, mfaRequired: false, mfaVerified: true },
      authSecret
    );

    res.json({
      success: true,
      message: "MFA enabled successfully. Authenticator app linked.",
      token: verifiedToken
    });
  } catch (error) {
    logError(logger, "Error confirming TOTP enrollment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to confirm TOTP enrollment",
      error: "Internal server error"
    });
  }
});

// ==========================================
// BOOKINGS CRUD ENDPOINTS
// ==========================================

// 1. GET /api/bookings - Fetch all bookings with charger & station details
app.get("/api/bookings", async (req, res) => {
  try {
    const queryText = `
      SELECT 
        b.id,
        b.user_id,
        b.charger_id,
        b.start_time,
        b.end_time,
        b.status,
        b.created_at,
        c.charger_type,
        c.power_kw,
        c.station_id,
        s.name AS station_name,
        s.location AS station_location
      FROM bookings b
      LEFT JOIN chargers c ON b.charger_id = c.id
      LEFT JOIN stations s ON c.station_id = s.id
      ORDER BY b.id ASC
    `;
    const result = await db.query(queryText);
    res.json(result.rows);
  } catch (error) {
    logError(logger, "Error fetching bookings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bookings from database",
      error: "Internal server error"
    });
  }
});

// 2. GET /api/bookings/:id - Fetch single booking by ID
app.get("/api/bookings/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const queryText = `
      SELECT 
        b.id,
        b.user_id,
        b.charger_id,
        b.start_time,
        b.end_time,
        b.status,
        b.created_at,
        c.charger_type,
        c.power_kw,
        c.station_id,
        s.name AS station_name,
        s.location AS station_location
      FROM bookings b
      LEFT JOIN chargers c ON b.charger_id = c.id
      LEFT JOIN stations s ON c.station_id = s.id
      WHERE b.id = $1
    `;
    const result = await db.query(queryText, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logError(logger, "Error fetching booking:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch booking",
      error: "Internal server error"
    });
  }
});

// 3. POST /api/bookings - Create a new booking
app.post("/api/bookings", async (req, res) => {
  const { user_id, charger_id, start_time, end_time, status = "BOOKED" } = req.body;

  if (!user_id || !charger_id || !start_time || !end_time) {
    return res.status(400).json({
      success: false,
      message: "user_id, charger_id, start_time, and end_time are required"
    });
  }

  const start = new Date(start_time);
  const end = new Date(end_time);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({
      success: false,
      message: "Invalid start_time or end_time format"
    });
  }

  if (end <= start) {
    return res.status(400).json({
      success: false,
      message: "end_time must be after start_time"
    });
  }

  try {
    const chargerCheck = await db.query("SELECT * FROM chargers WHERE id = $1", [charger_id]);
    if (chargerCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Charger not found"
      });
    }

    const conflictCheck = await db.query(
      `SELECT * FROM bookings 
       WHERE charger_id = $1 
         AND status != 'CANCELLED' 
         AND start_time < $2 
         AND end_time > $3`,
      [charger_id, end_time, start_time]
    );

    if (conflictCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Charger is already booked for the selected time slot"
      });
    }

    const result = await db.query(
      "INSERT INTO bookings (user_id, charger_id, start_time, end_time, status) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [user_id, charger_id, start_time, end_time, status]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logError(logger, "Error creating booking:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create booking",
      error: "Internal server error"
    });
  }
});

// 4. PUT /api/bookings/:id - Update an existing booking by ID (Restricted: operator, admin, or owning user)
app.put("/api/bookings/:id", requireAuth, requireRole("operator", "admin", "user"), async (req, res) => {
  const { id } = req.params;
  const { user_id, charger_id, start_time, end_time, status = "BOOKED" } = req.body;

  if (!user_id || !charger_id || !start_time || !end_time) {
    return res.status(400).json({
      success: false,
      message: "user_id, charger_id, start_time, and end_time are required"
    });
  }

  const start = new Date(start_time);
  const end = new Date(end_time);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({
      success: false,
      message: "Invalid start_time or end_time format"
    });
  }

  if (end <= start) {
    return res.status(400).json({
      success: false,
      message: "end_time must be after start_time"
    });
  }

  try {
    // If regular user, ensure they only modify their own booking
    if (req.user.role === "user") {
      const existing = await db.query("SELECT user_id FROM bookings WHERE id = $1", [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Booking not found" });
      }
      if (existing.rows[0].user_id !== req.user.userId) {
        return res.status(403).json({ success: false, message: "Forbidden: you can only update your own bookings" });
      }
    }

    const targetUserId = req.user.role === "user" ? req.user.userId : (user_id || req.user.userId);

    const result = await db.query(
      "UPDATE bookings SET user_id = $1, charger_id = $2, start_time = $3, end_time = $4, status = $5 WHERE id = $6 RETURNING *",
      [targetUserId, charger_id, start_time, end_time, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logError(logger, "Error updating booking:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update booking",
      error: "Internal server error"
    });
  }
});

// 5. DELETE /api/bookings/:id - Delete a booking by ID (Restricted: operator, admin, or owning user)
app.delete("/api/bookings/:id", requireAuth, requireRole("operator", "admin", "user"), async (req, res) => {
  const { id } = req.params;
  try {
    // If regular user, ensure they only delete their own booking
    if (req.user.role === "user") {
      const existing = await db.query("SELECT user_id FROM bookings WHERE id = $1", [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Booking not found" });
      }
      if (existing.rows[0].user_id !== req.user.userId) {
        return res.status(403).json({ success: false, message: "Forbidden: you can only delete your own bookings" });
      }
    }

    const result = await db.query(
      "DELETE FROM bookings WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    res.json({
      success: true,
      message: "Booking deleted successfully",
      booking: result.rows[0]
    });
  } catch (error) {
    logError(logger, "Error deleting booking:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete booking",
      error: "Internal server error"
    });
  }
});

// ==========================================
// CHARGING SESSIONS CRUD ENDPOINTS
// ==========================================

// 1. GET /api/sessions - Fetch all charging sessions with booking, charger & station details
app.get("/api/sessions", async (req, res) => {
  try {
    const queryText = `
      SELECT 
        cs.id,
        cs.booking_id,
        cs.start_time,
        cs.end_time,
        cs.energy_used_kwh,
        cs.amount,
        cs.created_at,
        b.user_id,
        b.status AS booking_status,
        c.id AS charger_id,
        c.charger_type,
        c.power_kw,
        s.id AS station_id,
        s.name AS station_name,
        s.location AS station_location
      FROM charging_sessions cs
      LEFT JOIN bookings b ON cs.booking_id = b.id
      LEFT JOIN chargers c ON b.charger_id = c.id
      LEFT JOIN stations s ON c.station_id = s.id
      ORDER BY cs.id ASC
    `;
    const result = await db.query(queryText);
    res.json(result.rows);
  } catch (error) {
    logError(logger, "Error fetching charging sessions:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch charging sessions from database",
      error: "Internal server error"
    });
  }
});

// 2. GET /api/sessions/:id - Fetch single charging session by ID
app.get("/api/sessions/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const queryText = `
      SELECT 
        cs.id,
        cs.booking_id,
        cs.start_time,
        cs.end_time,
        cs.energy_used_kwh,
        cs.amount,
        cs.created_at,
        b.user_id,
        b.status AS booking_status,
        c.id AS charger_id,
        c.charger_type,
        c.power_kw,
        s.id AS station_id,
        s.name AS station_name,
        s.location AS station_location
      FROM charging_sessions cs
      LEFT JOIN bookings b ON cs.booking_id = b.id
      LEFT JOIN chargers c ON b.charger_id = c.id
      LEFT JOIN stations s ON c.station_id = s.id
      WHERE cs.id = $1
    `;
    const result = await db.query(queryText, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Charging session not found"
      });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logError(logger, "Error fetching charging session:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch charging session",
      error: "Internal server error"
    });
  }
});

// 3. POST /api/sessions - Create/start a new charging session
app.post("/api/sessions", async (req, res) => {
  const { booking_id, start_time = new Date().toISOString(), end_time = null, energy_used_kwh = 0 } = req.body;

  if (!booking_id) {
    return res.status(400).json({
      success: false,
      message: "booking_id is required"
    });
  }

  const energy = Number(energy_used_kwh);
  if (isNaN(energy) || energy < 0) {
    return res.status(400).json({
      success: false,
      message: "energy_used_kwh must be a non-negative number"
    });
  }

  try {
    // 1. Validate booking exists
    const bookingRes = await db.query("SELECT * FROM bookings WHERE id = $1", [booking_id]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    const booking = bookingRes.rows[0];

    // 2. Check if active session already exists for this booking
    const activeCheck = await db.query(
      "SELECT * FROM charging_sessions WHERE booking_id = $1 AND end_time IS NULL",
      [booking_id]
    );

    if (activeCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "An active charging session already exists for this booking",
        session: activeCheck.rows[0]
      });
    }

    // 3. Calculate billing amount (₹12 per kWh)
    const calculatedAmount = Number((energy * 12).toFixed(2));

    const result = await db.query(
      "INSERT INTO charging_sessions (booking_id, start_time, end_time, energy_used_kwh, amount) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [booking_id, start_time, end_time || null, energy, calculatedAmount]
    );

    if (!end_time && booking.charger_id) {
      await db.query("UPDATE chargers SET status = 'CHARGING' WHERE id = $1", [booking.charger_id]).catch((error) => logError(logger, "Charger status update failed", error));
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logError(logger, "Error creating charging session:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create charging session",
      error: "Internal server error"
    });
  }
});

// POST /api/sessions/start - Start a charging session for a booking
app.post("/api/sessions/start", async (req, res) => {
  const { booking_id } = req.body;
  if (!booking_id) {
    return res.status(400).json({ success: false, message: "booking_id is required" });
  }

  try {
    const bookingRes = await db.query("SELECT * FROM bookings WHERE id = $1", [booking_id]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    const booking = bookingRes.rows[0];

    const activeCheck = await db.query(
      "SELECT * FROM charging_sessions WHERE booking_id = $1 AND end_time IS NULL",
      [booking_id]
    );

    if (activeCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "An active charging session already exists for this booking",
        session: activeCheck.rows[0]
      });
    }

    const now = new Date().toISOString();
    const result = await db.query(
      "INSERT INTO charging_sessions (booking_id, start_time, end_time, energy_used_kwh, amount) VALUES ($1, $2, NULL, 0, 0) RETURNING *",
      [booking_id, now]
    );

    if (booking.charger_id) {
      await db.query("UPDATE chargers SET status = 'CHARGING' WHERE id = $1", [booking.charger_id]).catch((error) => logError(logger, "Charger status update failed", error));
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logError(logger, "Error starting charging session:", error);
    res.status(500).json({ success: false, message: "Failed to start charging session", error: "Internal server error" });
  }
});

// POST /api/sessions/:id/complete - Complete a session and calculate final bill (₹12/kWh)
// Restricted: operator, admin, or owning user
app.post("/api/sessions/:id/complete", requireAuth, requireRole("operator", "admin", "user"), async (req, res) => {
  const { id } = req.params;

  if (!/^\d+$/.test(String(id)) || Number(id) <= 0) {
    return res.status(400).json({
      success: false,
      message: "Valid numeric session ID is required"
    });
  }

  const { energy_used_kwh } = req.body || {};
  const energy = Number(energy_used_kwh);

  if (
    energy_used_kwh === undefined ||
    energy_used_kwh === null ||
    typeof energy_used_kwh === "boolean" ||
    (typeof energy_used_kwh === "string" && energy_used_kwh.trim() === "") ||
    !Number.isFinite(energy) ||
    energy < 0
  ) {
    return res.status(400).json({
      success: false,
      message: "Valid non-negative energy_used_kwh is required"
    });
  }

  try {
    const sessionCheck = await db.query(
      `SELECT cs.*, b.charger_id, b.user_id FROM charging_sessions cs
       LEFT JOIN bookings b ON cs.booking_id = b.id
       WHERE cs.id = $1`,
      [id]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Charging session not found"
      });
    }

    const session = sessionCheck.rows[0];

    // Ownership check for regular users: cannot complete another user's session
    if (req.user.role === "user") {
      if (!session.user_id || session.user_id !== req.user.userId) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: you can only complete your own charging sessions"
        });
      }
    }

    const RATE_PER_KWH = 12;
    const calculatedAmount = Number((energy * RATE_PER_KWH).toFixed(2));
    const endTime = new Date().toISOString();

    const result = await db.query(
      "UPDATE charging_sessions SET end_time = $1, energy_used_kwh = $2, amount = $3 WHERE id = $4 RETURNING *",
      [endTime, energy, calculatedAmount, id]
    );

    if (session.charger_id) {
      await db.query("UPDATE chargers SET status = 'AVAILABLE' WHERE id = $1", [session.charger_id]).catch((error) => logError(logger, "Charger status update failed", error));
    }

    res.json({
      success: true,
      message: "Charging session completed successfully",
      rate_per_kwh: RATE_PER_KWH,
      energy_used_kwh: energy,
      amount: calculatedAmount,
      session: result.rows[0]
    });
  } catch (error) {
    logError(logger, "Error completing charging session:", error);
    res.status(500).json({
      success: false,
      message: "Failed to complete charging session",
      error: "Internal server error"
    });
  }
});

// 4. PUT /api/sessions/:id - Update an existing charging session by ID (Restricted: operator, admin)
app.put("/api/sessions/:id", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const { id } = req.params;
  const { booking_id, start_time, end_time, energy_used_kwh = 0 } = req.body;

  const energy = Number(energy_used_kwh);
  if (isNaN(energy) || energy < 0) {
    return res.status(400).json({
      success: false,
      message: "energy_used_kwh must be a non-negative number"
    });
  }

  const calculatedAmount = Number((energy * 12).toFixed(2));

  try {
    const result = await db.query(
      "UPDATE charging_sessions SET booking_id = $1, start_time = $2, end_time = $3, energy_used_kwh = $4, amount = $5 WHERE id = $6 RETURNING *",
      [booking_id, start_time, end_time || null, energy, calculatedAmount, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Charging session not found"
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logError(logger, "Error updating charging session:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update charging session",
      error: "Internal server error"
    });
  }
});

// 5. DELETE /api/sessions/:id - Delete a charging session by ID (Restricted: operator, admin)
app.delete("/api/sessions/:id", requireAuth, requireRole("operator", "admin"), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      "DELETE FROM charging_sessions WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Charging session not found"
      });
    }

    res.json({
      success: true,
      message: "Charging session deleted successfully",
      session: result.rows[0]
    });
  } catch (error) {
    logError(logger, "Error deleting charging session:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete charging session",
      error: "Internal server error"
    });
  }
});

// ==========================================
// TELEMETRY & METRICS ENDPOINTS
// ==========================================

// GET /api/metrics - Fetch recent station telemetry metrics with station details
app.get("/api/metrics", async (req, res) => {
  try {
    const queryText = `
      SELECT 
        m.id,
        m.station_id,
        s.name AS station_name,
        s.location AS station_location,
        m.available_chargers,
        m.active_sessions,
        m.utilization_percent,
        m.recorded_at
      FROM metrics m
      JOIN stations s ON m.station_id = s.id
      ORDER BY m.recorded_at DESC
      LIMIT 50
    `;
    const result = await db.query(queryText);
    res.json(result.rows);
  } catch (error) {
    logError(logger, "Error fetching metrics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch telemetry metrics",
      error: "Internal server error"
    });
  }
});

// ==========================================
// TEST ENDPOINTS
// ==========================================

// GET endpoint to test PostgreSQL database connection
app.get("/api/db-test", async (req, res) => {
  try {
    const result = await db.query("SELECT NOW()");
    res.json({
      success: true,
      message: "Database connected successfully!",
      timestamp: result.rows[0].now
    });
  } catch (error) {
    logError(logger, "Database connectivity check failed", error);
    res.status(500).json({
      success: false,
      message: "Database connection failed",
      error: "Internal server error"
    });
  }
});

// Handle malformed JSON and unexpected errors without exposing internal details.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.type === "entity.parse.failed" ? 400 : error.type === "entity.too.large" ? 413 : 500;
  logError(logger, "Request failed", error);
  res.status(status).json({ success: false, message: status === 400 ? "Invalid JSON body" : status === 413 ? "Request body too large" : "Internal server error" });
});
return app;
}

module.exports = {
  createApp,
  hashPassword,
  verifyPassword,
  BCRYPT_SALT_ROUNDS,
  signToken,
  verifyToken,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateOtpAuthUrl
};
