const { logError } = require("./logging");
const { positiveInteger } = require("./dbConfig");

function registerShutdown({ close, forceClose = () => {}, db, logger = console,
  timeoutMs = positiveInteger(process.env.SHUTDOWN_TIMEOUT_MS, 15000, "SHUTDOWN_TIMEOUT_MS"),
  signals = process, onTimeout = () => process.exit(1) }) {
  let stopping;
  const signalHandler = () => { void stop(); };
  function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      const timer = setTimeout(() => {
        logger.error("Graceful shutdown timed out");
        try { forceClose(); } finally { onTimeout(); }
      }, timeoutMs);
      try {
        try { await close(); } finally { await db.end(); }
      } catch (error) {
        process.exitCode = 1;
        logError(logger, "Shutdown failed", error);
      } finally {
        clearTimeout(timer);
        signals.removeListener("SIGTERM", signalHandler);
        signals.removeListener("SIGINT", signalHandler);
      }
    })();
    return stopping;
  }
  signals.on("SIGTERM", signalHandler);
  signals.on("SIGINT", signalHandler);
  return { stop };
}
module.exports = { registerShutdown };
