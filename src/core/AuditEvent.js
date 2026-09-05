// AuditEvent.js — an append-only record of who did what at a desk.
//
// Deliberately asymmetric: actions taken *by* accounts are logged in detail,
// actions taken by reporters are logged without any actor at all. The audit
// trail exists to hold the desk accountable, not to profile the people filing.

import { Entity } from "./Entity.js";

export class AuditEvent extends Entity {
  #collegeId; #complaintId; #actorId; #actorLabel; #actorRole; #action; #summary; #meta;

  constructor({
    collegeId = null, complaintId = null, actorId = null, actorLabel = "system",
    actorRole = null, action = "", summary = "", meta = null, ...base
  } = {}) {
    super(base);
    this.#collegeId = collegeId;
    this.#complaintId = complaintId;
    this.#actorId = actorId;
    this.#actorLabel = actorLabel;
    this.#actorRole = actorRole;
    this.#action = action;
    this.#summary = summary;
    this.#meta = meta;
  }

  static get idPrefix() { return "evt"; }

  get collegeId() { return this.#collegeId; }
  get complaintId() { return this.#complaintId; }
  get action() { return this.#action; }
  get summary() { return this.#summary; }
  get actorLabel() { return this.#actorLabel; }
  get meta() { return this.#meta ? { ...this.#meta } : null; }

  serialise() {
    return {
      collegeId: this.#collegeId, complaintId: this.#complaintId,
      actorId: this.#actorId, actorLabel: this.#actorLabel, actorRole: this.#actorRole,
      action: this.#action, summary: this.#summary, meta: this.#meta,
    };
  }

  view() {
    return {
      id: this.id, at: this.createdAt, action: this.#action,
      summary: this.#summary, actorLabel: this.#actorLabel,
      actorRole: this.#actorRole, complaintId: this.#complaintId, meta: this.meta,
    };
  }
}
