// Complaint.js — the report itself, and the only place its rules live.
//
// Every field is private. A report cannot be put into an impossible state by
// assigning to it: the only way in is through a method that checks first. The
// status field holds a ComplaintState object rather than a string, so "can this
// move to resolved?" is answered by the state, not by this class.

import { Entity } from "./Entity.js";
import { STATUS, StateRegistry } from "./status/states.js";
import {
  PRIORITY, PRIORITY_RANK, VISIBILITY, CONTACT_SHARING,
} from "./enums.js";
import { ReporterFactory } from "./reporters/reporters.js";
import { newTraceCode, newHandle } from "../lib/ids.js";
import { hashSecret, verifySecret } from "../lib/crypto.js";
import { IllegalTransitionError } from "../lib/errors.js";
import { P } from "./accounts/permissions.js";

export class Complaint extends Entity {
  #collegeId; #categoryId; #departmentId; #assignedTo;
  #reporterKey; #handle; #title; #body;
  #status; #priority; #visibility;
  #secret; #contact;
  #supportCount; #supporters; #evidence; #tags; #location; #occurredAt;
  #dueAt; #acknowledgedAt; #resolvedAt; #closedAt; #lastActivityAt;
  #escalated; #escalationReason; #reopenCount;
  #mergedInto; #mergedFrom; #satisfaction; #feedback;
  #pausedAt; #pausedMs; #routingTrace;

  constructor({
    id, createdAt, updatedAt,
    collegeId, categoryId = null, departmentId = null, assignedTo = null,
    reporterKey = "visitor", handle = null, title = "", body = "",
    status = STATUS.SUBMITTED, priority = PRIORITY.NORMAL, visibility = VISIBILITY.PRIVATE,
    secret = null, passphrase = null,
    contact = null, supportCount = 0, supporters = [], evidence = [],
    tags = [], location = "", occurredAt = null,
    dueAt = null, acknowledgedAt = null, resolvedAt = null, closedAt = null, lastActivityAt = null,
    escalated = false, escalationReason = "", reopenCount = 0,
    mergedInto = null, mergedFrom = [], satisfaction = null, feedback = "",
    pausedAt = null, pausedMs = 0, routingTrace = [],
  } = {}) {
    super({ id: id || newTraceCode(), createdAt, updatedAt });
    this.#collegeId = collegeId;
    this.#categoryId = categoryId;
    this.#departmentId = departmentId;
    this.#assignedTo = assignedTo;
    this.#reporterKey = reporterKey;
    this.#handle = handle || newHandle();
    this.#title = String(title || "").trim();
    this.#body = String(body || "").trim();
    this.#status = StateRegistry.get(status);
    this.#priority = PRIORITY_RANK[priority] ? priority : PRIORITY.NORMAL;
    this.#visibility = visibility === VISIBILITY.PUBLIC ? VISIBILITY.PUBLIC : VISIBILITY.PRIVATE;
    this.#secret = secret || (passphrase ? hashSecret(passphrase) : null);
    this.#contact = contact || { sharing: CONTACT_SHARING.NONE, channel: null, value: null };
    this.#supportCount = Number(supportCount) || 0;
    this.#supporters = Array.isArray(supporters) ? [...supporters] : [];
    this.#evidence = Array.isArray(evidence) ? [...evidence] : [];
    this.#tags = Array.isArray(tags) ? [...tags] : [];
    this.#location = String(location || "");
    this.#occurredAt = occurredAt;
    this.#dueAt = dueAt;
    this.#acknowledgedAt = acknowledgedAt;
    this.#resolvedAt = resolvedAt;
    this.#closedAt = closedAt;
    this.#lastActivityAt = lastActivityAt || this.createdAt;
    this.#escalated = Boolean(escalated);
    this.#escalationReason = escalationReason;
    this.#reopenCount = Number(reopenCount) || 0;
    this.#mergedInto = mergedInto;
    this.#mergedFrom = Array.isArray(mergedFrom) ? [...mergedFrom] : [];
    this.#satisfaction = satisfaction;
    this.#feedback = feedback;
    this.#pausedAt = pausedAt;
    this.#pausedMs = Number(pausedMs) || 0;
    this.#routingTrace = Array.isArray(routingTrace) ? [...routingTrace] : [];
  }

  // ---- identity -----------------------------------------------------------

