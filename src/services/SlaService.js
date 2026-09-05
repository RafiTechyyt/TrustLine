// SlaService.js — the clock nobody has to remember to wind.
//
// A complaint system without a deadline is a suggestion box. Every report gets a
// response window when it is filed (category window, else desk window, else the
// college default), and this service is the only thing that acts when one runs
// out: it escalates the report to the college admin and says so in the thread.
//
// It also does the quiet housekeeping — resolved reports close themselves after a
// grace period so the reporter still has a window to say "no, it's still there".
//
// Runs on one interval, started at boot and stopped on shutdown. Everything it
// does is idempotent, so a missed tick or a double tick changes nothing.

import { Message } from "../core/Message.js";
import { STATUS } from "../core/status/states.js";
import { EV } from "../core/events/EventBus.js";
import { config } from "../config.js";

const HOUR = 60 * 60 * 1000;

export class SlaService {
  #db; #bus; #complaints; #timer = null; #lastSweep = null; #sweeps = 0;

  constructor({ db, bus, complaints }) {
    this.#db = db;
    this.#bus = bus;
    this.#complaints = complaints;
  }

  start({ intervalMs = config.sla.sweepIntervalMs } = {}) {
    if (this.#timer) return this;
    // unref so a forgotten interval never keeps the process alive.
    this.#timer = setInterval(() => { this.sweep().catch(() => {}); }, intervalMs);
    this.#timer.unref?.();
    return this;
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    return this;
  }

  get running() { return Boolean(this.#timer); }
  get stats() { return { running: this.running, sweeps: this.#sweeps, lastSweep: this.#lastSweep }; }

  /**
   * One pass. Escalates what has run out of time, closes what has been resolved
   * long enough, and nudges reporters who have gone quiet on a question.
   */
  async sweep() {
    const escalated = await this.#escalateBreaches();
    const closed = await this.#autoClose();
    const nudged = await this.#nudgeStalled();
    this.#sweeps += 1;
    this.#lastSweep = Date.now();
    return { escalated, closed, nudged, at: this.#lastSweep };
  }

  async #escalateBreaches() {
    const breaching = this.#db.complaints.breaching()
      // A report already sitting with the admin has nowhere further to go.
      .filter((report) => report.status !== STATUS.ESCALATED);
    const done = [];
    for (const report of breaching) {
      const hours = Math.round(-report.remainingMs / HOUR);
      try {
        await this.#complaints.escalate(null, report.traceCode,
          `No response within the ${hours + 1}-hour window this report was given.`);
        done.push(report.traceCode);
      } catch {
        // A report that cannot legally move (already terminal) is simply skipped.
      }
    }
    return done;
  }

  async #autoClose() {
    const closable = this.#db.complaints.closable(config.sla.autoCloseHours * HOUR);
    const done = [];
    for (const report of closable) {
      try {
        report.transitionTo(STATUS.CLOSED, { reason: "Closed automatically after the review window" });
        this.#db.complaints.save(report);
        this.#note(report, "Closed automatically — the review window passed with no objection. Reopening still works.");
        done.push(report.traceCode);
      } catch { /* skip anything the state machine refuses */ }
    }
    if (done.length > 0) await this.#flush();
    return done;
  }

  /**
   * A report parked on "waiting for you" forever is worse than a closed one: it
   * looks alive to the reporter and dead to the desk. After a week we say so in
   * the thread once, and only once.
   */
  async #nudgeStalled() {
    const cutoff = Date.now() - 7 * 24 * HOUR;
    const stalled = this.#db.complaints
      .where((r) => r.status === STATUS.AWAITING_REPORTER && r.lastActivityAt < cutoff);
    const done = [];
    for (const report of stalled) {
      const already = this.#db.messages
        .ofComplaint(report.traceCode, { includeInternal: true })
        .some((m) => m.kind === "nudge");
      if (already) continue;
      this.#note(report, "The desk is still waiting on an answer here. Reply in the thread to restart it.", "nudge");
      report.registerActivity();
      this.#db.complaints.save(report);
      done.push(report.traceCode);
    }
    if (done.length > 0) await this.#flush();
    return done;
  }

  // ---- the projections the dashboard reads ---------------------------------

  /**
   * SLA health for one college: what is late, what is about to be.
   *
   * `includeWorst` decides whether the five latest reports come back named. A desk
   * needs them — that list is the whole point of the dashboard. The public college
   * page must not have them: `openOfCollege` does not filter by visibility, so the
   * titles and trace codes in there would include private reports and confidential
   * categories, and a trace code is a credential. Public callers get the counts,
   * which is the accountability the page is for, and nothing that identifies a
   * report nobody chose to publish.
   */
  health(collegeId, { includeWorst = true } = {}) {
    const open = this.#db.complaints.openOfCollege(collegeId);
    const soon = open.filter((r) => {
      const left = r.remainingMs;
      return left !== null && left > 0 && left < 12 * HOUR;
    });
    const resolved = this.#db.complaints.ofCollege(collegeId).filter((r) => r.resolutionMs !== null);
    // A resolved report's clock has stopped, so `isOverdue` is false for all of
    // them. On-time has to be measured against the window it was given, allowing
    // for time the desk spent waiting on the reporter.
    const onTime = resolved.filter((r) => r.dueAt === null || r.resolvedAt <= r.dueAt + r.pausedMs).length;

    return {
      open: open.length,
      overdue: open.filter((r) => r.isOverdue).length,
      dueSoon: soon.length,
      escalated: open.filter((r) => r.escalated).length,
      onTimeRate: resolved.length === 0 ? null : Math.round((onTime / resolved.length) * 100),
      medianResolutionHours: SlaService.median(resolved.map((r) => r.resolutionMs / HOUR)),
      worst: !includeWorst ? [] : open
        .filter((r) => r.isOverdue)
        .sort((a, b) => a.remainingMs - b.remainingMs)
        .slice(0, 5)
        .map((r) => ({
          traceCode: r.traceCode,
          title: r.title,
          overdueHours: Math.round(-r.remainingMs / HOUR),
          departmentName: this.#db.departments.find(r.departmentId)?.name ?? "Triage",
        })),
    };
  }

  static median(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    return Math.round(value * 10) / 10;
  }

  #note(report, body, kind = "system") {
    const note = new Message({
      complaintId: report.traceCode, authorLabel: "TrustLine", body, kind,
    });
    this.#db.messages.insert(note);
    this.#bus.emit(EV.REPORT_STATUS, {
      collegeId: report.collegeId, complaintId: report.traceCode,
      status: report.status, statusLabel: report.statusLabel,
      summary: `${report.traceCode} — ${body}`,
    });
    return note;
  }

  async #flush() {
    await Promise.all([this.#db.complaints.flush(), this.#db.messages.flush()]);
  }
}
