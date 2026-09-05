// College.js — a tenant. Everything else in the system hangs off one of these.
//
// A college signs itself up and stays `pending` until the platform office
// approves it. Until then its admin can sign in but sees only a waiting screen,
// and no reporter can file against it.

import { Entity } from "./Entity.js";
import { COLLEGE_STATUS } from "./enums.js";
import { slugify } from "../lib/ids.js";

export class College extends Entity {
  #name; #shortName; #slug; #city; #state; #university;
  #emailDomain; #status; #settings; #contactEmail;
  #requestedBy; #reviewedBy; #reviewedAt; #reviewNote;

  static DEFAULT_SETTINGS = Object.freeze({
    publicFeed: true,
    allowVisitorReports: true,
    defaultSlaHours: 72,
    requirePassphrase: false,
    autoCloseAfterDays: 14,
    motto: "",
  });

  constructor({
    name, shortName = "", slug, city = "", state = "Kerala", university = "",
    emailDomain = "", status = COLLEGE_STATUS.PENDING, settings = {}, contactEmail = "",
    requestedBy = null, reviewedBy = null, reviewedAt = null, reviewNote = "",
    ...base
  } = {}) {
    super(base);
    this.#name = String(name || "").trim();
    this.#shortName = String(shortName || "").trim();
    this.#slug = slug || slugify(this.#name, "college");
    this.#city = String(city || "").trim();
    this.#state = String(state || "").trim();
    this.#university = String(university || "").trim();
    this.#emailDomain = String(emailDomain || "").trim().toLowerCase().replace(/^@/, "");
    this.#status = status;
    this.#settings = { ...College.DEFAULT_SETTINGS, ...settings };
    this.#contactEmail = String(contactEmail || "").trim().toLowerCase();
    this.#requestedBy = requestedBy;
    this.#reviewedBy = reviewedBy;
    this.#reviewedAt = reviewedAt;
    this.#reviewNote = reviewNote;
  }

  static get idPrefix() { return "clg"; }

  get name() { return this.#name; }
  get shortName() { return this.#shortName || this.#name; }
  get slug() { return this.#slug; }
  get city() { return this.#city; }
  get state() { return this.#state; }
  get university() { return this.#university; }
  get emailDomain() { return this.#emailDomain; }
  get status() { return this.#status; }
  get contactEmail() { return this.#contactEmail; }
  get requestedBy() { return this.#requestedBy; }
  get reviewNote() { return this.#reviewNote; }
  get settings() { return { ...this.#settings }; }
  get isLive() { return this.#status === COLLEGE_STATUS.ACTIVE; }
  get acceptsReports() { return this.isLive; }
  get place() { return [this.#city, this.#state].filter(Boolean).join(", "); }

  approve(reviewerId, note = "") {
    this.#status = COLLEGE_STATUS.ACTIVE;
    this.#reviewedBy = reviewerId;
    this.#reviewedAt = Date.now();
    this.#reviewNote = note;
    return this.touch();
  }

  reject(reviewerId, note = "") {
    this.#status = COLLEGE_STATUS.REJECTED;
    this.#reviewedBy = reviewerId;
    this.#reviewedAt = Date.now();
    this.#reviewNote = note;
    return this.touch();
  }

  suspend(reviewerId, note = "") {
    this.#status = COLLEGE_STATUS.SUSPENDED;
    this.#reviewedBy = reviewerId;
    this.#reviewedAt = Date.now();
    this.#reviewNote = note;
    return this.touch();
  }

  updateSettings(patch = {}) {
    const next = { ...this.#settings };
    for (const key of Object.keys(College.DEFAULT_SETTINGS)) {
      if (patch[key] !== undefined) next[key] = patch[key];
    }
    next.defaultSlaHours = Math.min(720, Math.max(1, Number(next.defaultSlaHours) || 72));
    next.autoCloseAfterDays = Math.min(120, Math.max(1, Number(next.autoCloseAfterDays) || 14));
    this.#settings = next;
    return this.touch();
  }

  updateProfile({ name, shortName, city, state, university, emailDomain, contactEmail }) {
    if (name) this.#name = String(name).trim();
    if (shortName !== undefined) this.#shortName = String(shortName).trim();
    if (city !== undefined) this.#city = String(city).trim();
    if (state !== undefined) this.#state = String(state).trim();
    if (university !== undefined) this.#university = String(university).trim();
    if (emailDomain !== undefined) this.#emailDomain = String(emailDomain).trim().toLowerCase().replace(/^@/, "");
    if (contactEmail !== undefined) this.#contactEmail = String(contactEmail).trim().toLowerCase();
    return this.touch();
  }

  serialise() {
    return {
      name: this.#name, shortName: this.#shortName, slug: this.#slug,
      city: this.#city, state: this.#state, university: this.#university,
      emailDomain: this.#emailDomain, status: this.#status, settings: { ...this.#settings },
      contactEmail: this.#contactEmail, requestedBy: this.#requestedBy,
      reviewedBy: this.#reviewedBy, reviewedAt: this.#reviewedAt, reviewNote: this.#reviewNote,
    };
  }

  /** Safe for the college picker on the landing page. */
  publicView() {
    return {
      id: this.id, name: this.#name, shortName: this.shortName, slug: this.#slug,
      place: this.place, university: this.#university, status: this.#status,
      motto: this.#settings.motto, publicFeed: this.#settings.publicFeed,
      allowVisitorReports: this.#settings.allowVisitorReports,
      requirePassphrase: this.#settings.requirePassphrase,
    };
  }
}
