// Account.js — abstract base for everyone who signs in.
//
// A reporter never has an account. Only three kinds of people do, and each one
// answers the same three questions differently:
//
//   role              — what am I called?
//   can(permission)   — am I allowed to do this?
//   canRead(report)   — am I allowed to see this particular report?
//
// The HTTP layer only ever calls those three. That is polymorphism carrying the
// whole authorisation model: no `if (role === ...)` anywhere outside this folder.

import { Entity } from "../Entity.js";
import { hashSecret, verifySecret } from "../../lib/crypto.js";
import { ACCOUNT_STATUS } from "./permissions.js";

export class Account extends Entity {
  #email;
  #name;
  #title;
  #secret;
  #status;
  #collegeId;
  #departmentIds;
  #lastSeenAt;
  #reviewedBy;
  #reviewedAt;
  #reviewNote;

  constructor({
    email, name, title = "", secret = null, password = null,
    status = ACCOUNT_STATUS.PENDING, collegeId = null, departmentIds = [],
    lastSeenAt = null, reviewedBy = null, reviewedAt = null, reviewNote = "",
    ...base
  } = {}) {
    super(base);
    if (new.target === Account) {
      throw new TypeError("Account is abstract — use SuperAdmin, CollegeAdmin or DepartmentOfficer");
    }
    this.#email = String(email || "").trim().toLowerCase();
    this.#name = String(name || "").trim();
    this.#title = String(title || "").trim();
    this.#secret = secret || (password ? hashSecret(password) : null);
    this.#status = status;
    this.#collegeId = collegeId;
    this.#departmentIds = Array.isArray(departmentIds) ? [...departmentIds] : [];
    this.#lastSeenAt = lastSeenAt;
    this.#reviewedBy = reviewedBy;
    this.#reviewedAt = reviewedAt;
    this.#reviewNote = reviewNote;
  }

  static get idPrefix() { return "acc"; }

  /** @abstract */
  get role() { throw new Error(`${this.constructor.name} must define role`); }

  /** @abstract A Set of permission strings. */
  static get permissions() { return new Set(); }

  /** @abstract Human sentence describing what this account reaches. */
  get scopeLabel() { return "this account"; }

  get email() { return this.#email; }
  get name() { return this.#name; }
  get title() { return this.#title; }
  get status() { return this.#status; }
  get collegeId() { return this.#collegeId; }
  get departmentIds() { return [...this.#departmentIds]; }
  get lastSeenAt() { return this.#lastSeenAt; }
  get reviewedBy() { return this.#reviewedBy; }
  get reviewNote() { return this.#reviewNote; }
  get isActive() { return this.#status === ACCOUNT_STATUS.ACTIVE; }
  get isPending() { return this.#status === ACCOUNT_STATUS.PENDING; }
  get hasPassword() { return Boolean(this.#secret); }

  can(permission) {
    return this.constructor.permissions.has(permission);
  }

  /** @abstract Overridden per role — this is the real access boundary. */
  canRead(_report) { return false; }

  /** Only an active account can sign in, however correct the password is. */
  authenticate(password) {
    if (!this.#secret || !this.isActive) return false;
    return verifySecret(password, this.#secret);
  }

  /** Used by the login flow to tell "wrong password" from "not approved yet". */
  passwordMatches(password) {
    return Boolean(this.#secret) && verifySecret(password, this.#secret);
  }

  setPassword(plain) {
    this.#secret = hashSecret(plain);
    return this.touch();
  }

  approve(reviewerId, note = "") {
    this.#status = ACCOUNT_STATUS.ACTIVE;
    this.#reviewedBy = reviewerId;
    this.#reviewedAt = Date.now();
    this.#reviewNote = note;
    return this.touch();
  }

  reject(reviewerId, note = "") {
    this.#status = ACCOUNT_STATUS.REJECTED;
    this.#reviewedBy = reviewerId;
    this.#reviewedAt = Date.now();
    this.#reviewNote = note;
    return this.touch();
  }

  suspend(reviewerId, note = "") {
    this.#status = ACCOUNT_STATUS.SUSPENDED;
    this.#reviewedBy = reviewerId;
    this.#reviewedAt = Date.now();
    this.#reviewNote = note;
    return this.touch();
  }

  reinstate(reviewerId) { return this.approve(reviewerId, "Reinstated"); }

  markSeen() {
    this.#lastSeenAt = Date.now();
    return this.touch();
  }

  rename(name, title) {
    if (name) this.#name = String(name).trim();
    if (title !== undefined) this.#title = String(title).trim();
    return this.touch();
  }

  assignDepartments(ids) {
    this.#departmentIds = [...new Set((ids || []).filter(Boolean))];
    return this.touch();
  }

  serialise() {
    return {
      role: this.role,
      email: this.#email,
      name: this.#name,
      title: this.#title,
      secret: this.#secret,
      status: this.#status,
      collegeId: this.#collegeId,
      departmentIds: [...this.#departmentIds],
      lastSeenAt: this.#lastSeenAt,
      reviewedBy: this.#reviewedBy,
      reviewedAt: this.#reviewedAt,
      reviewNote: this.#reviewNote,
    };
  }

  /** Everything the browser is allowed to know. Note: no `secret`. */
  profile() {
    const { secret, ...safe } = this.toJSON();
    return { ...safe, scopeLabel: this.scopeLabel, permissions: [...this.constructor.permissions] };
  }
}
