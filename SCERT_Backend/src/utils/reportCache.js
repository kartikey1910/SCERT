/**
 * On-disk cache for generated report files (PDF / XLSX).
 *
 * Officers re-download the same report repeatedly — the same district's
 * selected-candidate list, the same block, the same class — and every
 * request currently re-runs the query and re-renders the whole document.
 * Rendering a 3,468-row PDF costs ~780 ms of pure CPU on the worker
 * thread, so a cache hit is the difference between that and a file read.
 *
 * Disk rather than Redis: these files run to hundreds of kilobytes, which
 * is the wrong shape for Redis, and the filesystem is already shared by
 * every cluster worker on the host, so one worker's render serves the
 * others.
 *
 * Correctness: the cache key includes a caller-supplied data version, so
 * a re-upload or a publish/unpublish produces a different key rather than
 * serving a stale file. Nothing here needs explicit invalidation.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const CACHE_DIR =
  process.env.REPORT_CACHE_DIR || path.join(os.tmpdir(), "scert-report-cache");

/** Entries older than this are ignored and swept. */
const TTL_MS = Number(process.env.REPORT_CACHE_TTL_MS) || 30 * 60 * 1000;

/** Guard against the cache growing without bound on a small disk. */
const MAX_CACHE_BYTES = Number(process.env.REPORT_CACHE_MAX_BYTES) || 256 * 1024 * 1024;

let ensured = false;
async function ensureDir() {
  if (ensured) return;
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  ensured = true;
}

/**
 * Serialises a value with object keys sorted at every depth, so two
 * equivalent descriptors always produce the same string regardless of the
 * order their properties happened to be built in.
 *
 * Written by hand rather than using JSON.stringify's second argument: an
 * ARRAY there is a property ALLOWLIST applied recursively, not a key
 * sorter. Passing Object.keys(parts).sort() silently reduced nested
 * objects to {} — "filters" and "scope" both vanished from the key — so
 * every filter combination collided on one entry and a class-filtered
 * download was served the unfiltered file.
 */
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/**
 * Builds a cache key. `parts` should carry everything that changes the
 * output — scope, filters, format — plus a dataVersion that changes when
 * the underlying rows change.
 */
function buildKey(parts) {
  return crypto.createHash("sha256").update(stableStringify(parts)).digest("hex").slice(0, 40);
}

function filePathFor(key, ext) {
  return path.join(CACHE_DIR, `${key}.${ext}`);
}

/** Returns the cached buffer, or null when absent/expired/unreadable. */
async function read(key, ext) {
  try {
    const p = filePathFor(key, ext);
    const stat = await fsp.stat(p);
    if (Date.now() - stat.mtimeMs > TTL_MS) return null;
    return await fsp.readFile(p);
  } catch {
    // Missing file is the normal miss path; anything else (permissions, a
    // half-written file) is treated the same way — regenerate.
    return null;
  }
}

/**
 * Writes via a temp file then renames, so a reader can never observe a
 * partially-written document. Cache failures are swallowed: a broken
 * cache must never break a download.
 */
async function write(key, ext, buffer) {
  try {
    await ensureDir();
    const finalPath = filePathFor(key, ext);
    const tmpPath = `${finalPath}.${process.pid}.tmp`;
    await fsp.writeFile(tmpPath, buffer);
    await fsp.rename(tmpPath, finalPath);
    sweep().catch(() => {});
  } catch (err) {
    console.error("reportCache write failed (non-fatal):", err.message);
  }
}

/**
 * Removes expired entries, then oldest-first while over the size cap.
 * Runs opportunistically after a write, never on the read path.
 */
let sweeping = false;
async function sweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    await ensureDir();
    const names = await fsp.readdir(CACHE_DIR);
    const now = Date.now();
    const entries = [];

    for (const name of names) {
      if (name.endsWith(".tmp")) continue;
      const p = path.join(CACHE_DIR, name);
      try {
        const st = await fsp.stat(p);
        if (now - st.mtimeMs > TTL_MS) {
          await fsp.unlink(p).catch(() => {});
        } else {
          entries.push({ p, size: st.size, mtime: st.mtimeMs });
        }
      } catch { /* vanished mid-sweep */ }
    }

    let total = entries.reduce((sum, e) => sum + e.size, 0);
    if (total <= MAX_CACHE_BYTES) return;

    entries.sort((a, b) => a.mtime - b.mtime); // oldest first
    for (const e of entries) {
      if (total <= MAX_CACHE_BYTES) break;
      await fsp.unlink(e.p).catch(() => {});
      total -= e.size;
    }
  } catch (err) {
    console.error("reportCache sweep failed (non-fatal):", err.message);
  } finally {
    sweeping = false;
  }
}

/**
 * Cache-aside helper: returns the cached buffer if present, otherwise
 * runs `produce()`, stores the result and returns it.
 *
 * Returns { buffer, hit } so callers can surface cache status in logs or
 * response headers.
 */
async function getOrCreate({ parts, ext }, produce) {
  const key = buildKey(parts);
  const cached = await read(key, ext);
  if (cached) return { buffer: cached, hit: true };

  const buffer = await produce();
  await write(key, ext, buffer);
  return { buffer, hit: false };
}

module.exports = { getOrCreate, buildKey, CACHE_DIR, TTL_MS };
