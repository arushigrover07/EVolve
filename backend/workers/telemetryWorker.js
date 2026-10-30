const { createTelemetryService } = require("../services/telemetryService");
const { positiveInteger } = require("../dbConfig");
const { registerShutdown } = require("../shutdown");
const { logError } = require("../logging");

function startWorker({ env = process.env, db, logger = console } = {}) {
  // Refuse to load the database module or produce writes unless explicitly enabled.
  if (env.TELEMETRY_ENABLED !== "true") throw new Error("Telemetry worker requires TELEMETRY_ENABLED=true");
  const intervalMs = positiveInteger(env.TELEMETRY_INTERVAL_MS, 10000, "TELEMETRY_INTERVAL_MS");
  const timeoutMs = positiveInteger(env.SHUTDOWN_TIMEOUT_MS, 15000, "SHUTDOWN_TIMEOUT_MS");
  const pool = db || require("../db");
  const service = createTelemetryService({ db: pool, logger, intervalMs });
  const shutdown = registerShutdown({ close: service.stop, db: pool, logger, timeoutMs });
  service.start();
  logger.log("Simulated telemetry worker started");
  return { stop: shutdown.stop };
}
if (require.main === module) {
  try { startWorker(); } catch (error) {
    logError(console, "Telemetry worker startup failed; check explicit configuration", error);
    process.exitCode = 1;
  }
}
module.exports = { startWorker };
