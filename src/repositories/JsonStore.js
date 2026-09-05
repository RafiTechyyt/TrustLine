// JsonStore.js — the only code in the project that touches the disk.
//
// Writes go to a temp file and then get renamed, which on every mainstream OS
// is atomic: a crash halfway through a save leaves the previous good file in
// place rather than a half-written one. Writes are also coalesced, so a burst of
// twenty changes in one request becomes one flush.

import fs from "node:fs/promises";
import path from "node:path";

export class JsonStore {
  #file;
  #rows = [];
  #loaded = false;
  #pending = null;
  #chain = Promise.resolve();

  constructor(directory, filename) {
    this.#file = path.join(directory, filename);
  }

  get file() { return this.#file; }

  async load() {
    if (this.#loaded) return this.#rows;
    try {
      const raw = await fs.readFile(this.#file, "utf8");
      const parsed = JSON.parse(raw);
      this.#rows = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code !== "ENOENT") {
        // A corrupt file is kept aside rather than silently overwritten.
        if (error instanceof SyntaxError) {
          await fs.rename(this.#file, `${this.#file}.corrupt-${Date.now()}`).catch(() => {});
          console.warn(`[store] ${path.basename(this.#file)} was unreadable and has been set aside`);
        } else {
          throw error;
        }
      }
      this.#rows = [];
    }
    this.#loaded = true;
    return this.#rows;
  }

  rows() { return this.#rows; }

  replace(rows) {
    this.#rows = rows;
    return this.schedule();
  }

  /** Coalesces many calls in the same tick into a single write. */
  schedule() {
    if (!this.#pending) {
      this.#pending = new Promise((resolve, reject) => {
        setImmediate(() => {
          this.#pending = null;
          this.#chain = this.#chain.then(() => this.#write()).then(resolve, reject);
        });
      });
    }
    return this.#pending;
  }

  async #write() {
    await fs.mkdir(path.dirname(this.#file), { recursive: true });
    const tmp = `${this.#file}.tmp-${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(this.#rows, null, 2), "utf8");
    await fs.rename(tmp, this.#file);
  }

  /** Waits for every queued write to land. Used by scripts and tests. */
  async flush() {
    if (this.#pending) await this.#pending;
    await this.#chain;
  }
}
