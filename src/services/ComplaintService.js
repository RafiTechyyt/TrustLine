// ComplaintService.js — filing, tracking and working a report.
//
// This is where the patterns meet. Filing a report is: validate, scan for
// self-doxxing, ask the router which desk it belongs to, ask the priority policy
// how urgent it is, build the entity, announce it. Each of those four is a
// separate object that can be swapped without touching this file.
//
// Nothing here compares a role string or reads a status string to decide what is
// allowed. The account subclass answers the first question and the state object
// answers the second.

import { Complaint } from "../core/Complaint.js";
import { Message } from "../core/Message.js";
import { STATUS, StateRegistry } from "../core/status/states.js";
import { PRIORITY, PRIORITY_RANK, VISIBILITY, CONTACT_SHARING, AUTHOR_TYPE } from "../core/enums.js";
import { ReporterFactory } from "../core/reporters/reporters.js";
import { defaultRouter } from "../core/routing/strategies.js";
import { defaultPriorityPolicy } from "../core/priority/policies.js";
import { P } from "../core/accounts/permissions.js";
import { EV } from "../core/events/EventBus.js";
import { config } from "../config.js";
import { check } from "../lib/validate.js";
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from "../lib/errors.js";
import { normaliseTraceCode } from "../lib/ids.js";

const HOUR = 60 * 60 * 1000;

export class ComplaintService {
  #db; #bus; #moderation; #similarity; #router; #priority;

  constructor({ db, bus, moderation, similarity, router = defaultRouter(), priority = defaultPriorityPolicy() }) {
    this.#db = db;
    this.#bus = bus;
    this.#moderation = moderation;
    this.#similarity = similarity;
    this.#router = router;
    this.#priority = priority;
  }

  // ---- what the report form needs -----------------------------------------

  catalogue(collegeId) {
    const college = this.#liveCollege(collegeId);
    return {
      college: college.publicView(),
      categories: this.#db.categories.ofCollege(collegeId)
        .filter((c) => c.isRouted)
        .map((c) => c.publicView()),
      reporters: ReporterFactory.catalogue()
        .filter((r) => college.settings.allowVisitorReports || r.key !== "visitor"),
      rail: StateRegistry.rail(),
    };
  }

