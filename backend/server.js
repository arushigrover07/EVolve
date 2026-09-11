const express = require("express");
const cors = require("cors");
const db = require("./db");
const { startTelemetryService } = require("./services/telemetryService");

const app = express();

app.use(cors());
app.use(express.json());

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "EVolve backend is running!"
  });
});

// ==========================================
// STATIONS CRUD ENDPOINTS
// ==========================================

// Automatically ensure latitude and longitude columns exist in stations table
db.query(`
  ALTER TABLE stations 
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7);
`).catch((err) => {
  console.log("Note: Database schema check completed.");
});

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
    console.error("Error fetching nearby stations:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch nearby stations",
      error: error.message
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
    console.error("Error fetching stations:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch stations from database",
      error: error.message
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
    console.error("Error fetching station:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch station",
      error: error.message
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
    console.error("Error creating station:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to create station",
      error: error.message
    });
  }
});

// 4. PUT /api/stations/:id - Update an existing station by ID (supports latitude & longitude)
app.put("/api/stations/:id", async (req, res) => {
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
    console.error("Error updating station:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to update station",
      error: error.message
    });
  }
});

// 5. DELETE /api/stations/:id - Delete a station by ID
app.delete("/api/stations/:id", async (req, res) => {
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
    console.error("Error deleting station:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to delete station",
      error: error.message
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
    console.error("Error fetching chargers:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch chargers from database",
      error: error.message
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
    console.error("Error fetching charger:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch charger",
      error: error.message
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
    console.error("Error creating charger:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to create charger",
      error: error.message
    });
  }
});

// 4. PUT /api/chargers/:id - Update an existing charger by ID
app.put("/api/chargers/:id", async (req, res) => {
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
    console.error("Error updating charger:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to update charger",
      error: error.message
    });
  }
});

// 5. DELETE /api/chargers/:id - Delete a charger by ID
app.delete("/api/chargers/:id", async (req, res) => {
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
    console.error("Error deleting charger:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to delete charger",
      error: error.message
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
    console.error("Error fetching bookings:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bookings from database",
      error: error.message
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
    console.error("Error fetching booking:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch booking",
      error: error.message
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
    console.error("Error creating booking:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to create booking",
      error: error.message
    });
  }
});

// 4. PUT /api/bookings/:id - Update an existing booking by ID
app.put("/api/bookings/:id", async (req, res) => {
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
    const result = await db.query(
      "UPDATE bookings SET user_id = $1, charger_id = $2, start_time = $3, end_time = $4, status = $5 WHERE id = $6 RETURNING *",
      [user_id, charger_id, start_time, end_time, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating booking:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to update booking",
      error: error.message
    });
  }
});

// 5. DELETE /api/bookings/:id - Delete a booking by ID
app.delete("/api/bookings/:id", async (req, res) => {
  const { id } = req.params;
  try {
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
    console.error("Error deleting booking:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to delete booking",
      error: error.message
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
    console.error("Error fetching charging sessions:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch charging sessions from database",
      error: error.message
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
    console.error("Error fetching charging session:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch charging session",
      error: error.message
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
      await db.query("UPDATE chargers SET status = 'CHARGING' WHERE id = $1", [booking.charger_id]).catch(() => {});
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating charging session:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to create charging session",
      error: error.message
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
      await db.query("UPDATE chargers SET status = 'CHARGING' WHERE id = $1", [booking.charger_id]).catch(() => {});
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error starting charging session:", error.message);
    res.status(500).json({ success: false, message: "Failed to start charging session", error: error.message });
  }
});

// POST /api/sessions/:id/complete - Complete a session and calculate final bill (₹12/kWh)
app.post("/api/sessions/:id/complete", async (req, res) => {
  const { id } = req.params;
  const { energy_used_kwh } = req.body;

  const energy = Number(energy_used_kwh);
  if (energy_used_kwh === undefined || isNaN(energy) || energy < 0) {
    return res.status(400).json({
      success: false,
      message: "Valid non-negative energy_used_kwh is required"
    });
  }

  try {
    const sessionCheck = await db.query(
      `SELECT cs.*, b.charger_id FROM charging_sessions cs
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
    const RATE_PER_KWH = 12;
    const calculatedAmount = Number((energy * RATE_PER_KWH).toFixed(2));
    const endTime = new Date().toISOString();

    const result = await db.query(
      "UPDATE charging_sessions SET end_time = $1, energy_used_kwh = $2, amount = $3 WHERE id = $4 RETURNING *",
      [endTime, energy, calculatedAmount, id]
    );

    if (session.charger_id) {
      await db.query("UPDATE chargers SET status = 'AVAILABLE' WHERE id = $1", [session.charger_id]).catch(() => {});
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
    console.error("Error completing charging session:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to complete charging session",
      error: error.message
    });
  }
});

// 4. PUT /api/sessions/:id - Update an existing charging session by ID
app.put("/api/sessions/:id", async (req, res) => {
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
    console.error("Error updating charging session:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to update charging session",
      error: error.message
    });
  }
});

// 5. DELETE /api/sessions/:id - Delete a charging session by ID
app.delete("/api/sessions/:id", async (req, res) => {
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
    console.error("Error deleting charging session:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to delete charging session",
      error: error.message
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
    console.error("Error fetching metrics:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch telemetry metrics",
      error: error.message
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
    res.status(500).json({
      success: false,
      message: "Database connection failed",
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`EVolve backend running on port ${PORT}`);
  // Start simulated real-time telemetry monitoring service
  startTelemetryService();
});