// strategies.js — STRATEGY PATTERN, concrete half.
//
// Four strategies, tried in this order:
//   1. safety net      — words that must not sit in a slow queue
//   2. explicit choice — the reporter picked a category that has a desk
//   3. wording match   — the category whose keywords the text actually hits
//   4. lightest desk   — no signal at all, so pick the desk with room

import { RoutingStrategy, CompositeRouter } from "./RoutingStrategy.js";
import { PRIORITY } from "../enums.js";

/**
 * Some words cannot wait behind a broken projector. If the text clearly points
 * at harm and the college has a category set up for it, the report goes there
 * even if the reporter chose something else — and the receipt says so.
 */
export class SafetyNetStrategy extends RoutingStrategy {
  static WORDS = Object.freeze([
    "ragging", "ragged", "harass", "harassment", "molest", "assault", "abuse",
    "threat", "threatened", "beaten", "hit me", "casteist", "caste slur",
    "suicide", "self harm", "unsafe", "stalking", "blackmail", "extortion",
  ]);

  get name() { return "safety-net"; }
  get explains() { return "The wording pointed at someone's safety, so it went to the desk that handles that first."; }

  decide(draft, context) {
    const text = `${draft.title} ${draft.body}`.toLowerCase();
    const hits = SafetyNetStrategy.WORDS.filter((w) => text.includes(w));
    if (hits.length === 0) return null;

    // Prefer a category the college marked confidential (grievance / anti-ragging cell).
    const safetyCategory = context.categories
      .filter((c) => c.active && c.isRouted)
      .map((c) => ({ c, score: c.matchScore(text) + (c.confidential ? 4 : 0) }))
      .sort((a, b) => b.score - a.score)[0];

    if (!safetyCategory || safetyCategory.score < 4) return null;

    const chosen = draft.categoryId && draft.categoryId !== safetyCategory.c.id
      ? safetyCategory.c
      : context.categories.find((c) => c.id === draft.categoryId) || safetyCategory.c;

    return {
      departmentId: chosen.departmentId,
      categoryId: chosen.id,
      reason: `Safety wording detected: ${hits.slice(0, 3).join(", ")}`,
      confidence: 0.95,
      priorityFloor: PRIORITY.URGENT,
      tag: "safety",
    };
  }
}

/** The reporter picked a category and that category has a desk behind it. */
export class ExplicitCategoryStrategy extends RoutingStrategy {
  get name() { return "category-rule"; }
  get explains() { return "It went to the desk your college assigned to this category."; }

  decide(draft, context) {
    if (!draft.categoryId) return null;
    const category = context.categories.find((c) => c.id === draft.categoryId && c.active);
    if (!category?.isRouted) return null;
    return {
      departmentId: category.departmentId,
      categoryId: category.id,
      reason: `Category rule: ${category.name}`,
      confidence: 1,
      priorityFloor: category.defaultPriority,
    };
  }
}

/** No category picked, or the one picked has no desk. Read the words instead. */
export class KeywordStrategy extends RoutingStrategy {
  #threshold;

  constructor(threshold = 2) {
    super();
    this.#threshold = threshold;
  }

  get name() { return "wording-match"; }
  get explains() { return "No category was chosen, so it was matched on the words you used."; }

  decide(draft, context) {
    const text = `${draft.title} ${draft.body}`;
    const ranked = context.categories
      .filter((c) => c.active && c.isRouted)
      .map((c) => ({ category: c, score: c.matchScore(text) }))
      .filter((r) => r.score >= this.#threshold)
      .sort((a, b) => b.score - a.score);
    if (ranked.length === 0) return null;
    const { category, score } = ranked[0];
    return {
      departmentId: category.departmentId,
      categoryId: category.id,
      reason: `Matched "${category.name}" on wording (score ${score})`,
      confidence: Math.min(0.9, 0.4 + score * 0.1),
      priorityFloor: category.defaultPriority,
    };
  }
}

/** Last resort: the active desk with the shortest open queue. */
export class LightestDeskStrategy extends RoutingStrategy {
  get name() { return "lightest-desk"; }
  get explains() { return "Nothing matched a category, so it went to the desk with the shortest queue for a human to sort."; }

  decide(_draft, context) {
    const desks = context.departments.filter((d) => d.active);
    if (desks.length === 0) return null;
    const load = context.openCountByDepartment || new Map();
    const chosen = desks
      .map((d) => ({ d, open: load.get(d.id) ?? 0 }))
      .sort((a, b) => a.open - b.open || a.d.order - b.d.order)[0].d;
    return {
      departmentId: chosen.id,
      categoryId: null,
      reason: `Unmatched — sent to ${chosen.name} for manual triage`,
      confidence: 0.2,
    };
  }
}

/** The router the app actually uses. */
export function defaultRouter() {
  return new CompositeRouter([
    new SafetyNetStrategy(),
    new ExplicitCategoryStrategy(),
    new KeywordStrategy(),
    new LightestDeskStrategy(),
  ]);
}

export { CompositeRouter };
