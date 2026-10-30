const { createApp } = require("./app");
const { registerShutdown } = require("./shutdown");
const { logError } = require("./logging");
const { positiveInteger } = require("./dbConfig");

function startServer({ db = require("./db"), port = process.env.PORT || 5000, logger = console,
  timeoutMs = positiveInteger(process.env.SHUTDOWN_TIMEOUT_MS, 15000, "SHUTDOWN_TIMEOUT_MS") } = {}) {
  const app = createApp({ db, logger });
  const server = app.listen(port, () => logger.log("EVolve backend listening"));
  const shutdown = registerShutdown({
    close: () => new Promise((resolve) => server.close(resolve)),
    forceClose: () => server.closeAllConnections(),
    db,
    logger,
    timeoutMs
  });
  server.on("error", (error) => {
    logError(logger, "HTTP server failed", error);
    process.exitCode = 1;
    void shutdown.stop();
  });
  return { app, server, stop: shutdown.stop };
}

if (require.main === module) startServer();
module.exports = { startServer };