  get traceCode() { return this.id; }
  get collegeId() { return this.#collegeId; }
  get categoryId() { return this.#categoryId; }
  get departmentId() { return this.#departmentId; }
  get assignedTo() { return this.#assignedTo; }
  get handle() { return this.#handle; }
  get reporterKey() { return this.#reporterKey; }
  get reporter() { return ReporterFactory.create(this.#reporterKey); }
  get title() { return this.#title; }
  get body() { return this.#body; }
  get tags() { return [...this.#tags]; }
  get location() { return this.#location; }
  get occurredAt() { return this.#occurredAt; }
  get evidence() { return this.#evidence.map((e) => ({ ...e })); }
  get evidenceCount() { return this.#evidence.length; }
  get routingTrace() { return this.#routingTrace.map((r) => ({ ...r })); }

  // ---- status -------------------------------------------------------------

  get state() { return this.#status; }
  get status() { return this.#status.key; }
  get statusLabel() { return this.#status.label; }
  get isOpen() { return this.#status.isOpen; }
  get priority() { return this.#priority; }
  get priorityRank() { return PRIORITY_RANK[this.#priority]; }
  get visibility() { return this.#visibility; }
  get isPublic() { return this.#visibility === VISIBILITY.PUBLIC; }
  get supportCount() { return this.#supportCount; }
  get escalated() { return this.#escalated; }
  get escalationReason() { return this.#escalationReason; }
  get reopenCount() { return this.#reopenCount; }
  get mergedInto() { return this.#mergedInto; }
  get mergedFrom() { return [...this.#mergedFrom]; }
  get satisfaction() { return this.#satisfaction; }
  get feedback() { return this.#feedback; }
  get acknowledgedAt() { return this.#acknowledgedAt; }
  get resolvedAt() { return this.#resolvedAt; }
  get closedAt() { return this.#closedAt; }
  get dueAt() { return this.#dueAt; }
  get lastActivityAt() { return this.#lastActivityAt; }
  get hasPassphrase() { return Boolean(this.#secret); }

  // ---- response-time clock ------------------------------------------------
  //
  // The clock stops while the desk is waiting on the reporter, so a report is
  // never marked late for time the desk could not control.

  get pausedMs() {
    return this.#pausedMs + (this.#pausedAt ? Date.now() - this.#pausedAt : 0);
  }

  get elapsedMs() {
    const end = this.#resolvedAt || Date.now();
    return Math.max(0, end - this.createdAt - this.pausedMs);
  }

  get remainingMs() {
    if (!this.#dueAt || !this.#status.clockRuns) return null;
    return this.#dueAt + this.pausedMs - Date.now();
  }

  get isOverdue() {
    const left = this.remainingMs;
    return left !== null && left < 0;
  }

  get resolutionMs() {
    return this.#resolvedAt ? Math.max(0, this.#resolvedAt - this.createdAt - this.#pausedMs) : null;
  }

  setDueAt(timestamp) {
    this.#dueAt = timestamp;
    return this.touch();
  }

  // ---- the one way to change status ---------------------------------------

  /**
   * Asks the current state whether the move is legal, then hands control to the
   * new state's onEnter hook. Illegal moves throw rather than being ignored.
   */
  transitionTo(nextKey, context = {}) {
    if (nextKey === this.status) return this;
    if (!this.#status.canMoveTo(nextKey)) {
      throw new IllegalTransitionError(this.#status.label, StateRegistry.get(nextKey).label);
    }
    const wasPaused = !this.#status.clockRuns;
    const next = StateRegistry.get(nextKey);

    if (next.key === STATUS.IN_PROGRESS && !this.#status.isOpen) this.#reopenCount += 1;

    this.#status = next;
    if (wasPaused && next.clockRuns) this.#resumeClock();
    if (!wasPaused && !next.clockRuns && !next.isTerminal && next.isOpen) this.#pauseClock();
    if (next.isOpen) { this.#resolvedAt = null; this.#closedAt = null; }

    next.onEnter(this, context);
    return this.registerActivity();
  }

  #pauseClock() { if (!this.#pausedAt) this.#pausedAt = Date.now(); }

  #resumeClock() {
    if (this.#pausedAt) {
      this.#pausedMs += Date.now() - this.#pausedAt;
      this.#pausedAt = null;
    }
  }

  // Hooks the state classes call. Public because states are separate objects,
  // but each one only records a fact — none of them can pick the next status.
  stampAcknowledged() { if (!this.#acknowledgedAt) this.#acknowledgedAt = Date.now(); return this; }
  stampResolved() { this.#resolvedAt = Date.now(); this.#resumeClock(); return this; }
  stampClosed() { this.#closedAt = Date.now(); this.#resumeClock(); return this; }

  markEscalated(reason) {
    this.#escalated = true;
    this.#escalationReason = String(reason || "").slice(0, 240);
    return this;
  }

  registerActivity(at = Date.now()) {
    this.#lastActivityAt = at;
    return this.touch(at);
  }

  // ---- desk actions -------------------------------------------------------

  routeTo(departmentId, { categoryId, reason = "", strategy = "manual" } = {}) {
    this.#departmentId = departmentId;
    if (categoryId !== undefined) this.#categoryId = categoryId;
    this.#routingTrace.push({ at: Date.now(), departmentId, strategy, reason });
    if (this.#routingTrace.length > 12) this.#routingTrace.shift();
    return this.registerActivity();
  }

  setPriority(priority, { floor = PRIORITY.LOW } = {}) {
    const wanted = PRIORITY_RANK[priority] ? priority : PRIORITY.NORMAL;
    this.#priority = PRIORITY_RANK[wanted] >= PRIORITY_RANK[floor] ? wanted : floor;
    return this.touch();
  }

  claim(accountId) { this.#assignedTo = accountId; return this.registerActivity(); }
  release() { this.#assignedTo = null; return this.registerActivity(); }

  addTag(tag) {
    const clean = String(tag || "").trim().toLowerCase().slice(0, 32);
    if (clean && !this.#tags.includes(clean) && this.#tags.length < 12) this.#tags.push(clean);
    return this.touch();
  }

  removeTag(tag) {
    this.#tags = this.#tags.filter((t) => t !== tag);
    return this.touch();
  }

  attachEvidence(file) {
    this.#evidence.push({
      id: file.id, name: file.name, mime: file.mime, bytes: file.bytes, storedAs: file.storedAs,
    });
    return this.touch();
  }

  /** Folds a duplicate into this report, carrying its backing over. */
  absorb(other) {
    this.#mergedFrom = [...new Set([...this.#mergedFrom, other.traceCode])];
    this.#supportCount += other.supportCount + 1;
    this.#supporters = [...new Set([...this.#supporters, ...other.supporterKeys])];
    return this.registerActivity();
  }

  /**
   * Points this report at the one that absorbed it and takes it off the rail.
   *
   * Deliberately not a transitionTo: a duplicate is usually spotted minutes after
   * filing, while still in `submitted`, and "Received → Closed" is not a legal
   * desk move — rightly so, because a desk must never close a report without
   * answering it. A merge is not a desk closing a report; it is two records
   * becoming one. The trace code keeps working and now follows the survivor, so
   * nothing is lost by leaving the rail here.
   */
  markMergedInto(traceCode) {
    this.#mergedInto = traceCode;
    if (this.#status.isOpen) {
      this.#status = StateRegistry.get(STATUS.CLOSED);
      this.#status.onEnter(this, { reason: `Merged into ${traceCode}` });
    }
    return this.registerActivity();
  }

  // ---- reporter actions ---------------------------------------------------

  get supporterKeys() { return [...this.#supporters]; }

  /**
   * "I face this too." The key is a short-lived hash, not an identity — enough
   * to stop one browser backing the same report twice in a sitting, useless for
   * working out who did the backing.
   */
  addSupport(key) {
    if (key && this.#supporters.includes(key)) return false;
    if (key) {
      this.#supporters.push(key);
      if (this.#supporters.length > 5000) this.#supporters.shift();
    }
    this.#supportCount += 1;
    this.touch();
    return true;
  }

  setVisibility(visibility) {
    this.#visibility = visibility === VISIBILITY.PUBLIC ? VISIBILITY.PUBLIC : VISIBILITY.PRIVATE;
    return this.touch();
  }

  setPassphrase(plain) {
    this.#secret = plain ? hashSecret(plain) : null;
    return this.touch();
  }

  /** Trace code alone opens a report; a passphrase, if set, is also required. */
  unlocks(passphrase) {
    if (!this.#secret) return true;
    return verifySecret(passphrase ?? "", this.#secret);
  }

  /**
   * The reporter chooses, at any time, whether a desk may hold a way to reach
   * them. Default is nothing at all.
   */
  shareContact({ sharing, channel, value }) {
    if (sharing === CONTACT_SHARING.NONE || !value) {
      this.#contact = { sharing: CONTACT_SHARING.NONE, channel: null, value: null };
    } else {
      this.#contact = {
        sharing: sharing === CONTACT_SHARING.ADMIN_ONLY ? CONTACT_SHARING.ADMIN_ONLY : CONTACT_SHARING.DEPARTMENT,
        channel: channel === "phone" ? "phone" : "email",
        value: String(value).trim().slice(0, 120),
      };
    }
    return this.registerActivity();
  }

  get contactSharing() { return this.#contact.sharing; }
  get hasContact() { return this.#contact.sharing !== CONTACT_SHARING.NONE; }

  /**
   * The single gate on the one identifying field in the system. Returns null
   * unless the reporter opted in *and* this account is inside the circle they
   * opted in to *and* the account holds the contact-view permission.
   */
  contactFor(account) {
    if (!this.hasContact || !account?.can?.(P.REPORTS_CONTACT_VIEW)) return null;
    if (!account.canRead(this)) return null;
    if (this.#contact.sharing === CONTACT_SHARING.ADMIN_ONLY && !account.can(P.REPORTS_READ_ALL)) return null;
    return { channel: this.#contact.channel, value: this.#contact.value };
  }

  rate(score, note = "") {
    const n = Number(score);
    if (Number.isFinite(n) && n >= 1 && n <= 5) this.#satisfaction = Math.round(n);
    this.#feedback = String(note || "").slice(0, 500);
    return this.registerActivity();
  }

  revise({ title, body, location, occurredAt }) {
    if (title !== undefined) this.#title = String(title).trim();
    if (body !== undefined) this.#body = String(body).trim();
    if (location !== undefined) this.#location = String(location).trim();
    if (occurredAt !== undefined) this.#occurredAt = occurredAt;
    return this.registerActivity();
  }

  // ---- persistence and projections ----------------------------------------

  serialise() {
    return {
      collegeId: this.#collegeId,
      categoryId: this.#categoryId,
      departmentId: this.#departmentId,
      assignedTo: this.#assignedTo,
      reporterKey: this.#reporterKey,
      handle: this.#handle,
      title: this.#title,
      body: this.#body,
      status: this.status,
      priority: this.#priority,
      visibility: this.#visibility,
      secret: this.#secret,
      contact: { ...this.#contact },
      supportCount: this.#supportCount,
      supporters: [...this.#supporters],
      evidence: this.evidence,
      tags: [...this.#tags],
      location: this.#location,
      occurredAt: this.#occurredAt,
      dueAt: this.#dueAt,
      acknowledgedAt: this.#acknowledgedAt,
      resolvedAt: this.#resolvedAt,
      closedAt: this.#closedAt,
      lastActivityAt: this.#lastActivityAt,
      escalated: this.#escalated,
      escalationReason: this.#escalationReason,
      reopenCount: this.#reopenCount,
      mergedInto: this.#mergedInto,
      mergedFrom: [...this.#mergedFrom],
      satisfaction: this.#satisfaction,
      feedback: this.#feedback,
      pausedAt: this.#pausedAt,
      pausedMs: this.#pausedMs,
      routingTrace: this.routingTrace,
    };
  }

  /** Fields common to every projection. Never includes secret or contact. */
  #common() {
    return {
      traceCode: this.traceCode,
      collegeId: this.#collegeId,
      categoryId: this.#categoryId,
      departmentId: this.#departmentId,
      handle: this.#handle,
      reporter: this.reporter.toJSON(),
      title: this.#title,
      body: this.#body,
      status: this.status,
      statusLabel: this.#status.label,
      tone: this.#status.tone,
      railStep: this.#status.railStep,
      priority: this.#priority,
      visibility: this.#visibility,
      supportCount: this.#supportCount,
      tags: [...this.#tags],
      location: this.#location,
      occurredAt: this.#occurredAt,
      evidenceCount: this.#evidence.length,
      createdAt: this.createdAt,
      lastActivityAt: this.#lastActivityAt,
      escalated: this.#escalated,
      isOpen: this.isOpen,
      isOverdue: this.isOverdue,
      mergedInto: this.#mergedInto,
      mergedFrom: [...this.#mergedFrom],
    };
  }

  /** What the public feed shows. */
  publicView() {
    return { ...this.#common(), resolvedAt: this.#resolvedAt, satisfaction: this.#satisfaction };
  }

  /** What the person holding the trace code sees. */
  reporterView() {
    return {
      ...this.#common(),
      reporterNote: this.#status.reporterNote,
      dueAt: this.#dueAt,
      remainingMs: this.remainingMs,
      acknowledgedAt: this.#acknowledgedAt,
      resolvedAt: this.#resolvedAt,
      closedAt: this.#closedAt,
      reopenCount: this.#reopenCount,
      satisfaction: this.#satisfaction,
      feedback: this.#feedback,
      contactSharing: this.#contact.sharing,
      hasPassphrase: Boolean(this.#secret),
      evidence: this.evidence.map(({ storedAs, ...rest }) => rest),
      allowedNext: this.#status.allowedNext(),
      escalationReason: this.#escalationReason,
    };
  }

  /** What a desk sees. Contact detail only if the reporter allowed this account. */
  deskView(account) {
    return {
      ...this.reporterView(),
      assignedTo: this.#assignedTo,
      evidence: this.evidence,
      routingTrace: this.routingTrace,
      elapsedMs: this.elapsedMs,
      pausedMs: this.pausedMs,
      resolutionMs: this.resolutionMs,
      contact: this.contactFor(account),
      contactWithheld: this.hasContact && !this.contactFor(account),
    };
  }
}
