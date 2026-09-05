// RoutingStrategy.js — STRATEGY PATTERN, abstract half.
//
// "Which desk does this belong to?" has more than one right answer, and the
// answer a college wants changes over time. So the question is asked of an
// interchangeable object rather than hard-coded into the submit handler.

export class RoutingStrategy {
  constructor() {
    if (new.target === RoutingStrategy) throw new TypeError("RoutingStrategy is abstract");
  }

  /** @abstract Short identifier, stored on the report so the decision is auditable. */
  get name() { throw new Error(`${this.constructor.name} must define name`); }

  /** @abstract Shown to the reporter in plain words on their receipt. */
  get explains() { return ""; }

  /**
   * @abstract
   * @returns {{departmentId: string, categoryId: string|null, reason: string,
   *            confidence: number, priorityFloor?: string, tag?: string} | null}
   *          null means "no opinion, ask the next strategy".
   */
  decide(_draft, _context) { throw new Error(`${this.constructor.name} must implement decide()`); }
}

/**
 * Runs strategies in order and takes the first real answer. Also keeps the list
 * of strategies that declined, which is what the ops desk sees as the routing
 * trace on a report — so an admin can tell *why* something landed on them.
 */
export class CompositeRouter extends RoutingStrategy {
  #strategies;

  constructor(strategies) {
    super();
    this.#strategies = strategies;
  }

  get name() { return "composite"; }
  get strategies() { return [...this.#strategies]; }

  decide(draft, context) {
    const considered = [];
    for (const strategy of this.#strategies) {
      const decision = strategy.decide(draft, context);
      if (decision && decision.departmentId) {
        return { ...decision, strategy: strategy.name, considered, explains: strategy.explains };
      }
      considered.push(strategy.name);
    }
    return null;
  }
}
