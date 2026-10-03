'use strict';
/* ---------------------------------------------------------------------------
 * SIKO DEV — Restart-Safe Persistent Store
 * ---------------------------------------------------------------------------
 * The bug this fixes: if you load a JSON file into an in-memory object once
 * at startup, let the bot mutate that in-memory copy, and only write it back
 * to disk occasionally — then the moment TWO things touch the same file
 * (your bot process AND your web server process, or just a restart racing a
 * write), whichever one saves LAST wins and silently overwrites the other's
 * changes. That's exactly how "customer activates a license, bot restarts,
 * license looks unused again" bugs happen.
 *
 * The fix: never hold a long-lived in-memory copy of shared state. Every
 * read goes to disk. Every write is atomic (write to a temp file, then
 * rename — rename is atomic on POSIX filesystems, so a crash mid-write
 * never leaves a half-written file). A simple in-process queue serializes
 * writes to the same key so two "activate license" calls arriving at the
 * same millisecond can't both read-modify-write and clobber each other.
 * ------------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');

class JsonStore {
  /**
   * @param {string} filePath Absolute path to the JSON file this store owns.
   * @param {*} defaultValue  Value to use if the file doesn't exist yet.
   */
  constructor(filePath, defaultValue = {}) {
    this.filePath = filePath;
    this.defaultValue = defaultValue;
    this._writeQueue = Promise.resolve(); // serializes writes to THIS store
    this._ensureDir();
  }

  _ensureDir() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
  }

  /** Always reads fresh from disk. Never trust an in-memory cache for shared state. */
  read() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return JSON.parse(JSON.stringify(this.defaultValue)); // deep clone
      }
      // Corrupt file (e.g. crash mid-write before this class was in place).
      // Don't silently eat the data — surface it so you notice.
      throw new Error(`[SIKO DEV store] Failed to read/parse ${this.filePath}: ${err.message}`);
    }
  }

  /** Atomic write: tmp file + rename. Safe against crashes mid-write. */
  _writeAtomic(data) {
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  /**
   * Read-modify-write under this store's queue, so concurrent calls from the
   * same process never interleave. `mutator(current)` returns the new value.
   */
  async update(mutator) {
    const task = this._writeQueue.then(async () => {
      const current = this.read();
      const next = await mutator(current);
      this._writeAtomic(next);
      return next;
    });
    // Keep the queue alive even if this task rejects, so later writes still run.
    this._writeQueue = task.catch(() => {});
    return task;
  }

  /** Plain overwrite, still atomic. Prefer update() when you need read-then-write. */
  async write(data) {
    return this.update(() => data);
  }
}

/**
 * Cross-PROCESS lock (bot + web server are separate Node processes, so an
 * in-process queue alone isn't enough once both touch the same file).
 * Uses a lockfile with exclusive-create ('wx'); if it already exists,
 * another process holds the lock, so we poll briefly and retry.
 */
async function withFileLock(lockPath, fn, { timeoutMs = 5000, pollMs = 25 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx'); // fails if it already exists
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`[SIKO DEV store] Timed out waiting for lock ${lockPath}`);
      }
      await new Promise(r => setTimeout(r, pollMs));
    }
  }
  try {
    return await fn();
  } finally {
    try { fs.unlinkSync(lockPath); } catch (_) { /* already gone, fine */ }
  }
}

module.exports = { JsonStore, withFileLock };
