// Message.js — one entry in a report's thread.
//
// Three kinds of author, and one flag that matters a great deal: `internal`.
// An internal note is a desk-only aside. It is filtered out server-side in
// ThreadService, never client-side, so it cannot leak by way of a bug in the UI.

import { Entity } from "./Entity.js";
import { AUTHOR_TYPE } from "./enums.js";

export class Message extends Entity {
  #complaintId; #authorType; #authorId; #authorLabel;
  #body; #internal; #kind; #meta; #readByDesk; #readByReporter;

  constructor({
    complaintId, authorType = AUTHOR_TYPE.SYSTEM, authorId = null, authorLabel = "TrustLine",
    body = "", internal = false, kind = "message", meta = null,
    readByDesk = false, readByReporter = false, ...base
  } = {}) {
    super(base);
    this.#complaintId = complaintId;
    this.#authorType = authorType;
    this.#authorId = authorId;
    this.#authorLabel = String(authorLabel || "").trim();
    this.#body = String(body || "").trim();
    this.#internal = Boolean(internal);
    this.#kind = kind;
    this.#meta = meta;
    this.#readByDesk = Boolean(readByDesk);
    this.#readByReporter = Boolean(readByReporter);
  }

  static get idPrefix() { return "msg"; }

  get complaintId() { return this.#complaintId; }
  get authorType() { return this.#authorType; }
  get authorId() { return this.#authorId; }
  get authorLabel() { return this.#authorLabel; }
  get body() { return this.#body; }
  get internal() { return this.#internal; }
  get kind() { return this.#kind; }
  get meta() { return this.#meta ? { ...this.#meta } : null; }
  get fromReporter() { return this.#authorType === AUTHOR_TYPE.REPORTER; }
  get fromDesk() { return this.#authorType === AUTHOR_TYPE.OFFICER; }
  get isSystem() { return this.#authorType === AUTHOR_TYPE.SYSTEM; }
  get readByDesk() { return this.#readByDesk; }
  get readByReporter() { return this.#readByReporter; }

  markRead({ desk = false, reporter = false } = {}) {
    if (desk) this.#readByDesk = true;
    if (reporter) this.#readByReporter = true;
    return this.touch();
  }

  serialise() {
    return {
      complaintId: this.#complaintId, authorType: this.#authorType, authorId: this.#authorId,
      authorLabel: this.#authorLabel, body: this.#body, internal: this.#internal,
      kind: this.#kind, meta: this.#meta,
      readByDesk: this.#readByDesk, readByReporter: this.#readByReporter,
    };
  }

  view() {
    return {
      id: this.id, at: this.createdAt, authorType: this.#authorType,
      authorLabel: this.#authorLabel, body: this.#body, kind: this.#kind,
      internal: this.#internal, meta: this.meta,
    };
  }
}
