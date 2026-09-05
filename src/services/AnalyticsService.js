// AnalyticsService.js — the numbers, computed on read.
//
// There is no metrics table and no aggregation job. At the size a college feed
// reaches, folding over the in-memory rows is both faster than a query and
// impossible to get out of sync. Everything here is a pure read: give it a
// college and a window, get an object the dashboard renders directly.
//
// Two audiences, deliberately separated. `forCollege` is the admin's operating
// picture. `transparency` is the same college's public scoreboard — same source
// data, and nothing in it can name a person or reveal a private report's text.

import { STATUS, StateRegistry } from "../core/status/states.js";
import { PRIORITY_ORDER, COLLEGE_STATUS } from "../core/enums.js";
import { P } from "../core/accounts/permissions.js";
import { ForbiddenError } from "../lib/errors.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export class AnalyticsService {
  #db;

  constructor({ db }) {
    this.#db = db;
  }

  // ---- the college dashboard ----------------------------------------------

  forCollege(account, { days = 30 } = {}) {
    if (!account?.can(P.COLLEGE_ANALYTICS_READ)) throw new ForbiddenError("This account cannot read analytics");
    const collegeId = account.collegeId;
    const since = Date.now() - days * DAY;
    // An officer's dashboard covers their desks only, so the numbers they see
    // always add up to the queue they can actually open.
    const all = account.can(P.REPORTS_READ_ALL)
      ? this.#db.complaints.ofCollege(collegeId)
      : this.#db.complaints.ofDepartments(account.departmentIds);
    const window = all.filter((r) => r.createdAt >= since);

    return {
      window: { days, since },
      headline: this.#headline(all, window, since, days * DAY),
      byStatus: this.#byStatus(all),
      byPriority: this.#byPriority(all),
      byDepartment: this.#byDepartment(collegeId, all),
      byCategory: this.#byCategory(collegeId, all),
      daily: this.#daily(window, days),
      byReporter: this.#byReporter(all),
      resolution: this.#resolution(all),
      backlog: this.#backlog(all),
      satisfaction: this.#satisfaction(all),
      hotTags: this.#hotTags(window),
      routing: this.#routingMix(window),
    };
  }

  #headline(all, window, since, spanMs) {
    const open = all.filter((r) => r.isOpen);
    const resolved = all.filter((r) => r.resolutionMs !== null);
    // Trend compares this window against the one immediately before it, so
    // "+40%" means forty per cent more reports than the previous month.
    const prior = all.filter((r) => r.createdAt >= since - spanMs && r.createdAt < since);
    return {
      total: all.length,
      inWindow: window.length,
      open: open.length,
      overdue: open.filter((r) => r.isOverdue).length,
      escalated: open.filter((r) => r.escalated).length,
      unassigned: open.filter((r) => !r.assignedTo).length,
      publicShare: all.length === 0 ? 0 : Math.round((all.filter((r) => r.isPublic).length / all.length) * 100),
      resolvedRate: all.length === 0 ? 0 : Math.round((resolved.length / all.length) * 100),
      medianHours: AnalyticsService.median(resolved.map((r) => r.resolutionMs / HOUR)),
      firstResponseHours: AnalyticsService.median(
        all.filter((r) => r.acknowledgedAt).map((r) => (r.acknowledgedAt - r.createdAt) / HOUR),
      ),
      trend: prior.length === 0 ? null : Math.round(((window.length - prior.length) / prior.length) * 100),
      backedTotal: all.reduce((sum, r) => sum + r.supportCount, 0),
    };
  }

  #byStatus(rows) {
    const counts = new Map(Object.values(STATUS).map((key) => [key, 0]));
    for (const report of rows) counts.set(report.status, (counts.get(report.status) ?? 0) + 1);
    return [...counts.entries()]
      .filter(([, count]) => count > 0)
      .map(([key, count]) => {
        const state = StateRegistry.get(key);
        return { key, label: state.label, tone: state.tone, count };
      });
  }

  #byPriority(rows) {
    return PRIORITY_ORDER.map((key) => ({
      key,
      count: rows.filter((r) => r.priority === key).length,
      open: rows.filter((r) => r.priority === key && r.isOpen).length,
    })).reverse();
  }

  /** The table that answers "which desk is drowning?" */
  #byDepartment(collegeId, rows) {
    return this.#db.departments.ofCollege(collegeId, { includeInactive: true }).map((desk) => {
      const mine = rows.filter((r) => r.departmentId === desk.id);
      const resolved = mine.filter((r) => r.resolutionMs !== null);
      const open = mine.filter((r) => r.isOpen);
      return {
        id: desk.id,
        name: desk.name,
        code: desk.code,
        active: desk.active,
        total: mine.length,
        open: open.length,
        overdue: open.filter((r) => r.isOverdue).length,
        escalated: mine.filter((r) => r.escalated).length,
        medianHours: AnalyticsService.median(resolved.map((r) => r.resolutionMs / HOUR)),
        onTimeRate: resolved.length === 0
          ? null
          : Math.round((resolved.filter((r) => r.dueAt === null || r.resolvedAt <= r.dueAt + r.pausedMs).length / resolved.length) * 100),
        satisfaction: AnalyticsService.mean(mine.filter((r) => r.satisfaction).map((r) => r.satisfaction)),
        officers: this.#db.accounts.officersOfDepartment(desk.id).length,
      };
    }).sort((a, b) => b.open - a.open || b.total - a.total);
  }

  #byCategory(collegeId, rows) {
    return this.#db.categories.ofCollege(collegeId, { includeInactive: true }).map((category) => {
      const mine = rows.filter((r) => r.categoryId === category.id);
      return {
        id: category.id,
        name: category.name,
        glyph: category.glyph,
        confidential: category.confidential,
        total: mine.length,
        open: mine.filter((r) => r.isOpen).length,
        backed: mine.reduce((sum, r) => sum + r.supportCount, 0),
        medianHours: AnalyticsService.median(
          mine.filter((r) => r.resolutionMs !== null).map((r) => r.resolutionMs / HOUR),
        ),
      };
    }).filter((row) => row.total > 0).sort((a, b) => b.total - a.total);
  }

  /** Filed vs resolved per day — the one chart that shows whether a desk is winning. */
  #daily(rows, days) {
    const buckets = new Map();
    const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const today = startOfDay(Date.now());
    for (let i = days - 1; i >= 0; i -= 1) {
      buckets.set(today - i * DAY, { filed: 0, resolved: 0, backed: 0 });
    }
    for (const report of rows) {
      const filedAt = startOfDay(report.createdAt);
      if (buckets.has(filedAt)) {
        const bucket = buckets.get(filedAt);
        bucket.filed += 1;
        bucket.backed += report.supportCount;
      }
      if (report.resolvedAt) {
        const resolvedAt = startOfDay(report.resolvedAt);
        if (buckets.has(resolvedAt)) buckets.get(resolvedAt).resolved += 1;
      }
    }
    return [...buckets.entries()].map(([at, counts]) => ({
      at,
      label: new Date(at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      ...counts,
    }));
  }

  /** Who is actually using it — the answer that decides where to put a poster. */
  #byReporter(rows) {
    const counts = new Map();
    for (const report of rows) {
      const key = report.reporterKey;
      if (!counts.has(key)) counts.set(key, { key, label: report.reporter.label, count: 0, resolved: 0 });
      const row = counts.get(key);
      row.count += 1;
      if (!report.isOpen) row.resolved += 1;
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }

  #resolution(rows) {
    const hours = rows.filter((r) => r.resolutionMs !== null).map((r) => r.resolutionMs / HOUR);
    const bands = [
      { label: "under 4h", test: (h) => h < 4 },
      { label: "4–24h", test: (h) => h >= 4 && h < 24 },
      { label: "1–3 days", test: (h) => h >= 24 && h < 72 },
      { label: "3–7 days", test: (h) => h >= 72 && h < 168 },
      { label: "over a week", test: (h) => h >= 168 },
    ];
    return {
      count: hours.length,
      median: AnalyticsService.median(hours),
      fastest: hours.length === 0 ? null : Math.round(Math.min(...hours) * 10) / 10,
      slowest: hours.length === 0 ? null : Math.round(Math.max(...hours) * 10) / 10,
      bands: bands.map(({ label, test }) => ({ label, count: hours.filter(test).length })),
    };
  }

  /** How old the open pile is. A growing right-hand bar is the warning sign. */
  #backlog(rows) {
    const open = rows.filter((r) => r.isOpen);
    const age = (r) => (Date.now() - r.createdAt) / DAY;
    const bands = [
      { label: "today", test: (d) => d < 1 },
      { label: "1–3 days", test: (d) => d >= 1 && d < 3 },
      { label: "3–7 days", test: (d) => d >= 3 && d < 7 },
      { label: "1–4 weeks", test: (d) => d >= 7 && d < 28 },
      { label: "over a month", test: (d) => d >= 28 },
    ];
    return {
      open: open.length,
      oldestDays: open.length === 0 ? null : Math.round(Math.max(...open.map(age))),
      bands: bands.map(({ label, test }) => ({ label, count: open.filter((r) => test(age(r))).length })),
    };
  }

  #satisfaction(rows) {
    const rated = rows.filter((r) => r.satisfaction);
    return {
      count: rated.length,
      mean: AnalyticsService.mean(rated.map((r) => r.satisfaction)),
      spread: [1, 2, 3, 4, 5].map((score) => ({
        score, count: rated.filter((r) => r.satisfaction === score).length,
      })),
      coverage: rows.filter((r) => !r.isOpen).length === 0
        ? null
        : Math.round((rated.length / rows.filter((r) => !r.isOpen).length) * 100),
    };
  }

  #hotTags(rows) {
    const counts = new Map();
    for (const report of rows) {
      for (const tag of report.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }

  /**
   * Which routing strategy actually placed each report. Worth showing: it is the
   * honest measure of whether the admin's category table is doing its job or
   * whether everything is falling through to the catch-all desk.
   */
  #routingMix(rows) {
    const counts = new Map();
    for (const report of rows) {
      const strategy = report.routingTrace.at(-1)?.strategy ?? "unknown";
      counts.set(strategy, (counts.get(strategy) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([strategy, count]) => ({
        strategy,
        count,
        share: rows.length === 0 ? 0 : Math.round((count / rows.length) * 100),
      }))
      .sort((a, b) => b.count - a.count);
  }

  // ---- the public scoreboard ----------------------------------------------

  /**
   * A college's own transparency page. This is the growth engine: a college that
   * publishes "91% resolved, median 14 hours" gets more reports, and one that
   * publishes a bad number has a reason to fix it. Confidential categories are
   * left out entirely — publishing "3 harassment reports this month" at a small
   * department is itself identifying.
   */
  transparency(collegeId, { days = 90 } = {}) {
    const college = this.#db.colleges.require(collegeId, "College");
    const since = Date.now() - days * DAY;
    const confidential = new Set(
      this.#db.categories.ofCollege(collegeId, { includeInactive: true })
        .filter((c) => c.confidential).map((c) => c.id),
    );
    const rows = this.#db.complaints.ofCollege(collegeId)
      .filter((r) => !confidential.has(r.categoryId) && !r.mergedInto);
    const window = rows.filter((r) => r.createdAt >= since);
    const resolved = rows.filter((r) => r.resolutionMs !== null);

    return {
      college: college.publicView(),
      window: { days, since },
      totals: {
        filed: rows.length,
        inWindow: window.length,
        resolved: resolved.length,
        open: rows.filter((r) => r.isOpen).length,
        resolvedRate: rows.length === 0 ? null : Math.round((resolved.length / rows.length) * 100),
        medianHours: AnalyticsService.median(resolved.map((r) => r.resolutionMs / HOUR)),
        backed: rows.reduce((sum, r) => sum + r.supportCount, 0),
        satisfaction: AnalyticsService.mean(rows.filter((r) => r.satisfaction).map((r) => r.satisfaction)),
        publicShare: rows.length === 0 ? 0 : Math.round((rows.filter((r) => r.isPublic).length / rows.length) * 100),
      },
      // Desk-level numbers, but never a desk's report *content* and never an
      // officer's name. A college is accountable; an individual is not exposed.
      departments: this.#db.departments.ofCollege(collegeId).map((desk) => {
        const mine = rows.filter((r) => r.departmentId === desk.id);
        const done = mine.filter((r) => r.resolutionMs !== null);
        return {
          name: desk.name,
          filed: mine.length,
          resolved: done.length,
          medianHours: AnalyticsService.median(done.map((r) => r.resolutionMs / HOUR)),
        };
      }).filter((row) => row.filed > 0).sort((a, b) => b.filed - a.filed),
      categories: this.#byCategory(collegeId, rows).filter((row) => !row.confidential),
      daily: this.#daily(window, Math.min(days, 90)),
      resolution: this.#resolution(rows),
    };
  }

  // ---- the platform office -------------------------------------------------

  /**
   * What the platform office sees. Counts and health only: SuperAdmin.canRead()
   * returns false for every report, and nothing here goes around that. The people
   * who run the platform cannot read a single complaint, by construction.
   */
  platform(account) {
    if (!account?.can(P.PLATFORM_METRICS_READ)) throw new ForbiddenError("Only the platform office can read this");
    const colleges = this.#db.colleges.all();
    const complaints = this.#db.complaints.all();

    return {
      colleges: {
        total: colleges.length,
        active: colleges.filter((c) => c.status === COLLEGE_STATUS.ACTIVE).length,
        pending: colleges.filter((c) => c.status === COLLEGE_STATUS.PENDING).length,
        suspended: colleges.filter((c) => c.status === COLLEGE_STATUS.SUSPENDED).length,
        rejected: colleges.filter((c) => c.status === COLLEGE_STATUS.REJECTED).length,
      },
      accounts: {
        total: this.#db.accounts.size(),
        pending: this.#db.accounts.pendingReview().length,
        active: this.#db.accounts.where((a) => a.isActive).length,
      },
      reports: {
        total: complaints.length,
        open: complaints.filter((r) => r.isOpen).length,
        resolved: complaints.filter((r) => r.resolutionMs !== null).length,
        overdue: complaints.filter((r) => r.isOpen && r.isOverdue).length,
        last7Days: complaints.filter((r) => Date.now() - r.createdAt < 7 * DAY).length,
        medianHours: AnalyticsService.median(
          complaints.filter((r) => r.resolutionMs !== null).map((r) => r.resolutionMs / HOUR),
        ),
      },
      // The per-tenant league table. Volume and health, never a title.
      tenants: colleges.map((college) => {
        const mine = complaints.filter((r) => r.collegeId === college.id);
        const done = mine.filter((r) => r.resolutionMs !== null);
        return {
          id: college.id,
          name: college.name,
          slug: college.slug,
          status: college.status,
          admins: this.#db.accounts.admins(college.id).length,
          departments: this.#db.departments.ofCollege(college.id).length,
          categories: this.#db.categories.ofCollege(college.id).length,
          reports: mine.length,
          open: mine.filter((r) => r.isOpen).length,
          overdue: mine.filter((r) => r.isOpen && r.isOverdue).length,
          resolvedRate: mine.length === 0 ? null : Math.round((done.length / mine.length) * 100),
          medianHours: AnalyticsService.median(done.map((r) => r.resolutionMs / HOUR)),
          lastActivityAt: mine.reduce((latest, r) => Math.max(latest, r.lastActivityAt), college.createdAt),
          // Set up but never used is the failure mode worth flagging.
          dormant: mine.length === 0 && Date.now() - college.createdAt > 14 * DAY,
        };
      }).sort((a, b) => b.reports - a.reports),
    };
  }

  static median(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    return Math.round(value * 10) / 10;
  }

  static mean(values) {
    if (values.length === 0) return null;
    return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
  }
}
