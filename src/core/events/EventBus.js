// EventBus.js — OBSERVER PATTERN.
//
// ComplaintService does not know that an audit trail exists, that a browser is
// watching a live feed, or that an escalation watcher is counting. It announces
// what happened and moves on. Everything reactive in the product is a subscriber
// registered at boot, which is why adding, say, an SMS notifier later touches
// exactly one file.

export const EV = Object.freeze({
  REPORT_FILED: "report.filed",
  REPORT_ROUTED: "report.routed",
  REPORT_STATUS: "report.status",
  REPORT_PRIORITY: "report.priority",
  REPORT_BACKED: "report.backed",
  REPORT_MERGED: "report.merged",
  REPORT_ESCALATED: "report.escalated",
  REPORT_RATED: "report.rated",
  THREAD_MESSAGE: "thread.message",
  COLLEGE_REQUESTED: "college.requested",
  COLLEGE_REVIEWED: "college.reviewed",
  ACCOUNT_REQUESTED: "account.requested",
  ACCOUNT_REVIEWED: "account.reviewed",
  ACCOUNT_SIGNED_IN: "account.signed_in",
  CATALOG_CHANGED: "catalog.changed",
  ANNOUNCEMENT_POSTED: "announcement.posted",
});

/** Base class for anything that wants to be told. */
export class Subscriber {
  constructor() {
    if (new.target === Subscriber) throw new TypeError("Subscriber is abstract");
  }

  /** @abstract */
  get name() { throw new Error(`${this.constructor.name} must define name`); }

  /** Event names, or ["*"] for everything. */
  get events() { return ["*"]; }

  /** @abstract */
  async handle(_event, _payload) { throw new Error(`${this.constructor.name} must implement handle()`); }
}

export class EventBus {
  #byEvent = new Map();
  #wildcards = new Set();
  #recent = [];
  #onError;

  constructor({ onError = null, historySize = 200 } = {}) {
    this.#onError = onError;
    this.historySize = historySize;
  }

  register(subscriber) {
    for (const event of subscriber.events) {
      if (event === "*") { this.#wildcards.add(subscriber); continue; }
      if (!this.#byEvent.has(event)) this.#byEvent.set(event, new Set());
      this.#byEvent.get(event).add(subscriber);
    }
    return this;
  }

  /** Convenience for one-off handlers that do not deserve a class. */
  on(event, handler, name = "inline") {
    const sub = new (class extends Subscriber {
      get name() { return name; }
      get events() { return [event]; }
      async handle(e, p) { return handler(e, p); }
    })();
    return this.register(sub);
  }

  off(subscriber) {
    this.#wildcards.delete(subscriber);
    for (const set of this.#byEvent.values()) set.delete(subscriber);
    return this;
  }

  listeners(event) {
    return [...(this.#byEvent.get(event) ?? []), ...this.#wildcards];
  }

  /**
   * Fire and forget by design: a failing audit writer must never take down the
   * request that filed a report. Errors go to the error hook, not the caller.
   */
  async emit(event, payload = {}) {
    const envelope = { event, at: Date.now(), ...payload };
    this.#recent.push({ event, at: envelope.at });
    if (this.#recent.length > this.historySize) this.#recent.shift();

    await Promise.all(this.listeners(event).map(async (sub) => {
      try {
        await sub.handle(event, envelope);
      } catch (error) {
        if (this.#onError) this.#onError(error, sub.name, event);
        else console.error(`[eventbus] ${sub.name} failed on ${event}:`, error.message);
      }
    }));
    return envelope;
  }

  get recent() { return [...this.#recent]; }

  describe() {
    const rows = [...this.#byEvent.entries()].map(([event, subs]) => ({
      event, subscribers: [...subs].map((s) => s.name),
    }));
    return { bound: rows, always: [...this.#wildcards].map((s) => s.name) };
  }
}
