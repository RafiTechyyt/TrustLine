// AnnouncementService.js — the college talking back.
//
// A feed full of complaints and no reply from the college is a wall of shouting.
// "Here is what we fixed this month" is what makes the next person file rather
// than shrug. So an announcement can cite the trace codes it is about, and the
// public feed shows those citations as proof rather than as a claim.
//
// Only codes belonging to *public* reports of the same college can be cited —
// otherwise an admin could quietly reveal that a private report exists.

import { Announcement } from "../core/Announcement.js";
import { P } from "../core/accounts/permissions.js";
import { EV } from "../core/events/EventBus.js";
import { check } from "../lib/validate.js";
import { ForbiddenError, ValidationError } from "../lib/errors.js";
import { normaliseTraceCode } from "../lib/ids.js";

const DAY = 24 * 60 * 60 * 1000;

export class AnnouncementService {
  #db; #bus;

  constructor({ db, bus }) {
    this.#db = db;
    this.#bus = bus;
  }

  async post(account, { title, body, pinned = false, linkedTraceCodes = [], expiresInDays = null }) {
    this.#require(account);
    const clean = check({ title, body })
      .text("title", { min: 6, max: 140, label: "Headline" })
      .text("body", { min: 20, max: 2000, label: "Update" })
      .done();

    const announcement = new Announcement({
      collegeId: account.collegeId,
      ...clean,
      pinned: Boolean(pinned),
      authorId: account.id,
      authorName: account.title || "College desk",
      linkedTraceCodes: this.#citable(account.collegeId, linkedTraceCodes),
      expiresAt: expiresInDays ? Date.now() + Number(expiresInDays) * DAY : null,
    });
    this.#db.announcements.insert(announcement);
    await this.#db.announcements.flush();

    this.#bus.emit(EV.ANNOUNCEMENT_POSTED, {
      collegeId: account.collegeId, announcementId: announcement.id, title: announcement.title,
      actorId: account.id, actorLabel: account.name, actorRole: account.role,
      summary: `Announcement posted: ${announcement.title}`,
    });
    return announcement.view();
  }

  async update(account, id, patch) {
    this.#require(account);
    const announcement = this.#owned(account, id);
    announcement.update({
      ...patch,
      ...(patch.linkedTraceCodes !== undefined
        ? { linkedTraceCodes: this.#citable(account.collegeId, patch.linkedTraceCodes) }
        : {}),
      ...(patch.expiresInDays !== undefined
        ? { expiresAt: patch.expiresInDays ? Date.now() + Number(patch.expiresInDays) * DAY : null }
        : {}),
    });
    this.#db.announcements.save(announcement);
    await this.#db.announcements.flush();
    return announcement.view();
  }

  async remove(account, id) {
    this.#require(account);
    const announcement = this.#owned(account, id);
    this.#db.announcements.remove(announcement.id);
    await this.#db.announcements.flush();
    return { removed: announcement.id };
  }

  // ---- reads ---------------------------------------------------------------

  /** What the public feed shows, with each cited report resolved to a title. */
  forCollege(collegeId, { limit = 6 } = {}) {
    return this.#db.announcements.ofCollege(collegeId).slice(0, limit).map((announcement) => ({
      ...announcement.view(),
      linked: announcement.linkedTraceCodes
        .map((code) => this.#db.complaints.find(code))
        .filter((report) => report?.isPublic)
        .map((report) => ({
          traceCode: report.traceCode,
          title: report.title,
          statusLabel: report.statusLabel,
          tone: report.state.tone,
        })),
    }));
  }

  /** The admin board, including expired ones so they can be revived or removed. */
  forAdmin(account) {
    this.#require(account);
    return this.#db.announcements.ofCollege(account.collegeId, { liveOnly: false }).map((announcement) => ({
      ...announcement.view(),
      expiresAt: announcement.expiresAt,
      live: announcement.isLive,
    }));
  }

  /**
   * Ready-made copy for the "what we fixed" post, built from the last month of
   * actual resolutions. The admin edits it and posts — the point is that the
   * loop gets closed at all, and a blank textarea is where that usually dies.
   */
  draftDigest(account, { days = 30 } = {}) {
    this.#require(account);
    const since = Date.now() - days * DAY;
    const confidential = new Set(
      this.#db.categories.ofCollege(account.collegeId, { includeInactive: true })
        .filter((c) => c.confidential).map((c) => c.id),
    );
    const resolved = this.#db.complaints.ofCollege(account.collegeId).filter((report) => (
      report.resolvedAt && report.resolvedAt >= since && !confidential.has(report.categoryId)
    ));
    const byDesk = new Map();
    for (const report of resolved) {
      const name = this.#db.departments.find(report.departmentId)?.name ?? "Other";
      byDesk.set(name, (byDesk.get(name) ?? 0) + 1);
    }
    const highlights = resolved
      .filter((report) => report.isPublic)
      .sort((a, b) => b.supportCount - a.supportCount)
      .slice(0, 5);

    const lines = [
      `${resolved.length} report${resolved.length === 1 ? "" : "s"} were closed out in the last ${days} days.`,
      ...[...byDesk.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `• ${name}: ${count}`),
      highlights.length > 0 ? "\nThe ones most people were waiting on:" : "",
      ...highlights.map((report) => `• ${report.title} (${report.traceCode}) — ${report.supportCount} backed this`),
    ].filter(Boolean);

    return {
      title: `What we fixed — last ${days} days`,
      body: lines.join("\n"),
      linkedTraceCodes: highlights.map((report) => report.traceCode),
      resolvedCount: resolved.length,
    };
  }

  // ---- internals -----------------------------------------------------------

  #require(account) {
    if (!account?.can(P.COLLEGE_ANNOUNCE)) throw new ForbiddenError("Only a college admin can post updates");
  }

  #owned(account, id) {
    const announcement = this.#db.announcements.require(id, "Announcement");
    if (announcement.collegeId !== account.collegeId) {
      throw new ForbiddenError("That announcement belongs to another college");
    }
    return announcement;
  }

  /**
   * Citing a report is a form of disclosure, so the filter is strict: same
   * college, actually public, not merged away. Anything else is dropped rather
   * than rejected — an admin pasting a stale code should not lose their draft.
   */
  #citable(collegeId, codes) {
    if (!Array.isArray(codes)) return [];
    const wanted = codes.map((code) => normaliseTraceCode(code) ?? code).filter(Boolean);
    if (wanted.length > 8) throw new ValidationError("Link at most 8 reports to one update");
    return wanted.filter((code) => {
      const report = this.#db.complaints.find(code);
      return report && report.collegeId === collegeId && report.isPublic && !report.mergedInto;
    });
  }
}
