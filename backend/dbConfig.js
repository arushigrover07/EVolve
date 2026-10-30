function positiveInteger(value, fallback, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${name}`);
  return parsed;
}

function poolConfig(env = process.env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error("Invalid DATABASE_URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Invalid database protocol");
  if (url.searchParams.getAll("host").length > 1) throw new Error("Duplicate database host parameters are not allowed");
  // pg connection-string SSL flags can override the explicit ssl object.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl", "uselibpqcompat", "sslnegotiation"]) url.searchParams.delete(key);
  // Keep validated timeout settings authoritative when pg parses the URL again.
  for (const key of ["query_timeout", "statement_timeout"]) url.searchParams.delete(key);
  if (env.PG_SSL !== undefined && !["true", "false"].includes(env.PG_SSL)) throw new Error("Invalid PG_SSL");
  const host = url.searchParams.get("host") || url.hostname;
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
  if (env.PG_SSL === "false" && !local) throw new Error("Disabling TLS is allowed only for a loopback database");
  return {
    connectionString: url.toString(),
    ssl: env.PG_SSL === "false" ? false : { rejectUnauthorized: true },
    max: positiveInteger(env.PG_POOL_MAX, 5, "PG_POOL_MAX"),
    connectionTimeoutMillis: positiveInteger(env.PG_CONNECT_TIMEOUT_MS, 5000, "PG_CONNECT_TIMEOUT_MS"),
    idleTimeoutMillis: positiveInteger(env.PG_IDLE_TIMEOUT_MS, 30000, "PG_IDLE_TIMEOUT_MS"),
    query_timeout: positiveInteger(env.PG_QUERY_TIMEOUT_MS, 10000, "PG_QUERY_TIMEOUT_MS"),
    statement_timeout: positiveInteger(env.PG_STATEMENT_TIMEOUT_MS, 10000, "PG_STATEMENT_TIMEOUT_MS")
  };
}
module.exports = { poolConfig, positiveInteger };
