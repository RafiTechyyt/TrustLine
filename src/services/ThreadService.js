// ThreadService.js — the anonymous two-way conversation.
//
// This is the part that makes an anonymous report actually workable. A desk can
// ask "which block, which floor?" and get an answer, without ever learning who
// is answering. The reporter is only ever "Kingfisher 7QX" — a handle minted at
// filing time that means nothing outside this one report.
//
// Three author types share one table, and one boolean decides everything about
// who sees what: `internal`. An internal note is a desk-only aside and is
// filtered out in the repository, not in the browser, so no UI bug can leak it.

import { Message } from "../core/Message.js";
import { STATUS } from "../core/status/states.js";
import { AUTHOR_TYPE } from "../core/enums.js";
import { P } from "../core/accounts/permissions.js";
import { EV } from "../core/events/EventBus.js";
import { config } from "../config.js";
import { check } from "../lib/validate.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors.js";
import { normaliseTraceCode } from "../lib/ids.js";

export class ThreadService {
  #db; #bus; #moderation;

  constructor({ db, bus, moderation }) {
    this.#db = db;
    this.#bus = bus;
    this.#moderation = moderation;
  }

  // ---- the reporter's side -------------------------------------------------

  /**
   * A reply from the person holding the trace code. Two side effects matter:
   * the desk's clock restarts if it was waiting on this answer, and the text is
   * scanned again — a reporter who stayed anonymous in the description often
   * gives themselves away in the follow-up.
   */
  async replyAsReporter(traceCode, passphrase, body) {
    const report = this.#unlock(traceCode, passphrase);
    if (!report.isOpen && report.status !== STATUS.RESOLVED) {
      throw new ConflictError("This report is closed. Reopen it if the problem is still there.");
    }
    const text = this.#validBody(body);
    const privacy = this.#moderation.scan(text);
    if (privacy.blocked) {
      throw new ValidationError("That message contains an identity number that must not be stored.", {
        body: privacy.findings.filter((f) => f.severity === "block").map((f) => f.advice).join(" "),
      });
    }

    const message = this.#append(report, {
      authorType: AUTHOR_TYPE.REPORTER,
      authorLabel: report.handle,
      body: text,
      readByReporter: true,
    });

    // Answering a question is what un-blocks the desk, so the status moves
    // itself. The reporter never has to know a status machine exists.
    if (report.status === STATUS.AWAITING_REPORTER) {
      report.transitionTo(STATUS.IN_PROGRESS, { reason: "The reporter answered" });
      this.#system(report, "The reporter answered, so this is back with the desk.");
    } else {
      report.registerActivity();
    }
    this.#db.complaints.save(report);
    await this.#flush();

    this.#bus.emit(EV.THREAD_MESSAGE, {
      collegeId: report.collegeId, complaintId: report.traceCode, departmentId: report.departmentId,
      authorType: AUTHOR_TYPE.REPORTER, status: report.status,
      summary: `${report.handle} replied on ${report.traceCode}`,
    });
    return { message: message.view(), status: report.status, privacyFindings: privacy.findings };
  }

  // ---- the desk's side -----------------------------------------------------

  /** A reply the reporter will see. */
  async replyAsDesk(account, traceCode, body, { askReporter = false } = {}) {
    this.#require(account, P.REPORTS_REPLY);
    const report = this.#deskReport(account, traceCode);
    const text = this.#validBody(body);

    const message = this.#append(report, {
      authorType: AUTHOR_TYPE.OFFICER,
      authorId: account.id,
      authorLabel: this.#deskLabel(report),
      body: text,
      readByDesk: true,
    });

    // Replying is itself an acknowledgement: a report nobody had picked up is
    // now demonstrably being read.
    if (report.status === STATUS.SUBMITTED) report.transitionTo(STATUS.TRIAGED, { actorId: account.id });
    if (askReporter && report.status !== STATUS.AWAITING_REPORTER) {
      report.transitionTo(STATUS.AWAITING_REPORTER, { reason: "The desk asked the reporter a question" });
    }
    if (!report.assignedTo) report.claim(account.id);
    report.registerActivity();
    this.#db.complaints.save(report);
    await this.#flush();

    this.#bus.emit(EV.THREAD_MESSAGE, {
      collegeId: report.collegeId, complaintId: report.traceCode, departmentId: report.departmentId,
      authorType: AUTHOR_TYPE.OFFICER, status: report.status,
      actorId: account.id, actorLabel: account.name, actorRole: account.role,
      summary: `${account.name} replied on ${report.traceCode}`,
    });
    return { message: message.view(), status: report.status, statusLabel: report.statusLabel };
  }

  /**
   * A note only the desk can read. Held to a different permission from a reply
   * so a role could later be given one without the other.
   */
  async note(account, traceCode, body) {
    this.#require(account, P.REPORTS_NOTE);
    const report = this.#deskReport(account, traceCode);
    const message = this.#append(report, {
      authorType: AUTHOR_TYPE.OFFICER,
      authorId: account.id,
      authorLabel: account.name,
      body: this.#validBody(body),
      internal: true,
      kind: "note",
      readByDesk: true,
    });
    report.registerActivity();
    this.#db.complaints.save(report);
    await this.#flush();
    return message.view();
  }

  // ---- reads ---------------------------------------------------------------

  /** The reporter's thread: system lines and desk replies, never internal notes. */
  forReporter(traceCode, passphrase) {
    const report = this.#unlock(traceCode, passphrase);
    return this.#db.messages.ofComplaint(report.traceCode).map((m) => m.view());
  }

  forDesk(account, traceCode) {
    const report = this.#deskReport(account, traceCode);
    return this.#db.messages.ofComplaint(report.traceCode, { includeInternal: true }).map((m) => m.view());
  }

  /** Badge counts for the ops header. */
  unreadForDesk(account) {
    const scope = account.can(P.REPORTS_READ_ALL)
      ? this.#db.complaints.ofCollege(account.collegeId)
      : this.#db.complaints.ofDepartments(account.departmentIds);
    return scope.reduce((total, report) => total + this.#db.messages.unreadForDesk(report.traceCode), 0);
  }

  // ---- internals -----------------------------------------------------------

  #append(report, attrs) {
    const message = new Message({ complaintId: report.traceCode, ...attrs });
    this.#db.messages.insert(message);
    return message;
  }

  #system(report, body) {
    return this.#append(report, {
      authorType: AUTHOR_TYPE.SYSTEM, authorLabel: "TrustLine", body, kind: "system",
    });
  }

  #validBody(body) {
    return check({ body })
      .text("body", { min: 2, max: config.limits.messageMax, label: "Message" })
      .done().body;
  }

  /**
   * What the reporter sees a desk reply signed as. The individual officer's name
   * is deliberately not shown: the reporter is dealing with a desk, and keeping
   * it that way stops a thread turning into two named people arguing.
   */
  #deskLabel(report) {
    const desk = this.#db.departments.find(report.departmentId);
    return desk ? `${desk.name} desk` : "College desk";
  }

  #unlock(traceCode, passphrase) {
    const code = normaliseTraceCode(traceCode) ?? traceCode;
    const report = this.#db.complaints.find(code);
    if (!report) throw new NotFoundError("Report");
    if (!report.unlocks(passphrase)) {
      throw new ForbiddenError("That trace code needs the passphrase you set when filing");
    }
    return report;
  }

  #deskReport(account, traceCode) {
    const code = normaliseTraceCode(traceCode) ?? traceCode;
    const report = this.#db.complaints.find(code);
    if (!report || !account.canRead(report)) throw new ForbiddenError("That report is not on your desk");
    return report;
  }

  #require(account, permission) {
    if (!account?.can(permission)) throw new ForbiddenError("This account cannot do that");
  }

  async #flush() {
    await Promise.all([this.#db.messages.flush(), this.#db.complaints.flush()]);
  }
}
