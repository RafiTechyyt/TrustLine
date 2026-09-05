// states.js — STATE PATTERN, concrete half. Nine states, one class each.

import { ComplaintState } from "./ComplaintState.js";

export const STATUS = Object.freeze({
  SUBMITTED: "submitted",
  TRIAGED: "triaged",
  IN_PROGRESS: "in_progress",
  AWAITING_REPORTER: "awaiting_reporter",
  ESCALATED: "escalated",
  RESOLVED: "resolved",
  CLOSED: "closed",
  DECLINED: "declined",
  WITHDRAWN: "withdrawn",
});

class Submitted extends ComplaintState {
  static get key() { return STATUS.SUBMITTED; }
  get label() { return "Received"; }
  get reporterNote() { return "It reached the right desk. Nobody has picked it up yet."; }
  get tone() { return "warn"; }
  get railStep() { return 0; }
  allowedNext() {
    return [STATUS.TRIAGED, STATUS.IN_PROGRESS, STATUS.DECLINED, STATUS.ESCALATED, STATUS.WITHDRAWN];
  }
}

class Triaged extends ComplaintState {
  static get key() { return STATUS.TRIAGED; }
  get label() { return "Accepted"; }
  get reporterNote() { return "Someone at the desk has read it and taken it on."; }
  get tone() { return "working"; }
  get railStep() { return 1; }
  onEnter(complaint) { complaint.stampAcknowledged(); }
  allowedNext() {
    return [STATUS.IN_PROGRESS, STATUS.AWAITING_REPORTER, STATUS.DECLINED, STATUS.ESCALATED, STATUS.WITHDRAWN];
  }
}

class InProgress extends ComplaintState {
  static get key() { return STATUS.IN_PROGRESS; }
  get label() { return "Being worked on"; }
  get reporterNote() { return "Work is underway. Check back here for updates."; }
  get tone() { return "working"; }
  get railStep() { return 2; }
  onEnter(complaint) { complaint.stampAcknowledged(); }
  allowedNext() {
    return [STATUS.AWAITING_REPORTER, STATUS.RESOLVED, STATUS.DECLINED, STATUS.ESCALATED, STATUS.WITHDRAWN];
  }
}

class AwaitingReporter extends ComplaintState {
  static get key() { return STATUS.AWAITING_REPORTER; }
  get label() { return "Waiting for you"; }
  get reporterNote() { return "The desk asked you something. Answer in the thread below to keep this moving."; }
  get tone() { return "warn"; }
  get railStep() { return 2; }
  /** The desk is not the blocker here, so its clock stops. */
  get clockRuns() { return false; }
  allowedNext() {
    return [STATUS.IN_PROGRESS, STATUS.RESOLVED, STATUS.DECLINED, STATUS.ESCALATED, STATUS.WITHDRAWN];
  }
}

class Escalated extends ComplaintState {
  static get key() { return STATUS.ESCALATED; }
  get label() { return "Escalated"; }
  get reporterNote() { return "This went past its response time, so it has been raised to the college admin."; }
  get tone() { return "bad"; }
  get railStep() { return 2; }
  onEnter(complaint, context) { complaint.markEscalated(context?.reason || "Response time passed"); }
  allowedNext() {
    return [STATUS.IN_PROGRESS, STATUS.RESOLVED, STATUS.DECLINED, STATUS.WITHDRAWN];
  }
}

class Resolved extends ComplaintState {
  static get key() { return STATUS.RESOLVED; }
  get label() { return "Resolved"; }
  get reporterNote() { return "The desk says this is done. If it is not, you can reopen it."; }
  get tone() { return "good"; }
  get isOpen() { return false; }
  get clockRuns() { return false; }
  get railStep() { return 3; }
  onEnter(complaint) { complaint.stampResolved(); }
  allowedNext() { return [STATUS.CLOSED, STATUS.IN_PROGRESS]; }
}

class Closed extends ComplaintState {
  static get key() { return STATUS.CLOSED; }
  get label() { return "Closed"; }
  get reporterNote() { return "Closed and archived."; }
  get tone() { return "neutral"; }
  get isOpen() { return false; }
  get clockRuns() { return false; }
  get railStep() { return 3; }
  onEnter(complaint) { complaint.stampClosed(); }
  /** Reopening is still allowed — a closed report is not a locked one. */
  allowedNext() { return [STATUS.IN_PROGRESS]; }
}

class Declined extends ComplaintState {
  static get key() { return STATUS.DECLINED; }
  get label() { return "Not taken forward"; }
  get reporterNote() { return "The desk explained why this cannot be acted on. Read the reason in the thread."; }
  get tone() { return "bad"; }
  get isOpen() { return false; }
  get clockRuns() { return false; }
  get railStep() { return 3; }
  onEnter(complaint) { complaint.stampClosed(); }
  /** An appeal can put it back in the queue. */
  allowedNext() { return [STATUS.IN_PROGRESS]; }
}

class Withdrawn extends ComplaintState {
  static get key() { return STATUS.WITHDRAWN; }
  get label() { return "Withdrawn"; }
  get reporterNote() { return "You withdrew this report. It is no longer in any queue."; }
  get tone() { return "neutral"; }
  get isOpen() { return false; }
  get isTerminal() { return true; }
  get clockRuns() { return false; }
  onEnter(complaint) { complaint.stampClosed(); }
  allowedNext() { return []; }
}

/** States are stateless, so one shared instance of each is all anyone needs. */
const INSTANCES = new Map(
  [Submitted, Triaged, InProgress, AwaitingReporter, Escalated, Resolved, Closed, Declined, Withdrawn]
    .map((Ctor) => [Ctor.key, new Ctor()]),
);

export class StateRegistry {
  static get(key) {
    const state = INSTANCES.get(key);
    if (!state) throw new TypeError(`Unknown report status: ${key}`);
    return state;
  }

  static has(key) { return INSTANCES.has(key); }
  static all() { return [...INSTANCES.values()]; }
  static keys() { return [...INSTANCES.keys()]; }
  static describeAll() { return StateRegistry.all().map((s) => s.describe()); }

  /** The four rungs shown on the reporter-facing progress rail. */
  static rail() { return ["Received", "Accepted", "Being worked on", "Closed out"]; }
}
