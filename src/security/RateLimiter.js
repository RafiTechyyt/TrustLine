// RateLimiter.js — fixed-window throttling with privacy-safe keys.
//
// The key handed in here is always the output of ephemeralKey(): a hash salted
// with a value that lives in memory only. So the limiter can tell "this is the
// same caller as a minute ago" without ever holding anything that identifies a
// person, and the moment the process stops, so does that ability.

import { RateLimitError } from "../lib/errors.js";

export class RateLimiter {
  #windows = new Map();
  #nextSweep = 0;

  /** @param {{windowMs:number, max:number}} rule */
  check(rule, key) {
    const now = Date.now();
    this.#sweep(now);
    const id = `${rule.windowMs}:${rule.max}:${key}`;
    const window = this.#windows.get(id);

    if (!window || window.resetAt <= now) {
      this.#windows.set(id, { count: 1, resetAt: now + rule.windowMs });
      return { remaining: rule.max - 1, resetAt: now + rule.windowMs };
    }

    if (window.count >= rule.max) {
      throw new RateLimitError(Math.max(1, Math.ceil((window.resetAt - now) / 1000)));
    }

    window.count += 1;
    return { remaining: rule.max - window.count, resetAt: window.resetAt };
  }

  /** Lets a successful login clear the failure budget for that address. */
  clear(rule, key) {
    this.#windows.delete(`${rule.windowMs}:${rule.max}:${key}`);
    return this;
  }

  get size() { return this.#windows.size; }

  #sweep(now) {
    if (now < this.#nextSweep) return;
    this.#nextSweep = now + 60_000;
    for (const [id, window] of this.#windows) {
      if (window.resetAt <= now) this.#windows.delete(id);
    }
  }
}

export const limiter = new RateLimiter();
