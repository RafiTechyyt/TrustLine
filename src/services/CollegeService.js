// CollegeService.js — the tenant itself: its public face and its own settings.
//
// Registration and approval live in AuthService, because those are account
// questions. What is left here is everything a college controls once it is live:
// the profile the public sees, and the six switches that change how TrustLine
// behaves for that college alone.
//
// Those switches matter more than they look. `publicFeed: false` turns the whole
// product into a private inbox; `requirePassphrase: true` trades the ability to
// recover a lost trace code for a stronger guarantee. One college choosing
// differently from another is the point of multi-tenancy.

import { P } from "../core/accounts/permissions.js";
import { EV } from "../core/events/EventBus.js";
import { check } from "../lib/validate.js";
import { ForbiddenError, NotFoundError } from "../lib/errors.js";

export class CollegeService {
  #db; #bus;

  constructor({ db, bus }) {
    this.#db = db;
    this.#bus = bus;
  }

  // ---- what anyone can see ------------------------------------------------

  /** The picker on the landing page: every college currently accepting reports. */
  directory({ query = "" } = {}) {
    const needle = String(query || "").trim().toLowerCase();
    return this.#db.colleges.live()
      .filter((college) => needle === "" || college.place.toLowerCase().includes(needle)
        || college.name.toLowerCase().includes(needle) || college.shortName.toLowerCase().includes(needle))
      .map((college) => ({
        ...college.publicView(),
        acceptsReports: college.acceptsReports,
        publicFeed: college.settings.publicFeed,
        departments: this.#db.departments.ofCollege(college.id).length,
        categories: this.#db.categories.ofCollege(college.id).filter((c) => c.isRouted).length,
        reports: this.#db.complaints.ofCollege(college.id).length,
      }))
      .sort((a, b) => b.reports - a.reports || a.name.localeCompare(b.name));
  }

  /** Resolves either a slug or an id, so URLs can stay human-readable. */
  bySlugOrId(handle) {
    const college = this.#db.colleges.bySlug(handle) ?? this.#db.colleges.find(handle);
    if (!college || !college.isLive) throw new NotFoundError("College");
    return college;
  }

  // ---- what the admin controls --------------------------------------------

  profile(account) {
    this.#require(account);
    const college = this.#db.colleges.require(account.collegeId, "College");
    return {
      ...college.publicView(),
      // publicView() joins the city and state into one `place` string for the
      // landing page. The admin's own settings form has to edit them separately,
      // so both come back raw here as well.
      city: college.city,
      state: college.state,
      contactEmail: college.contactEmail,
      emailDomain: college.emailDomain,
      university: college.university,
      status: college.status,
      settings: college.settings,
      createdAt: college.createdAt,
      reviewNote: college.reviewNote,
    };
  }

  async updateProfile(account, patch) {
    this.#require(account);
    const college = this.#db.colleges.require(account.collegeId, "College");
    const clean = check(patch)
      .text("name", { required: false, min: 4, max: 120, label: "College name" })
      .text("shortName", { required: false, max: 24, label: "Short name" })
      .text("city", { required: false, max: 60, label: "City" })
      .text("state", { required: false, max: 60, label: "State" })
      .text("university", { required: false, max: 120, label: "University" })
      .text("emailDomain", { required: false, max: 80, label: "Email domain" })
      .email("contactEmail", { required: false })
      .done();
    // A PATCH must only touch what it sent. The validator reports an absent
    // optional text field as "", and College#updateProfile treats "" as a real
    // value — so without this filter, saving the settings form would quietly
    // erase the city and the contact address.
    college.updateProfile(CollegeService.#present(patch, clean));
    this.#db.colleges.save(college);
    await this.#db.colleges.flush();
    this.#emit(account, college, "profile");
    return this.profile(account);
  }

  async updateSettings(account, patch) {
    this.#require(account);
    const college = this.#db.colleges.require(account.collegeId, "College");
    const current = college.settings;
    const clean = check(patch)
      .bool("publicFeed", { fallback: current.publicFeed })
      .bool("allowVisitorReports", { fallback: current.allowVisitorReports })
      .bool("requirePassphrase", { fallback: current.requirePassphrase })
      .int("defaultSlaHours", { min: 2, max: 720, fallback: current.defaultSlaHours })
      .int("autoCloseAfterDays", { min: 1, max: 90, fallback: current.autoCloseAfterDays })
      .text("motto", { required: false, max: 160, label: "Motto" })
      .done();
    college.updateSettings(CollegeService.#present(patch, clean));
    this.#db.colleges.save(college);
    await this.#db.colleges.flush();
    this.#emit(account, college, "settings");
    return college.settings;
  }

  #require(account) {
    if (!account?.can(P.COLLEGE_SETTINGS_WRITE)) throw new ForbiddenError("Only a college admin can change this");
  }

  /** Keeps only the cleaned keys the caller actually submitted. */
  static #present(raw, clean) {
    const sent = raw && typeof raw === "object" ? raw : {};
    return Object.fromEntries(Object.entries(clean).filter(([key]) => sent[key] !== undefined));
  }

  #emit(account, college, what) {
    this.#bus.emit(EV.CATALOG_CHANGED, {
      collegeId: college.id, action: `college.${what}`, subject: college.name,
      actorId: account.id, actorLabel: account.name, actorRole: account.role,
      summary: `College ${what} updated`,
    });
  }
}
