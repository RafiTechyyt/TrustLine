// policies.js — how urgent a report is, decided by several small rules.
//
// Each policy answers "what floor would you put this at?" and the composite
// takes the highest answer. Priority therefore only ever rises automatically —
// nothing in here can quietly demote a report someone is worried about.

import { PRIORITY, highestPriority } from "../enums.js";

export class PriorityPolicy {
  constructor() {
    if (new.target === PriorityPolicy) throw new TypeError("PriorityPolicy is abstract");
  }

  /** @abstract */
  get name() { throw new Error(`${this.constructor.name} must define name`); }

  /** @abstract @returns {{priority: string, reason: string}|null} */
  assess(_report, _context) { throw new Error(`${this.constructor.name} must implement assess()`); }
}

/** Whatever the college set on the category. */
export class CategoryBaselinePolicy extends PriorityPolicy {
  get name() { return "category-baseline"; }
  assess(report, context) {
    const category = context.category;
    if (!category) return null;
    return { priority: category.defaultPriority, reason: `${category.name} starts at ${category.defaultPriority}` };
  }
}

/** Reporter kind can set a floor — see ParentReporter#priorityFloor. */
export class ReporterFloorPolicy extends PriorityPolicy {
  get name() { return "reporter-floor"; }
  assess(report, context) {
    const floor = report.reporter.priorityFloor(context.category);
    if (floor === PRIORITY.LOW) return null;
    return { priority: floor, reason: `${report.reporter.label} reports start at ${floor}` };
  }
}

/** Words that describe something breaking now, not something annoying. */
export class SeverityWordPolicy extends PriorityPolicy {
  static URGENT = ["ragging", "harass", "assault", "molest", "threat", "fire", "shock",
    "electrocut", "collapse", "injury", "bleeding", "gas leak", "suicide", "unsafe", "flood"];
  static HIGH = ["broken", "no water", "leak", "power cut", "not working", "spoiled",
    "food poisoning", "cockroach", "rat", "delay", "missing", "unhygienic", "overcrowd"];

  get name() { return "severity-words"; }

  assess(report) {
    const text = `${report.title} ${report.body}`.toLowerCase();
    const urgent = SeverityWordPolicy.URGENT.find((w) => text.includes(w));
    if (urgent) return { priority: PRIORITY.URGENT, reason: `Wording: "${urgent}"` };
    const high = SeverityWordPolicy.HIGH.find((w) => text.includes(w));
    if (high) return { priority: PRIORITY.HIGH, reason: `Wording: "${high}"` };
    return null;
  }
}

/** Twelve people saying "this happens to me too" is a different problem. */
export class CorroborationPolicy extends PriorityPolicy {
  get name() { return "corroboration"; }
  assess(report) {
    const n = report.supportCount;
    if (n >= 25) return { priority: PRIORITY.URGENT, reason: `${n} people backed this` };
    if (n >= 8) return { priority: PRIORITY.HIGH, reason: `${n} people backed this` };
    return null;
  }
}

/** A report that has burned most of its response window needs looking at. */
export class AgeingPolicy extends PriorityPolicy {
  get name() { return "ageing"; }
  assess(report) {
    if (!report.isOpen || !report.dueAt) return null;
    const total = report.dueAt - report.createdAt;
    if (total <= 0) return null;
    const used = (Date.now() - report.createdAt - report.pausedMs) / total;
    if (report.isOverdue) return { priority: PRIORITY.URGENT, reason: "Past its response time" };
    if (used > 0.75) return { priority: PRIORITY.HIGH, reason: "Response time nearly used up" };
    return null;
  }
}

/** Many reports of the same kind in a short window is a pattern, not a one-off. */
export class ClusterPolicy extends PriorityPolicy {
  #threshold;
  constructor(threshold = 4) { super(); this.#threshold = threshold; }
  get name() { return "cluster"; }
  assess(_report, context) {
    const n = context.recentSameCategory ?? 0;
    if (n < this.#threshold) return null;
    return { priority: PRIORITY.HIGH, reason: `${n} similar reports this week` };
  }
}

/** Runs every policy and keeps the highest floor, with the reasons that got it there. */
export class CompositePriorityPolicy extends PriorityPolicy {
  #policies;
  constructor(policies) { super(); this.#policies = policies; }
  get name() { return "composite"; }
  get policies() { return [...this.#policies]; }

  assess(report, context = {}) {
    const verdicts = this.#policies
      .map((p) => { const v = p.assess(report, context); return v ? { ...v, policy: p.name } : null; })
      .filter(Boolean);
    if (verdicts.length === 0) return { priority: PRIORITY.NORMAL, reason: "Nothing stood out", verdicts };
    const priority = highestPriority(...verdicts.map((v) => v.priority));
    const winners = verdicts.filter((v) => v.priority === priority);
    return { priority, reason: winners.map((v) => v.reason).join("; "), verdicts };
  }
}

export function defaultPriorityPolicy() {
  return new CompositePriorityPolicy([
    new CategoryBaselinePolicy(),
    new ReporterFloorPolicy(),
    new SeverityWordPolicy(),
    new CorroborationPolicy(),
    new AgeingPolicy(),
    new ClusterPolicy(),
  ]);
}