  /**
   * A dry run of filing. Powers the live panel in the report wizard: what the
   * text gives away, who else has said this, and which desk it will reach —
   * all before anything is written down.
   */
  preview({ collegeId, title = "", body = "", categoryId = null, reporterKey = "student" }) {
    const college = this.#liveCollege(collegeId);
    const privacy = this.#moderation.scan(title, body);
    const quality = this.#moderation.quality(title, body);
    const context = this.#routingContext(collegeId);
    const decision = (title || body)
      ? this.#router.decide({ title, body, categoryId, reporterKey }, context)
      : null;
    const desk = decision ? this.#db.departments.find(decision.departmentId) : null;

    return {
      privacy,
      quality,
      duplicates: (title.length + body.length) > 25
        ? this.#similarity.suggestForReporter(
          { traceCode: null, title, body },
          this.#db.complaints.ofCollege(collegeId),
          { sameCategory: categoryId },
        )
        : [],
      routing: decision && desk
        ? { department: desk.name, explains: decision.explains, confidence: Math.round(decision.confidence * 100) }
        : null,
      passphraseRequired: college.settings.requirePassphrase,
    };
  }

  // ---- filing --------------------------------------------------------------

  async file(input, { supportKey = null } = {}) {
    const college = this.#liveCollege(input.collegeId);
    const draft = this.#validateDraft(input, college);

    const privacy = this.#moderation.scan(draft.title, draft.body);
    if (privacy.blocked) {
      throw new ValidationError(
        "That description contains an identity number that must not be stored. Please remove it.",
        { body: privacy.findings.filter((f) => f.severity === "block").map((f) => f.advice).join(" ") },
      );
    }

    const context = this.#routingContext(college.id);
    const decision = this.#router.decide(draft, context);
    if (!decision) {
      throw new ConflictError(`${college.shortName} has not finished setting up its desks yet. Try again shortly.`);
    }

    const category = decision.categoryId ? this.#db.categories.find(decision.categoryId) : null;
    // Evidence is described, not uploaded. There is no file store here on
    // purpose — a photo of a hostel room with a face in it is exactly the thing
    // an anonymous system should not be holding. `mime` says what these are and
    // `storedAs: null` says nothing was kept, so a desk reading the list can
    // tell at a glance that it has to ask for the file itself.
    const described = (Array.isArray(input.evidence) ? input.evidence : []).slice(0, 4)
      .map((item, i) => ({
        id: `d${i + 1}`,
        name: String(item?.name ?? item?.label ?? "").trim().slice(0, 160),
        mime: "text/description",
        bytes: 0,
        storedAs: null,
      }))
      .filter((item) => item.name.length >= 3);
    if (category?.requireEvidence && described.length === 0) {
      throw new ValidationError(`“${category.name}” needs you to say what you can show`, { evidence: "required" });
    }

    const report = new Complaint({
      collegeId: college.id,
      categoryId: decision.categoryId,
      departmentId: decision.departmentId,
      reporterKey: draft.reporterKey,
      title: draft.title,
      body: draft.body,
      location: draft.location,
      occurredAt: draft.occurredAt,
      evidence: described,
      // A confidential category overrides the reporter's choice: a grievance
      // report never lands on a public feed even if the box was ticked.
      visibility: draft.wantsPublic && category?.allowPublic !== false && !category?.confidential
        ? VISIBILITY.PUBLIC
        : VISIBILITY.PRIVATE,
      passphrase: draft.passphrase,
    });

    report.routeTo(decision.departmentId, {
      categoryId: decision.categoryId,
      reason: decision.reason,
      strategy: decision.strategy,
    });
    if (decision.tag) report.addTag(decision.tag);
    for (const tag of draft.tags) report.addTag(tag);
    if (privacy.findings.some((f) => f.severity === "high")) report.addTag("self-identifying");

    const verdict = this.#priority.assess(report, this.#priorityContext(report, category));
    report.setPriority(verdict.priority, { floor: decision.priorityFloor ?? PRIORITY.LOW });
    report.setDueAt(Date.now() + this.#slaHours(report, college, category) * HOUR);
    if (draft.contact) report.shareContact(draft.contact);
    if (supportKey) report.addSupport(supportKey);

    this.#db.complaints.insert(report);
    this.#systemNote(report, this.#receiptLine(report, decision, verdict));
    await Promise.all([this.#db.complaints.flush(), this.#db.messages.flush()]);

    this.#bus.emit(EV.REPORT_FILED, {
      collegeId: college.id, complaintId: report.traceCode, departmentId: report.departmentId,
      categoryId: report.categoryId, priority: report.priority, strategy: decision.strategy,
      reason: decision.reason, summary: `Filed and routed by ${decision.strategy}`,
    });

    return {
      report,
      receipt: {
        traceCode: report.traceCode,
        handle: report.handle,
        department: this.#db.departments.find(report.departmentId)?.name ?? "Triage",
        category: category?.name ?? null,
        priority: report.priority,
        dueAt: report.dueAt,
        explains: decision.explains,
        routedBy: decision.strategy,
        priorityReason: verdict.reason,
        visibility: report.visibility,
        privacyFindings: privacy.findings,
      },
    };
  }

  // ---- helpers used by filing ---------------------------------------------

  #validateDraft(input, college) {
    const v = check(input)
      .text("title", { min: 6, max: config.limits.titleMax })
      .text("body", { min: 20, max: config.limits.descriptionMax })
      .oneOf("reporterKey", ReporterFactory.keys)
      .bool("wantsPublic")
      .text("location", { required: false, max: 120 })
      .done();

    if (!college.settings.publicFeed) v.wantsPublic = false;
    if (v.reporterKey === "visitor" && !college.settings.allowVisitorReports) {
      throw new ValidationError(`${college.shortName} is not accepting reports from visitors`, { reporterKey: "not allowed" });
    }
    if (college.settings.requirePassphrase && !String(input.passphrase || "").trim()) {
      throw new ValidationError(`${college.shortName} requires a passphrase on every report`, { passphrase: "required" });
    }

    const category = input.categoryId ? this.#db.categories.find(input.categoryId) : null;
    if (input.categoryId && (!category || category.collegeId !== college.id || !category.active)) {
      throw new ValidationError("That category is not available", { categoryId: "unknown" });
    }
    if (category && category.audiences.length > 0 && !category.audiences.includes(v.reporterKey)) {
      throw new ValidationError(`“${category.name}” is not open to this kind of reporter`, { categoryId: "audience" });
    }

    return {
      ...v,
      categoryId: category?.id ?? null,
      occurredAt: Number(input.occurredAt) || null,
      passphrase: String(input.passphrase || "").trim() || null,
      tags: Array.isArray(input.tags) ? input.tags.slice(0, 5) : [],
      contact: this.#validateContact(input.contact),
    };
  }

  #validateContact(contact) {
    if (!contact || contact.sharing === CONTACT_SHARING.NONE || !contact.value) return null;
    const value = String(contact.value).trim();
    const channel = contact.channel === "phone" ? "phone" : "email";
    if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new ValidationError("That does not look like an email address", { contact: "invalid" });
    }
    if (channel === "phone" && value.replace(/\D/g, "").length < 10) {
      throw new ValidationError("That does not look like a phone number", { contact: "invalid" });
    }
    return { sharing: contact.sharing, channel, value };
  }

  #routingContext(collegeId) {
    return {
      categories: this.#db.categories.ofCollege(collegeId),
      departments: this.#db.departments.ofCollege(collegeId),
      openCountByDepartment: this.#db.complaints.openCountByDepartment(collegeId),
    };
  }

  #priorityContext(report, category) {
    return {
      category,
      reporter: report.reporter,
      recentSameCategory: report.categoryId
        ? this.#db.complaints.recentInCategory(report.collegeId, report.categoryId)
        : 0,
    };
  }

  /** Category window beats desk window beats college default. */
  #slaHours(report, college, category) {
    const desk = this.#db.departments.find(report.departmentId);
    const hours = category?.slaHours ?? desk?.slaHours ?? college.settings.defaultSlaHours ?? config.sla.defaultHours;
    return report.priority === PRIORITY.URGENT ? Math.min(hours, config.sla.urgentHours) : hours;
  }

  #receiptLine(report, decision, verdict) {
    const desk = this.#db.departments.find(report.departmentId)?.name ?? "triage";
    return `Filed as ${report.traceCode} and sent to ${desk}. ${decision.reason}. Priority ${report.priority} — ${verdict.reason}.`;
  }

  #systemNote(report, body, meta = null) {
    const note = new Message({
      complaintId: report.traceCode, authorType: AUTHOR_TYPE.SYSTEM,
      authorLabel: "TrustLine", body, kind: "system", meta,
    });
    this.#db.messages.insert(note);
    return note;
  }

  #liveCollege(collegeId) {
    const college = this.#db.colleges.find(collegeId);
    if (!college) throw new NotFoundError("College");
    if (!college.acceptsReports) throw new ForbiddenError(`${college.name} is not accepting reports yet`);
    return college;
  }

  // ---- the public feed ----------------------------------------------------

  feed(collegeId, filters = {}) {
    const college = this.#db.colleges.require(collegeId, "College");
    if (!college.settings.publicFeed) return { college: college.publicView(), reports: [], categories: [] };
    const categories = this.#db.categories.ofCollege(collegeId);
    const rows = this.#db.complaints.feed(collegeId, {
      confidentialCategoryIds: new Set(categories.filter((c) => c.confidential).map((c) => c.id)),
      ...filters,
    });
    const nameOf = new Map(categories.map((c) => [c.id, c.name]));
    const deskOf = new Map(this.#db.departments.ofCollege(collegeId).map((d) => [d.id, d.name]));

    return {
      college: college.publicView(),
      categories: categories.filter((c) => !c.confidential).map((c) => ({
        id: c.id, name: c.name, glyph: c.glyph,
        count: rows.filter((r) => r.categoryId === c.id).length,
      })),
      reports: rows.slice(0, filters.limit ?? 60).map((report) => ({
        ...report.publicView(),
        categoryName: nameOf.get(report.categoryId) ?? "General",
        departmentName: deskOf.get(report.departmentId) ?? null,
        replyCount: this.#db.messages.ofComplaint(report.traceCode).filter((m) => !m.isSystem).length,
      })),
      total: rows.length,
    };
  }

  /** A single public report, with the thread minus internal notes. */
  publicOne(traceCode) {
    const report = this.#requireReport(traceCode);
    const category = this.#db.categories.find(report.categoryId);
    if (!report.isPublic || report.mergedInto || category?.confidential) {
      throw new NotFoundError("Report");
    }
    return {
      ...report.publicView(),
      categoryName: category?.name ?? "General",
      departmentName: this.#db.departments.find(report.departmentId)?.name ?? null,
      // `ofComplaint` drops internal desk notes unless asked for them. The filter
      // is here and not in the browser, so a UI bug cannot leak an aside.
      thread: this.#db.messages.ofComplaint(report.traceCode).map((m) => m.view()),
    };
  }

  // ---- tracking, by the person who filed ----------------------------------

  /** Trace code opens the report; a passphrase is also needed if one was set. */
  track(traceCode, passphrase = null) {
    const report = this.#requireReport(traceCode);
    if (!report.unlocks(passphrase)) {
      throw new ForbiddenError("That trace code needs the passphrase you set when filing");
    }
    const messages = this.#db.messages.ofComplaint(report.traceCode);
    for (const message of messages) {
      if (!message.fromReporter && !message.readByReporter) {
        message.markRead({ reporter: true });
        this.#db.messages.save(message);
      }
    }
    return {
      ...report.reporterView(),
      categoryName: this.#db.categories.find(report.categoryId)?.name ?? "General",
      departmentName: this.#db.departments.find(report.departmentId)?.name ?? null,
      rail: StateRegistry.rail(),
      thread: messages.map((m) => m.view()),
      mergedIntoTitle: report.mergedInto ? this.#db.complaints.find(report.mergedInto)?.title ?? null : null,
    };
  }

  async support(traceCode, key) {
    const report = this.#requireReport(traceCode);
    if (!report.isPublic) throw new NotFoundError("Report");
    if (!report.addSupport(key)) throw new ConflictError("You have already backed this report");
    this.#db.complaints.save(report);

    // Backing can push a report up the queue, so re-run the policy.
    const before = report.priority;
    const verdict = this.#priority.assess(report, this.#priorityContext(report, this.#db.categories.find(report.categoryId)));
    report.setPriority(verdict.priority, { floor: before });
    this.#db.complaints.save(report);
    await this.#db.complaints.flush();

    if (report.priority !== before) {
      this.#systemNote(report, `Priority raised to ${report.priority} — ${verdict.reason}.`);
      await this.#db.messages.flush();
      this.#bus.emit(EV.REPORT_PRIORITY, {
        collegeId: report.collegeId, complaintId: report.traceCode,
        priority: report.priority, reason: verdict.reason, summary: `Priority → ${report.priority}`,
      });
    }
    this.#bus.emit(EV.REPORT_BACKED, {
      collegeId: report.collegeId, complaintId: report.traceCode,
      supportCount: report.supportCount, summary: "Someone backed this report",
    });
    return { supportCount: report.supportCount, priority: report.priority };
  }

  // ---- reporter actions on their own report --------------------------------

  /** Every reporter-side mutation goes through here first. */
  #openReport(traceCode, passphrase) {
    const report = this.#requireReport(traceCode);
    if (!report.unlocks(passphrase)) {
      throw new ForbiddenError("That trace code needs the passphrase you set when filing");
    }
    return report;
  }

  async withdraw(traceCode, passphrase, reason = "") {
    const report = this.#openReport(traceCode, passphrase);
    report.transitionTo(STATUS.WITHDRAWN);
    this.#db.complaints.save(report);
    this.#systemNote(report, `Withdrawn by the reporter.${reason ? ` Reason: ${String(reason).slice(0, 200)}` : ""}`);
    await this.#flushAll();
    this.#announceStatus(report, "withdrawn by the reporter");
    return report.reporterView();
  }

  /** Editing is allowed while the desk has not closed it out. */
  async revise(traceCode, passphrase, patch) {
    const report = this.#openReport(traceCode, passphrase);
    if (!report.isOpen) throw new ConflictError("This report is closed out, so it can no longer be edited");
    const next = {
      title: patch.title ?? report.title,
      body: patch.body ?? report.body,
    };
    const privacy = this.#moderation.scan(next.title, next.body);
    if (privacy.blocked) {
      throw new ValidationError("That edit puts an identity number back into the report. Please remove it.", {
        body: privacy.findings.filter((f) => f.severity === "block").map((f) => f.advice).join(" "),
      });
    }
    check({ ...next, location: patch.location ?? report.location })
      .text("title", { min: 6, max: config.limits.titleMax })
      .text("body", { min: 20, max: config.limits.descriptionMax })
      .text("location", { required: false, max: 120 })
      .done();

    report.revise({ ...patch, ...next });
    this.#db.complaints.save(report);
    this.#systemNote(report, "The reporter edited the description.");
    await this.#flushAll();
    return { ...report.reporterView(), privacyFindings: privacy.findings };
  }

  /** Pulling a report onto the feed, or off it, stays the reporter's call. */
  async setVisibility(traceCode, passphrase, visibility) {
    const report = this.#openReport(traceCode, passphrase);
    const college = this.#db.colleges.require(report.collegeId, "College");
    const category = this.#db.categories.find(report.categoryId);
    const wantsPublic = visibility === VISIBILITY.PUBLIC;

    if (wantsPublic && !college.settings.publicFeed) {
      throw new ConflictError(`${college.shortName} has switched its public feed off`);
    }
    if (wantsPublic && (category?.confidential || category?.allowPublic === false)) {
      throw new ConflictError(`Reports in “${category.name}” are never shown publicly`);
    }
    report.setVisibility(wantsPublic ? VISIBILITY.PUBLIC : VISIBILITY.PRIVATE);
    this.#db.complaints.save(report);
    this.#systemNote(report, wantsPublic
      ? "The reporter published this to the college feed."
      : "The reporter took this off the college feed.");
    await this.#flushAll();
    return { visibility: report.visibility };
  }

  async shareContact(traceCode, passphrase, contact) {
    const report = this.#openReport(traceCode, passphrase);
    const validated = this.#validateContact(contact);
    report.shareContact(validated ?? { sharing: CONTACT_SHARING.NONE });
    this.#db.complaints.save(report);
    this.#systemNote(report, validated
      ? `The reporter shared a ${validated.channel} for follow-up (${validated.sharing === CONTACT_SHARING.ADMIN_ONLY ? "college admin only" : "handling desk"}).`
      : "The reporter withdrew their contact detail.");
    await this.#flushAll();
    return { contactSharing: report.contactSharing };
  }

  async rate(traceCode, passphrase, { score, note = "" }) {
    const report = this.#openReport(traceCode, passphrase);
    if (report.isOpen) throw new ConflictError("You can rate the handling once this report is closed out");
    report.rate(score, note);
    this.#db.complaints.save(report);
    await this.#db.complaints.flush();
    this.#bus.emit(EV.REPORT_RATED, {
      collegeId: report.collegeId, complaintId: report.traceCode,
      departmentId: report.departmentId, satisfaction: report.satisfaction,
      summary: `Reporter rated the handling ${report.satisfaction}/5`,
    });
    return { satisfaction: report.satisfaction, feedback: report.feedback };
  }

  /** "This is not actually fixed." Puts a closed report back in the queue. */
  async reopen(traceCode, passphrase, reason = "") {
    const report = this.#openReport(traceCode, passphrase);
    if (report.isOpen) throw new ConflictError("This report is already open");
    if (report.reopenCount >= config.limits.maxReopens) {
      throw new ConflictError("This report has been reopened too many times. Ask the desk in the thread instead.");
    }
    report.transitionTo(STATUS.IN_PROGRESS, { reason });
    report.setDueAt(Date.now() + config.sla.reopenHours * HOUR);
    this.#db.complaints.save(report);
    this.#systemNote(report, `Reopened by the reporter.${reason ? ` “${String(reason).slice(0, 200)}”` : ""}`);
    await this.#flushAll();
    this.#announceStatus(report, "reopened by the reporter");
    return report.reporterView();
  }

  // ---- the desk ------------------------------------------------------------

  /**
   * A department officer's scope is their desks; a college admin's is the whole
   * college. Neither is worked out from a role string — the account subclass
   * answers `can()` and the repository is asked for exactly that slice.
   */
  #scopeFor(account) {
    if (account.can(P.REPORTS_READ_ALL)) return this.#db.complaints.ofCollege(account.collegeId);
    if (account.can(P.REPORTS_READ_ASSIGNED)) return this.#db.complaints.ofDepartments(account.departmentIds);
    throw new ForbiddenError("This account cannot read reports");
  }

  deskQueue(account, filters = {}) {
    const scope = this.#scopeFor(account);
    const rows = this.#db.complaints.queue(scope, filters);
    const deskOf = new Map(this.#db.departments.ofCollege(account.collegeId, { includeInactive: true }).map((d) => [d.id, d.name]));
    const nameOf = new Map(this.#db.categories.ofCollege(account.collegeId, { includeInactive: true }).map((c) => [c.id, c.name]));
    const officerOf = new Map(this.#db.accounts.ofCollege(account.collegeId).map((a) => [a.id, a.name]));

    return {
      total: rows.length,
      counts: this.#queueCounts(scope),
      reports: rows.slice(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 40)).map((report) => ({
        ...report.publicView(),
        priorityRank: report.priorityRank,
        assignedTo: report.assignedTo,
        assignedName: officerOf.get(report.assignedTo) ?? null,
        categoryName: nameOf.get(report.categoryId) ?? "General",
        departmentName: deskOf.get(report.departmentId) ?? "Triage",
        dueAt: report.dueAt,
        remainingMs: report.remainingMs,
        unreadFromReporter: this.#db.messages.unreadForDesk(report.traceCode),
        hasContact: report.hasContact,
      })),
    };
  }

  #queueCounts(scope) {
    return {
      total: scope.length,
      open: scope.filter((r) => r.isOpen).length,
      unassigned: scope.filter((r) => r.isOpen && !r.assignedTo).length,
      overdue: scope.filter((r) => r.isOpen && r.isOverdue).length,
      escalated: scope.filter((r) => r.escalated && r.isOpen).length,
      urgent: scope.filter((r) => r.isOpen && r.priority === PRIORITY.URGENT).length,
      awaitingReporter: scope.filter((r) => r.status === STATUS.AWAITING_REPORTER).length,
      resolvedThisWeek: scope.filter((r) => r.resolvedAt && Date.now() - r.resolvedAt < 7 * 24 * HOUR).length,
    };
  }

  /** The desk detail view: everything an officer needs on one screen. */
  deskOne(account, traceCode) {
    const report = this.#deskReport(account, traceCode);
    const category = this.#db.categories.find(report.categoryId);
    const messages = this.#db.messages.ofComplaint(report.traceCode, { includeInternal: true });
    for (const message of messages) {
      if (message.fromReporter && !message.readByDesk) {
        message.markRead({ desk: true });
        this.#db.messages.save(message);
      }
    }

    return {
      ...report.deskView(account),
      categoryName: category?.name ?? "General",
      departmentName: this.#db.departments.find(report.departmentId)?.name ?? "Triage",
      rail: StateRegistry.rail(),
      thread: messages.map((m) => m.view()),
      duplicates: this.#similarity.suggestMerges(report, this.#db.complaints.ofDepartment(report.departmentId)),
      privacy: this.#moderation.scan(report.title, report.body).findings,
      // Options, not free text: the state object decides what may happen next.
      transitions: report.state.allowedNext().map((key) => {
        const state = StateRegistry.get(key);
        return { key, label: state.label, tone: state.tone };
      }),
      desks: this.#db.departments.ofCollege(report.collegeId).map((d) => ({ id: d.id, name: d.name })),
      categories: this.#db.categories.ofCollege(report.collegeId).map((c) => ({ id: c.id, name: c.name })),
      officers: this.#db.accounts.ofCollege(report.collegeId)
        .filter((a) => a.isActive && a.can(P.REPORTS_STATUS_WRITE))
        .map((a) => ({ id: a.id, name: a.name, title: a.title })),
      mergedIntoTitle: report.mergedInto ? this.#db.complaints.find(report.mergedInto)?.title ?? null : null,
      absorbed: report.mergedFrom
        .map((code) => this.#db.complaints.find(code))
        .filter(Boolean)
        .map((r) => ({ traceCode: r.traceCode, title: r.title })),
    };
  }

  // ---- desk mutations ------------------------------------------------------

  /**
   * The status field is never assigned to. The desk names a target, the state
   * object decides whether that move is legal, and an illegal one throws a 409
   * rather than silently doing nothing.
   */
  async changeStatus(account, traceCode, { status, note = "", reason = "" }) {
    this.#requirePermission(account, P.REPORTS_STATUS_WRITE);
    const report = this.#deskReport(account, traceCode);
    const from = report.statusLabel;
    report.transitionTo(status, { reason: reason || note, actorId: account.id });
    if (status === STATUS.IN_PROGRESS && !report.assignedTo) report.claim(account.id);
    this.#db.complaints.save(report);

    // The reporter is told what changed, and the desk's own words are carried
    // across so the thread reads as one conversation rather than a status log.
    this.#systemNote(report, `${from} → ${report.statusLabel}${note ? `. ${String(note).slice(0, 400)}` : "."}`, {
      by: account.name, role: account.role,
    });
    await this.#flushAll();
    this.#announceStatus(report, `moved to ${report.statusLabel} by ${account.name}`);
    return report.deskView(account);
  }

  async claim(account, traceCode) {
    this.#requirePermission(account, P.REPORTS_STATUS_WRITE);
    const report = this.#deskReport(account, traceCode);
    report.claim(account.id);
    if (report.status === STATUS.SUBMITTED) report.transitionTo(STATUS.TRIAGED, { actorId: account.id });
    this.#db.complaints.save(report);
    this.#systemNote(report, `${account.name} at the desk picked this up.`, { by: account.name });
    await this.#flushAll();
    this.#announceStatus(report, `picked up by ${account.name}`);
    return report.deskView(account);
  }

  async assign(account, traceCode, officerId) {
    this.#requirePermission(account, P.REPORTS_ASSIGN);
    const report = this.#deskReport(account, traceCode);
    if (!officerId) {
      report.release();
    } else {
      const officer = this.#db.accounts.require(officerId, "Officer");
      if (officer.collegeId !== report.collegeId) throw new ForbiddenError("That officer is at another college");
      if (!officer.canRead(report)) {
        throw new ValidationError(`${officer.name} does not hold the desk this report is on`, { officerId: "out of scope" });
      }
      report.claim(officer.id);
    }
    this.#db.complaints.save(report);
    await this.#db.complaints.flush();
    return report.deskView(account);
  }

  /**
   * Manual override of the router. An officer can only push a report *away* from
   * their own desk, never pull someone else's onto it — `#deskReport` already
   * refused anything outside their scope before we get here.
   */
  async reroute(account, traceCode, { departmentId, categoryId, reason = "" }) {
    this.#requirePermission(account, P.REPORTS_ASSIGN);
    const report = this.#deskReport(account, traceCode);
    const desk = this.#db.departments.require(departmentId, "Department");
    if (desk.collegeId !== report.collegeId) throw new ForbiddenError("That desk belongs to another college");
    if (!desk.active) throw new ValidationError("That desk is switched off", { departmentId: "inactive" });

    let nextCategory;
    if (categoryId !== undefined) {
      const category = categoryId ? this.#db.categories.require(categoryId, "Category") : null;
      if (category && category.collegeId !== report.collegeId) throw new ForbiddenError("That category belongs to another college");
      nextCategory = category?.id ?? null;
    }

    const from = this.#db.departments.find(report.departmentId)?.name ?? "Triage";
    report.routeTo(desk.id, {
      ...(nextCategory !== undefined ? { categoryId: nextCategory } : {}),
      reason: reason || `Moved by ${account.name}`,
      strategy: "manual",
    });
    // Handing a report on restarts the response window: the new desk has not
    // had its chance yet, so it should not inherit a clock that already ran out.
    report.setDueAt(Date.now() + this.#slaHours(
      report,
      this.#db.colleges.require(report.collegeId, "College"),
      this.#db.categories.find(report.categoryId),
    ) * HOUR);
    if (report.assignedTo && !this.#db.accounts.find(report.assignedTo)?.departmentIds.includes(desk.id)) {
      report.release();
    }
    this.#db.complaints.save(report);
    this.#systemNote(report, `Moved from ${from} to ${desk.name}.${reason ? ` ${String(reason).slice(0, 200)}` : ""}`, {
      by: account.name,
    });
    await this.#flushAll();
    this.#bus.emit(EV.REPORT_ROUTED, {
      collegeId: report.collegeId, complaintId: report.traceCode, departmentId: desk.id,
      actorId: account.id, actorLabel: account.name, actorRole: account.role,
      summary: `${report.traceCode} moved to ${desk.name}`,
    });
    return report.deskView(account);
  }

  async prioritise(account, traceCode, priority, reason = "") {
    this.#requirePermission(account, P.REPORTS_STATUS_WRITE);
    const report = this.#deskReport(account, traceCode);
    // Who filed, and what about, sets a floor the desk cannot go under. A parent
    // reporting a safety matter does not get quietly moved down to "low" — that
    // floor is a property of the report, not a desk preference. Raising is always
    // allowed; only going under the floor is refused, and it says why.
    const floor = report.reporter.priorityFloor(this.#db.categories.find(report.categoryId));
    if ((PRIORITY_RANK[priority] ?? 0) < PRIORITY_RANK[floor]) {
      throw new ValidationError(
        `This report is held at ${floor} priority or above, because of who filed it and what it is about.`,
        { priority: `cannot go below ${floor}` },
      );
    }
    const before = report.priority;
    report.setPriority(priority, { floor });
    if (report.priority === before) return report.deskView(account);
    report.setDueAt(Date.now() + this.#slaHours(
      report,
      this.#db.colleges.require(report.collegeId, "College"),
      this.#db.categories.find(report.categoryId),
    ) * HOUR);
    this.#db.complaints.save(report);
    this.#systemNote(report, `Priority changed from ${before} to ${report.priority}.${reason ? ` ${String(reason).slice(0, 200)}` : ""}`, {
      by: account.name,
    });
    await this.#flushAll();
    this.#bus.emit(EV.REPORT_PRIORITY, {
      collegeId: report.collegeId, complaintId: report.traceCode, priority: report.priority,
      actorId: account.id, actorLabel: account.name, actorRole: account.role,
      reason: reason || "Set by the desk", summary: `Priority → ${report.priority}`,
    });
    return report.deskView(account);
  }

  async tag(account, traceCode, { add = [], remove = [] }) {
    this.#requirePermission(account, P.REPORTS_NOTE);
    const report = this.#deskReport(account, traceCode);
    for (const value of add) report.addTag(value);
    for (const value of remove) report.removeTag(value);
    this.#db.complaints.save(report);
    await this.#db.complaints.flush();
    return { tags: report.tags };
  }

  /**
   * Escalation is the safety valve: a report the desk has not answered in time
   * goes up to the college admin, who can see every desk. SlaService calls this
   * with no account at all, which is why the permission check is conditional.
   */
  async escalate(account, traceCode, reason = "") {
    if (account) this.#requirePermission(account, P.REPORTS_ESCALATE);
    const report = account ? this.#deskReport(account, traceCode) : this.#requireReport(traceCode);
    if (!report.isOpen) throw new ConflictError("A closed report cannot be escalated");
    report.transitionTo(STATUS.ESCALATED, { reason: reason || "Response time passed" });
    this.#db.complaints.save(report);
    this.#systemNote(report, `Escalated to the college admin. ${report.escalationReason}`, {
      by: account?.name ?? "TrustLine",
    });
    await this.#flushAll();
    this.#bus.emit(EV.REPORT_ESCALATED, {
      collegeId: report.collegeId, complaintId: report.traceCode, departmentId: report.departmentId,
      reason: report.escalationReason, actorId: account?.id ?? null, actorLabel: account?.name ?? "TrustLine",
      summary: `${report.traceCode} escalated — ${report.escalationReason}`,
    });
    return report.reporterView();
  }

  /**
   * Twenty reports about one broken pump become one report with twenty backers.
   * The duplicate is not deleted — its trace code keeps working and now points at
   * the report that is actually being worked, so nobody's report disappears.
   */
  async merge(account, traceCode, intoTraceCode) {
    this.#requirePermission(account, P.REPORTS_MERGE);
    const duplicate = this.#deskReport(account, traceCode);
    const target = this.#deskReport(account, intoTraceCode);
    if (duplicate.traceCode === target.traceCode) throw new ValidationError("A report cannot be merged into itself");
    if (duplicate.mergedInto) throw new ConflictError("That report has already been merged");
    if (target.mergedInto) throw new ConflictError("The target has itself been merged into another report");
    if (!target.isOpen) throw new ConflictError("Merge into a report that is still open");

    target.absorb(duplicate);
    // Closing the duplicate is part of markMergedInto — it leaves the workflow
    // rail rather than walking it, because "Received → Closed" is not a move a
    // desk is allowed to make and should not become one.
    duplicate.markMergedInto(target.traceCode);

    const verdict = this.#priority.assess(target, this.#priorityContext(target, this.#db.categories.find(target.categoryId)));
    target.setPriority(verdict.priority, { floor: target.priority });
    this.#db.complaints.save(duplicate);
    this.#db.complaints.save(target);

    this.#systemNote(duplicate, `Merged into ${target.traceCode} — “${target.title}”. Follow that report for updates.`, { by: account.name });
    this.#systemNote(target, `${duplicate.traceCode} was merged in as a duplicate. Backing now stands at ${target.supportCount}.`, { by: account.name });
    await this.#flushAll();
    this.#bus.emit(EV.REPORT_MERGED, {
      collegeId: target.collegeId, complaintId: duplicate.traceCode, into: target.traceCode,
      actorId: account.id, actorLabel: account.name, actorRole: account.role,
      supportCount: target.supportCount,
      summary: `${duplicate.traceCode} merged into ${target.traceCode}`,
    });
    return { absorbed: duplicate.traceCode, into: target.traceCode, supportCount: target.supportCount, priority: target.priority };
  }

  // ---- shared internals ----------------------------------------------------

  #requireReport(traceCode) {
    const code = normaliseTraceCode(traceCode) ?? traceCode;
    const report = this.#db.complaints.find(code);
    if (!report) throw new NotFoundError("Report");
    return report;
  }

  /**
   * Access for a desk account. Returning 403 for a report that exists but is out
   * of scope, and 404 for one that does not, would tell anyone who guessed a
   * trace code that it was real — so both come back the same way.
   */
  #deskReport(account, traceCode) {
    const code = normaliseTraceCode(traceCode) ?? traceCode;
    const report = this.#db.complaints.find(code);
    if (!report || !account.canRead(report)) throw new ForbiddenError("That report is not on your desk");
    return report;
  }

  #requirePermission(account, permission) {
    if (!account?.can(permission)) throw new ForbiddenError("This account cannot do that");
  }

  async #flushAll() {
    await Promise.all([this.#db.complaints.flush(), this.#db.messages.flush()]);
  }

  #announceStatus(report, summary) {
    this.#bus.emit(EV.REPORT_STATUS, {
      collegeId: report.collegeId, complaintId: report.traceCode, departmentId: report.departmentId,
      status: report.status, statusLabel: report.statusLabel, priority: report.priority,
      summary: `${report.traceCode} ${summary}`,
    });
  }
}
