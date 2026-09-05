// index.js — the service container. Composition root, and the only place in the
// codebase where two concrete classes meet.
//
// Every service takes its collaborators as constructor arguments and never
// reaches for a global, which is what makes them testable in isolation and what
// makes the wiring below the whole dependency graph of the application. Read this
// file and you know what TrustLine is made of.
//
// Boot order matters in exactly two places: the store must be loaded before any
// service reads it, and the subscribers must be registered before the first
// event is emitted. Everything else is order-independent by construction.

import { DataStore } from "../repositories/index.js";
import { EventBus } from "../core/events/EventBus.js";
import { ModerationService } from "./ModerationService.js";
import { SimilarityService } from "./SimilarityService.js";
import { SessionService } from "./SessionService.js";
import { AuthService } from "./AuthService.js";
import { CollegeService } from "./CollegeService.js";
import { CatalogService } from "./CatalogService.js";
import { ComplaintService } from "./ComplaintService.js";
import { ThreadService } from "./ThreadService.js";
import { SlaService } from "./SlaService.js";
import { AnalyticsService } from "./AnalyticsService.js";
import { AnnouncementService } from "./AnnouncementService.js";
import { AuditTrail, LiveFeed, EventCounter } from "./subscribers.js";

export class Container {
  #db; #bus; #services; #subscribers; #sla; #owner = null; #booted = false;

  constructor({ db = new DataStore(), bus = new EventBus() } = {}) {
    this.#db = db;
    this.#bus = bus;

    const deps = { db, bus };
    const moderation = new ModerationService();
    const similarity = new SimilarityService();
    const complaints = new ComplaintService({ ...deps, moderation, similarity });

    this.#sla = new SlaService({ ...deps, complaints });
    this.#services = Object.freeze({
      moderation,
      similarity,
      sessions: new SessionService({ accounts: db.accounts }),
      auth: new AuthService(deps),
      colleges: new CollegeService(deps),
      catalog: new CatalogService(deps),
      complaints,
      threads: new ThreadService({ ...deps, moderation }),
      sla: this.#sla,
      analytics: new AnalyticsService(deps),
      announcements: new AnnouncementService(deps),
    });

    // Observers, not callers. Nothing above holds a reference to anything here.
    this.#subscribers = Object.freeze({
      audit: new AuditTrail({ db }),
      live: new LiveFeed(),
      counter: new EventCounter(),
    });
    for (const subscriber of Object.values(this.#subscribers)) bus.register(subscriber);
  }

  get db() { return this.#db; }
  get bus() { return this.#bus; }
  get services() { return this.#services; }
  /** Read by the public /api/health probe, which is allowed to know this and nothing else. */
  get booted() { return this.#booted; }
  get live() { return this.#subscribers.live; }
  get counter() { return this.#subscribers.counter; }
  get owner() { return this.#owner; }

  /** Loads the store, guarantees a platform owner, then starts the SLA clock. */
  async boot({ startClock = true } = {}) {
    if (this.#booted) return { container: this, owner: this.#owner };
    await this.#db.ready();
    this.#owner = await this.#services.auth.bootstrap();
    if (startClock) this.#sla.start();
    this.#booted = true;
    return { container: this, owner: this.#owner };
  }

  async shutdown() {
    this.#sla.stop();
    await this.#db.flush();
    return this;
  }

  /** Powers /health and the platform console's system strip. */
  status() {
    return {
      booted: this.#booted,
      counts: this.#db.counts(),
      events: this.#subscribers.counter.snapshot,
      listeners: this.#bus.describe(),
      sla: this.#sla.stats,
      liveClients: this.#subscribers.live.clientCount,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}

/** One container per process. The seed script builds its own instead. */
export async function boot(options = {}) {
  const container = new Container(options);
  const { owner } = await container.boot(options);
  return { container, owner, services: container.services, db: container.db, bus: container.bus };
}

export {
  DataStore, EventBus, ModerationService, SimilarityService, SessionService, AuthService,
  CollegeService, CatalogService, ComplaintService, ThreadService, SlaService,
  AnalyticsService, AnnouncementService, AuditTrail, LiveFeed, EventCounter,
};
