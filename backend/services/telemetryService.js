const db = require("../db");

let telemetryInterval = null;

/**
 * SIMULATED REAL-TIME CHARGER MONITORING SERVICE
 * 
 * NOTE FOR ACADEMIC EVALUATION:
 * EVolve does not have physical charger hardware connected.
 * This service SIMULATES telemetry by periodically toggling charger
 * operational status and calculating station-level metrics (availability,
 * active sessions, utilization percentage) stored in PostgreSQL.
 */

/**
 * Executes a single cycle of simulated charger telemetry:
 * 1. Simulates charger activity by randomly toggling charger status.
 * 2. Calculates station-level metrics for all active stations.
 * 3. Records new metrics entries in the PostgreSQL metrics table.
 */
async function runTelemetryCycle() {
  try {
    // 1. SIMULATE CHARGER ACTIVITY:
    // Select chargers that are currently AVAILABLE or CHARGING
    const chargersResult = await db.query(
      "SELECT id, status FROM chargers WHERE status IN ('AVAILABLE', 'CHARGING')"
    );

    const chargers = chargersResult.rows;

    if (chargers.length > 0) {
      // Pick one charger randomly to toggle status (AVAILABLE <-> CHARGING)
      const randomIndex = Math.floor(Math.random() * chargers.length);
      const selectedCharger = chargers[randomIndex];

      const newStatus = selectedCharger.status === "AVAILABLE" ? "CHARGING" : "AVAILABLE";

      await db.query(
        "UPDATE chargers SET status = $1 WHERE id = $2",
        [newStatus, selectedCharger.id]
      );
    }

    // 2. CALCULATE AND RECORD STATION-LEVEL METRICS:
    // Fetch all active stations
    const stationsResult = await db.query(
      "SELECT id FROM stations WHERE status = 'ACTIVE'"
    );

    for (const station of stationsResult.rows) {
      const stationId = station.id;

      // Count chargers per status for this station
      const countsResult = await db.query(
        `SELECT 
           COUNT(CASE WHEN status = 'AVAILABLE' THEN 1 END) AS available_chargers,
           COUNT(CASE WHEN status = 'CHARGING' THEN 1 END) AS active_sessions,
           COUNT(*) AS total_chargers
         FROM chargers 
         WHERE station_id = $1`,
        [stationId]
      );

      const counts = countsResult.rows[0];
      const available = parseInt(counts.available_chargers, 10) || 0;
      const active = parseInt(counts.active_sessions, 10) || 0;
      const total = parseInt(counts.total_chargers, 10) || 0;

      // Calculate utilization percentage (active sessions / total chargers * 100)
      const utilization = total > 0 ? Number(((active / total) * 100).toFixed(2)) : 0;

      // Insert metric snapshot into metrics table
      await db.query(
        `INSERT INTO metrics (station_id, available_chargers, active_sessions, utilization_percent)
         VALUES ($1, $2, $3, $4)`,
        [stationId, available, active, utilization]
      );
    }

    console.log("[SIMULATED TELEMETRY] Telemetry update cycle completed.");
  } catch (error) {
    console.error("[SIMULATED TELEMETRY ERROR] Failed to complete telemetry update:", error.message);
  }
}

/**
 * Starts the telemetry service loop using setInterval (runs every 10 seconds).
 * Prevents creation of duplicate intervals.
 */
function startTelemetryService() {
  if (telemetryInterval) {
    console.log("[SIMULATED TELEMETRY] Service is already running.");
    return;
  }

  console.log("[SIMULATED TELEMETRY] Starting real-time charger monitoring simulation (10s interval)...");

  // Run the first cycle immediately
  runTelemetryCycle();

  // Run periodically every 10 seconds (10,000 ms)
  telemetryInterval = setInterval(runTelemetryCycle, 10000);
}

module.exports = {
  startTelemetryService,
  runTelemetryCycle
};
