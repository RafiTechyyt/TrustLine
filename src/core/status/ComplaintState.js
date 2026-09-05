// ComplaintState.js — STATE PATTERN, abstract half.
//
// A report does not hold a status string and get validated by a big switch.
// It holds a *state object*, and asks that object what is legal next. Adding a
// stage to the lifecycle later means writing one more subclass — no existing
// file has to change, and no `if (status === "...")` chain grows by one more arm.

export class ComplaintState {
  constructor() {
    if (new.target === ComplaintState) {
      throw new TypeError("ComplaintState is abstract");
    }
  }

  /** @abstract Stored value, e.g. "in_progress". */
  static get key() { throw new Error("state must define static key"); }

  get key() { return this.constructor.key; }

  /** @abstract Shown to people. Sentence case, plain words. */
  get label() { throw new Error(`${this.constructor.name} must define label`); }

  /** What the reporter should understand is happening right now. */
  get reporterNote() { return ""; }

  /** Drives the ink colour of the status stamp: neutral | working | good | bad | warn */
  get tone() { return "neutral"; }

  /** Counts towards "open reports" on the dashboard. */
  get isOpen() { return true; }

  /** No further transitions are possible. */
  get isTerminal() { return false; }

  /** Whether the response-time clock is ticking in this state. */
  get clockRuns() { return true; }

  /** Position on the reporter-facing progress rail, or null to hide it. */
  get railStep() { return null; }

  /** @abstract Keys this state may move to. */
  allowedNext() { return []; }

  canMoveTo(key) { return this.allowedNext().includes(key); }

  /**
   * Side effects of arriving here. Runs inside Complaint#transitionTo, so a
   * state can stamp a timestamp or clear a due date without the service layer
   * knowing which state it just entered.
   */
  onEnter(_complaint, _context) {}

  describe() {
    return {
      key: this.key,
      label: this.label,
      tone: this.tone,
      isOpen: this.isOpen,
      isTerminal: this.isTerminal,
      clockRuns: this.clockRuns,
      railStep: this.railStep,
      reporterNote: this.reporterNote,
      allowedNext: this.allowedNext(),
    };
  }

  toString() { return this.key; }
}
