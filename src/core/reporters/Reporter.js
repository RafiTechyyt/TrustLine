// Reporter.js — abstract description of who is filing.
//
// A reporter is never stored as a person. This class exists so the routing and
// priority engines can ask questions about the *kind* of person filing without
// ever holding an identity: "should this category be offered to them?",
// "does this kind of report start above normal priority?"

import { PRIORITY } from "../enums.js";

export class Reporter {
  #key;

  constructor(key) {
    if (new.target === Reporter) {
      throw new TypeError("Reporter is abstract — use one of its subclasses");
    }
    this.#key = key;
  }

  get key() { return this.#key; }

  /** @abstract Shown on the role picker. */
  get label() { throw new Error(`${this.constructor.name} must define label`); }

  /** @abstract One line of plain help under the label. */
  get blurb() { return ""; }

  /**
   * Words that hint at which categories this person most often needs, used to
   * order the category list so the common case is first.
   */
  get categoryHints() { return []; }

  /**
   * The lowest priority a report from this kind of reporter may be filed at.
   * A parent raising a safety concern should not sit in a "low" bucket.
   */
  priorityFloor(_category) { return PRIORITY.LOW; }

  /** Categories can be restricted to certain audiences (hostel, for example). */
  mayUse(category) {
    const audiences = category?.audiences ?? [];
    return audiences.length === 0 || audiences.includes(this.#key);
  }

  toJSON() { return { key: this.#key, label: this.label }; }
}
