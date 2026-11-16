const { Pool, types } = require("pg");

types.setTypeParser(1082, function(stringValue) {
  return stringValue; // Returns YYYY-MM-DD string without UTC shifting
});

const { DB_POOL_MAX } = require("./dbCapacity");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: false,
  // Derived from the shared connection budget rather than hard-coded, so
  // workers x pool can never exceed the database's max_connections. A
  // previously hard-coded 20 here meant 3 workers claimed all 60 available
  // connections, leaving none for psql, migrations or the platform itself.
  max: DB_POOL_MAX,
  idleTimeoutMillis: 30000,         // release idle connections after 30s
  connectionTimeoutMillis: 5000,    // fail fast (was 10s) so errors surface quickly instead of queueing
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

/**
 * Required by pg-pool: a client sitting IDLE in the pool can still have
 * its underlying socket die (network blip, or the Supabase pooler
 * recycling a connection it decided was idle too long) — pg-pool
 * emits that as an 'error' event on the Pool itself, not as a query
 * rejection. An EventEmitter with no 'error' listener re-throws
 * whatever it's given as an uncaught exception, which is exactly what
 * crashed the worker: "read ETIMEDOUT" on an idle client, unrelated to
 * any query in flight. Logging it here is enough — pg-pool already
 * discards the broken client and opens a fresh one on the next
 * checkout, so no other recovery action is needed.
 */
pool.on("error", (err) => {
  console.error("Unexpected error on idle DB client:", err.message);
});

module.exports = pool;
