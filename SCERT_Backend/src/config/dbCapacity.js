/**
 * Single source of truth for how many Postgres connections this process
 * tree is allowed to open.
 *
 * The cluster master and every worker both need these numbers — the master
 * to decide how many workers to fork, each worker to size its pg pool — and
 * they must agree. Keeping the arithmetic in one module is what stops the
 * two drifting apart, which is exactly what happened before: server.js
 * carried a comment reading "3 workers x 8 pool.max = 24 connections" long
 * after db.js had been changed to max: 20, so the real total was 60 against
 * a server max_connections of 60 — the entire budget, with nothing left for
 * psql, migrations, backups or the platform's own connections.
 *
 * Everything is overridable by environment variable so production can be
 * tuned without a code change:
 *
 *   DB_MAX_CONNECTIONS  what the database itself allows   (default 60)
 *   DB_CONNECTION_BUDGET_PCT  share this app may consume  (default 60%)
 *   CLUSTER_WORKERS     number of forked workers          (default min(cpus, 3))
 *   DB_POOL_MAX         pool size per worker              (default = derived)
 */

const os = require("os");

function intFromEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/**
 * How many connections this app may open in total, across every client.
 *
 * IMPORTANT: when connecting through a pooler (Supabase Supavisor,
 * PgBouncer), this is the POOLER's limit, not the Postgres server's
 * max_connections. Those differ by a lot and reading the wrong one breaks
 * the app: pg_settings reported max_connections = 60 on the Supabase dev
 * database, but the pooler in session mode (port 5432) allows only
 * pool_size = 15, so a 36-connection config produced
 *   FATAL (EMAXCONNSESSION) max clients reached in session mode
 * on ordinary report traffic.
 *
 * Correct values by environment:
 *   Supabase pooler, transaction mode (6543) : ~60
 *   Supabase pooler, session mode (5432)     : 15  <- hard ceiling
 *   Direct Postgres (your own VM, no pooler) : that server's max_connections
 *
 * The default is deliberately conservative: 20 yields 3 workers x 4 = 12
 * connections, which stays under even the tightest session-mode limit.
 * Every real deployment should set DB_MAX_CONNECTIONS explicitly.
 */
const DB_MAX_CONNECTIONS = intFromEnv("DB_MAX_CONNECTIONS", 20);

/**
 * Fraction of the server's connections this app may claim. The remainder is
 * deliberately left for psql sessions, migrations, monitoring, backups and
 * (on a managed platform) the provider's own internal connections — on the
 * current database 13 were already in use before the app started.
 */
const BUDGET_PCT = Math.min(90, intFromEnv("DB_CONNECTION_BUDGET_PCT", 60));

const CLUSTER_WORKERS = intFromEnv(
  "CLUSTER_WORKERS",
  Math.min(os.cpus().length || 1, 3)
);

/** Connections this app may use in total, across all workers. */
const APP_CONNECTION_BUDGET = Math.max(
  CLUSTER_WORKERS,
  Math.floor((DB_MAX_CONNECTIONS * BUDGET_PCT) / 100)
);

/**
 * Per-worker pool size. Derived from the budget so it can never be set to a
 * value that, multiplied by the worker count, exceeds what the database
 * allows. An explicit DB_POOL_MAX still wins, but is clamped to the budget.
 */
const derivedPoolMax = Math.max(2, Math.floor(APP_CONNECTION_BUDGET / CLUSTER_WORKERS));
const DB_POOL_MAX = Math.min(
  intFromEnv("DB_POOL_MAX", derivedPoolMax),
  derivedPoolMax
);

const TOTAL_APP_CONNECTIONS = DB_POOL_MAX * CLUSTER_WORKERS;

/** Printed once by the master so the real numbers are visible in the logs. */
function describe() {
  return (
    `DB capacity: ${CLUSTER_WORKERS} workers x ${DB_POOL_MAX} pool = ` +
    `${TOTAL_APP_CONNECTIONS} connections ` +
    `(budget ${APP_CONNECTION_BUDGET} of ${DB_MAX_CONNECTIONS} = ${BUDGET_PCT}%, ` +
    `${DB_MAX_CONNECTIONS - TOTAL_APP_CONNECTIONS} left for admin/other clients)`
  );
}

module.exports = {
  DB_MAX_CONNECTIONS,
  CLUSTER_WORKERS,
  DB_POOL_MAX,
  APP_CONNECTION_BUDGET,
  TOTAL_APP_CONNECTIONS,
  describe,
};
