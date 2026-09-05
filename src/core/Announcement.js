// Announcement.js — what the desk says back to the whole campus.
//
// Closes the loop: a feed full of complaints with no reply from the college is
// a wall of shouting. "Here is what we fixed this month" is what makes people
// file the next one.

import { Entity } from "./Entity.js";

export class Announcement extends Entity {
  #collegeId; #title; #body; #pinned; #authorId; #authorName; #linkedTraceCodes; #expiresAt;

  constructor({
    collegeId, title = "", body = "", pinned = false,
    authorId = null, authorName = "", linkedTraceCodes = [], expiresAt = null, ...base
  } = {}) {
    super(base);
    this.#collegeId = collegeId;
    this.#title = String(title || "").trim();
    this.#body = String(body || "").trim();
    this.#pinned = Boolean(pinned);
    this.#authorId = authorId;
    this.#authorName = String(authorName || "").trim();
    this.#linkedTraceCodes = Array.isArray(linkedTraceCodes) ? [...linkedTraceCodes] : [];
    this.#expiresAt = expiresAt;
  }

  static get idPrefix() { return "ann"; }

  get collegeId() { return this.#collegeId; }
  get title() { return this.#title; }
  get body() { return this.#body; }
  get pinned() { return this.#pinned; }
  get authorName() { return this.#authorName; }
  get linkedTraceCodes() { return [...this.#linkedTraceCodes]; }
  get expiresAt() { return this.#expiresAt; }
  get isLive() { return !this.#expiresAt || this.#expiresAt > Date.now(); }

  update({ title, body, pinned, linkedTraceCodes, expiresAt }) {
    if (title !== undefined) this.#title = String(title).trim();
    if (body !== undefined) this.#body = String(body).trim();
    if (pinned !== undefined) this.#pinned = Boolean(pinned);
    if (linkedTraceCodes !== undefined) this.#linkedTraceCodes = [...(linkedTraceCodes || [])];
    if (expiresAt !== undefined) this.#expiresAt = expiresAt;
    return this.touch();
  }

  serialise() {
    return {
      collegeId: this.#collegeId, title: this.#title, body: this.#body, pinned: this.#pinned,
      authorId: this.#authorId, authorName: this.#authorName,
      linkedTraceCodes: [...this.#linkedTraceCodes], expiresAt: this.#expiresAt,
    };
  }

  view() {
    return {
      id: this.id, title: this.#title, body: this.#body, pinned: this.#pinned,
      authorName: this.#authorName, at: this.createdAt,
      linkedTraceCodes: [...this.#linkedTraceCodes],
    };
  }
}
