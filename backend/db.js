const { Pool } = require("pg");

// Get the Neon PostgreSQL connection string from environment variables
const connectionString = process.env.DATABASE_URL;

// Create a PostgreSQL connection pool using the pg package
const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    // Neon PostgreSQL requires SSL connections
    rejectUnauthorized: false,
  },
});

// Test the database connection when the module is loaded
pool.connect((err, client, release) => {
  if (err) {
    console.error("Error connecting to Neon PostgreSQL database:", err.message);
  } else {
    console.log("Successfully connected to Neon PostgreSQL database!");
    release();
  }
});

// Export the pool so it can be reused across the application
module.exports = pool;
