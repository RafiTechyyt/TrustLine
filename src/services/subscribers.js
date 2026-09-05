// subscribers.js — OBSERVER PATTERN, the concrete half.
//
// Nothing in this file is imported by any service. Each class below is registered
// on the bus at boot, and that registration is the only wiring. Which is the
// point: filing a report writes an audit row, pushes a card onto every open
// dashboard, and keeps a rolling activity strip — and ComplaintService knows
// about none of it.
//
// Adding an email notifier later means one more class here and one more
// `bus.register(...)` line in the container. No existing file changes.

import { Subscriber, EV } from "../core/events/EventBus.js";
import { AuditEvent } from "../core/AuditEvent.js";

/**
 * Writes the audit trail. Reporter-side events arrive with no actor and are
 * stored that way — the trail holds the desk accountable, it does not profile
 * the people filing.
 */
export class AuditTrail extends Subscriber {
  #db;
  #pending = 0;

  constructor({ db }) {
    super();
    this.#db = db;
  }

  get name() { return "audit-trail"; }
  get events() { return ["*"]; }

  async handle(event, payload) {
    // Reads and previews never reach the bus, so everything that arrives here is
    // a change worth keeping. Signed-in is the one exception: useful for a
    // security page, useless as history, so it is kept but not linked to a report.
    const row = new AuditEvent({
      collegeId: payload.collegeId ?? null,
      complaintId: payload.complaintId ?? null,
      actorId: payload.actorId ?? null,
      actorLabel: payload.actorLabel ?? "TrustLine",
      actorRole: payload.actorRole ?? null,
      action: event,
      summary: payload.summary ?? event,
      meta: AuditTrail.#meta(payload),
    });
    this.#db.audit.insert(row);
    this.#pending += 1;
    // The trail is trimmed rather than rotated: a college's board only ever
    // shows the recent slice, and an unbounded file is a slow leak.
    if (this.#pending >= 25) {
      this.#pending = 0;
      this.#db.audit.trimTo(5000);
    }
    await this.#db.audit.flush();
  }

  static #meta(payload) {
    const { event, at, collegeId, complaintId, actorId, actorLabel, actorRole, summary, ...rest } = payload;
    return Object.keys(rest).length > 0 ? rest : null;
  }
}

/**
 * Fans events out to every browser watching a dashboard over SSE. Holds the
 * client list itself, so the HTTP layer only has to hand it a response stream.
 */
export class LiveFeed extends Subscriber {
  #clients = new Set();
  #history = [];

  get name() { return "live-feed"; }

  get events() {
    return [
      EV.REPORT_FILED, EV.REPORT_ROUTED, EV.REPORT_STATUS, EV.REPORT_PRIORITY,
      EV.REPORT_BACKED, EV.REPORT_MERGED, EV.REPORT_ESCALATED, EV.REPORT_RATED,
      EV.THREAD_MESSAGE, EV.CATALOG_CHANGED, EV.ANNOUNCEMENT_POSTED,
      EV.COLLEGE_REQUESTED, EV.COLLEGE_REVIEWED, EV.ACCOUNT_REQUESTED, EV.ACCOUNT_REVIEWED,
    ];
  }

  /**
   * @param {object} client
   * @param {(chunk:string)=>void} client.write
   * @param {string|null} client.collegeId  null = platform office, sees all colleges
   * @param {boolean} client.platform
   */
  subscribe(client) {
    this.#clients.add(client);
    for (const item of this.#history.filter((e) => LiveFeed.#visible(e, client)).slice(-12)) {
      client.write(LiveFeed.#frame(item));
    }
    return () => this.#clients.delete(client);
  }

  get clientCount() { return this.#clients.size; }

  recent(collegeId, limit = 30) {
    return this.#history
      .filter((item) => collegeId === null || item.collegeId === collegeId)
      .slice(-limit)
      .reverse();
  }

  async handle(event, payload) {
    const item = {
      id: `${payload.at}-${this.#history.length}`,
      event,
      at: payload.at,
      collegeId: payload.collegeId ?? null,
      complaintId: payload.complaintId ?? null,
      summary: payload.summary ?? event,
      actorLabel: payload.actorLabel ?? null,
      tone: LiveFeed.#tone(event),
    };
    this.#history.push(item);
    if (this.#history.length > 200) this.#history.shift();

    const frame = LiveFeed.#frame(item);
    for (const client of this.#clients) {
      if (!LiveFeed.#visible(item, client)) continue;
      try {
        client.write(frame);
      } catch {
        this.#clients.delete(client);
      }
    }
  }

  /** A college dashboard must never see another college's activity. */
  static #visible(item, client) {
    if (client.platform) return true;
    return item.collegeId === client.collegeId;
  }

  static #frame(item) {
    return `event: activity\ndata: ${JSON.stringify(item)}\n\n`;
  }

  static #tone(event) {
    if (event === EV.REPORT_ESCALATED) return "bad";
    if (event === EV.REPORT_FILED || event === EV.REPORT_BACKED) return "warn";
    if (event === EV.REPORT_RATED || event === EV.ANNOUNCEMENT_POSTED) return "good";
    return "neutral";
  }
}

/**
 * Keeps a counter per event name. Costs nothing and gives the platform console a
 * genuine "what is this system doing" strip instead of a mocked-up one.
 */
export class EventCounter extends Subscriber {
  #counts = new Map();
  #startedAt = Date.now();

  get name() { return "event-counter"; }
  get events() { return ["*"]; }

  async handle(event) {
    this.#counts.set(event, (this.#counts.get(event) ?? 0) + 1);
  }

  get snapshot() {
    return {
      since: this.#startedAt,
      total: [...this.#counts.values()].reduce((sum, n) => sum + n, 0),
      byEvent: [...this.#counts.entries()]
        .map(([event, count]) => ({ event, count }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
