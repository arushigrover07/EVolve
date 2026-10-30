const { Pool } = require("pg");
const { poolConfig } = require("./dbConfig");
const { logError } = require("./logging");

// Pool construction is lazy: no startup query, schema mutation or connectivity probe.
const pool = new Pool(poolConfig());
pool.on("error", (error) => logError(console, "Idle database client failed", error));
module.exports = pool;
