// AuthService.js — the three-tier account model in one place.
//
//   Platform office (SuperAdmin)  approves colleges and their founding admins.
//   College admin                 runs one college, creates its department desks.
//   Department officer            sees only the desks they were assigned.
//
// A college signs itself up together with its first admin in a single request:
// the platform office then approves both in one action, because approving a
// college whose admin is still pending would leave a tenant nobody can open.

import { config } from "../config.js";
import { AccountFactory } from "../core/accounts/AccountFactory.js";
import { ROLES, ACCOUNT_STATUS, P } from "../core/accounts/permissions.js";
import { College } from "../core/College.js";
import { COLLEGE_STATUS } from "../core/enums.js";
import { EV } from "../core/events/EventBus.js";
import {
  ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError,
} from "../lib/errors.js";
import { slugify } from "../lib/ids.js";

export class AuthService {
  #db;
  #bus;

  constructor({ db, bus }) {
    this.#db = db;
    this.#bus = bus;
  }

  // ---- boot ---------------------------------------------------------------

  /** Creates the platform owner on first run so the console is never locked out. */
  async bootstrap() {
    const existing = this.#db.accounts.superAdmins();
    if (existing.length > 0) return existing[0];
    const owner = AccountFactory.create(ROLES.SUPER_ADMIN, {
      email: config.platformOwner.email,
      name: config.platformOwner.name,
      title: "Platform Office",
      password: config.platformOwner.password,
      status: ACCOUNT_STATUS.ACTIVE,
    });
    this.#db.accounts.insert(owner);
    await this.#db.accounts.flush();
    return owner;
  }

  // ---- sign in / out ------------------------------------------------------

  /**
   * Deliberately distinguishes "not approved yet" from "wrong password": telling
   * a real admin their college is still under review is useful, and the account
   * already proved it holds the password before we say so.
   */
  signIn({ email, password }) {
    const account = this.#db.accounts.byEmail(email);
    if (!account || !account.passwordMatches(password)) {
      throw new UnauthorizedError("That email and password do not match an account");
    }
    if (account.status === ACCOUNT_STATUS.PENDING) {
      throw new ForbiddenError("This account is waiting for approval from the platform office");
    }
    if (account.status === ACCOUNT_STATUS.REJECTED) {
      throw new ForbiddenError("This registration was not approved");
    }
    if (account.status === ACCOUNT_STATUS.SUSPENDED) {
      throw new ForbiddenError("This account has been suspended");
    }

    const college = account.collegeId ? this.#db.colleges.find(account.collegeId) : null;
    if (college && !college.isLive) {
      throw new ForbiddenError(college.status === COLLEGE_STATUS.PENDING
        ? `${college.name} is still awaiting platform approval`
        : `${college.name} is not active on TrustLine`);
    }

    account.markSeen();
    this.#db.accounts.save(account);
    this.#bus.emit(EV.ACCOUNT_SIGNED_IN, { accountId: account.id, role: account.role, collegeId: account.collegeId });
    return { account, college };
  }

  changePassword(account, { current, next }) {
    if (!account.passwordMatches(current)) throw new UnauthorizedError("Current password is incorrect");
    if (String(next || "").length < 10) throw new ValidationError("Choose a longer password", { next: "at least 10 characters" });
    account.setPassword(next);
    this.#db.accounts.save(account);
    return account;
  }

  // ---- registration -------------------------------------------------------

  /** A college onboarding itself, together with the person who will run it. */
  async registerCollege({
    name, shortName = "", city = "", state = "Kerala", university = "", emailDomain = "",
    contactEmail = "", adminName, adminEmail, adminTitle = "", password,
  }) {
    this.#assertEmailFree(adminEmail);
    const slug = slugify(name, "college");
    if (this.#db.colleges.bySlug(slug)) {
      throw new ConflictError("A college with a very similar name is already registered");
    }

    const college = new College({
      name, shortName, city, state, university, emailDomain, contactEmail,
      status: COLLEGE_STATUS.PENDING,
    });
    const admin = AccountFactory.create(ROLES.COLLEGE_ADMIN, {
      email: adminEmail, name: adminName, title: adminTitle || "College Admin",
      password, collegeId: college.id, status: ACCOUNT_STATUS.PENDING,
    });
    college.updateProfile({ contactEmail: contactEmail || adminEmail });

    this.#db.colleges.insert(college);
    this.#db.accounts.insert(admin);
    await Promise.all([this.#db.colleges.flush(), this.#db.accounts.flush()]);

    this.#bus.emit(EV.COLLEGE_REQUESTED, { collegeId: college.id, name: college.name, adminId: admin.id });
    return { college, admin };
  }

  /** A second admin joining a college that is already on the platform. */
  async registerAdmin({ collegeId, name, email, title = "", password }) {
    const college = this.#db.colleges.require(collegeId, "College");
    if (college.status === COLLEGE_STATUS.REJECTED) throw new NotFoundError("College");
    this.#assertEmailFree(email);
    if (college.emailDomain && !String(email).toLowerCase().endsWith(`@${college.emailDomain}`)) {
      throw new ValidationError(`${college.shortName} requires an @${college.emailDomain} address`, {
        email: `must end with @${college.emailDomain}`,
      });
    }

    const admin = AccountFactory.create(ROLES.COLLEGE_ADMIN, {
      email, name, title: title || "College Admin", password,
      collegeId: college.id, status: ACCOUNT_STATUS.PENDING,
    });
    this.#db.accounts.insert(admin);
    await this.#db.accounts.flush();
    this.#bus.emit(EV.ACCOUNT_REQUESTED, { accountId: admin.id, role: admin.role, collegeId: college.id });
    return admin;
  }

  #assertEmailFree(email) {
    if (this.#db.accounts.byEmail(email)) throw new ConflictError("That email already has a TrustLine account");
  }

  // ---- platform review ----------------------------------------------------

  /** Approving a college also activates the admin who requested it. */
  async reviewCollege(reviewer, collegeId, { decision, note = "" }) {
    this.#requirePermission(reviewer, P.PLATFORM_COLLEGES_REVIEW);
    const college = this.#db.colleges.require(collegeId, "College");
    const founders = this.#db.accounts.pendingForCollege(college.id);

    if (decision === "approve") {
      college.approve(reviewer.id, note);
      for (const account of founders) {
        account.approve(reviewer.id, "Approved with the college");
        this.#db.accounts.save(account);
      }
    } else if (decision === "reject") {
      college.reject(reviewer.id, note);
      for (const account of founders) {
        account.reject(reviewer.id, note || "College registration was not approved");
        this.#db.accounts.save(account);
      }
    } else if (decision === "suspend") {
      college.suspend(reviewer.id, note);
    } else {
      throw new ValidationError("Unknown decision", { decision: "approve, reject or suspend" });
    }

    this.#db.colleges.save(college);
    await Promise.all([this.#db.colleges.flush(), this.#db.accounts.flush()]);
    this.#bus.emit(EV.COLLEGE_REVIEWED, {
      collegeId: college.id, name: college.name, decision, status: college.status,
      actorId: reviewer.id, actorLabel: reviewer.name, note,
    });
    return { college, activated: founders.length };
  }

  /** Used for the second, third… admin of an already-live college. */
  async reviewAccount(reviewer, accountId, { decision, note = "" }) {
    const account = this.#db.accounts.require(accountId, "Account");
    this.#requireReviewAuthority(reviewer, account);
    if (account.id === reviewer.id) throw new ForbiddenError("An account cannot review itself");

    switch (decision) {
      case "approve": account.approve(reviewer.id, note); break;
      case "reject": account.reject(reviewer.id, note); break;
      case "suspend": account.suspend(reviewer.id, note); break;
      case "reinstate": account.reinstate(reviewer.id); break;
      default: throw new ValidationError("Unknown decision", { decision: "approve, reject, suspend or reinstate" });
    }

    this.#db.accounts.save(account);
    await this.#db.accounts.flush();
    this.#bus.emit(EV.ACCOUNT_REVIEWED, {
      accountId: account.id, role: account.role, collegeId: account.collegeId,
      decision, status: account.status, actorId: reviewer.id, actorLabel: reviewer.name, note,
    });
    return account;
  }

  /**
   * College admins may review their own department officers; only the platform
   * office may review another college admin. That split is what keeps one admin
   * from quietly promoting themselves past the platform.
   */
  #requireReviewAuthority(reviewer, subject) {
    if (subject.role === ROLES.SUPER_ADMIN) throw new ForbiddenError("Platform accounts are managed outside TrustLine");
    if (subject.role === ROLES.COLLEGE_ADMIN) {
      this.#requirePermission(reviewer, P.PLATFORM_ADMINS_REVIEW);
      return;
    }
    if (reviewer.can(P.PLATFORM_ADMINS_REVIEW)) return;
    this.#requirePermission(reviewer, P.COLLEGE_TEAM_MANAGE);
    if (reviewer.collegeId !== subject.collegeId) throw new ForbiddenError("That account belongs to another college");
  }

  #requirePermission(account, permission) {
    if (!account?.can(permission)) throw new ForbiddenError("You do not have access to this");
  }

  // ---- college team -------------------------------------------------------

  /** A desk officer, created active: the admin vouching for them is the review. */
  async createOfficer(admin, { name, email, title = "", password, departmentIds = [] }) {
    this.#requirePermission(admin, P.COLLEGE_TEAM_MANAGE);
    this.#assertEmailFree(email);
    const desks = this.#validateDesks(admin.collegeId, departmentIds);

    const officer = AccountFactory.create(ROLES.DEPARTMENT_OFFICER, {
      email, name, title, password, collegeId: admin.collegeId,
      departmentIds: desks, status: ACCOUNT_STATUS.ACTIVE,
    });
    officer.approve(admin.id, `Added by ${admin.name}`);
    this.#db.accounts.insert(officer);
    await this.#db.accounts.flush();
    this.#bus.emit(EV.ACCOUNT_REVIEWED, {
      accountId: officer.id, role: officer.role, collegeId: officer.collegeId,
      decision: "created", status: officer.status, actorId: admin.id, actorLabel: admin.name,
    });
    return officer;
  }

  async updateOfficer(admin, officerId, { name, title, departmentIds, password }) {
    this.#requirePermission(admin, P.COLLEGE_TEAM_MANAGE);
    const officer = this.#db.accounts.require(officerId, "Account");
    if (officer.collegeId !== admin.collegeId) throw new ForbiddenError("That account belongs to another college");
    if (officer.role === ROLES.SUPER_ADMIN) throw new ForbiddenError("Platform accounts are managed outside TrustLine");

    if (name !== undefined || title !== undefined) officer.rename(name, title);
    if (departmentIds !== undefined) officer.assignDepartments(this.#validateDesks(admin.collegeId, departmentIds));
    if (password) officer.setPassword(password);
    this.#db.accounts.save(officer);
    await this.#db.accounts.flush();
    return officer;
  }

  #validateDesks(collegeId, departmentIds) {
    const owned = new Set(this.#db.departments.ofCollege(collegeId, { includeInactive: true }).map((d) => d.id));
    const ids = [...new Set((departmentIds || []).filter(Boolean))];
    const stranger = ids.find((id) => !owned.has(id));
    if (stranger) throw new ValidationError("That desk is not part of this college", { departmentIds: stranger });
    return ids;
  }

  // ---- reads for the consoles ---------------------------------------------

  platformReview(reviewer) {
    this.#requirePermission(reviewer, P.PLATFORM_COLLEGES_REVIEW);
    return {
      colleges: this.#db.colleges.pending().map((c) => ({
        ...c.publicView(),
        contactEmail: c.contactEmail,
        emailDomain: c.emailDomain,
        requestedAt: c.createdAt,
        admins: this.#db.accounts.pendingForCollege(c.id).map((a) => a.profile()),
      })),
      accounts: this.#db.accounts.pendingReview()
        .filter((a) => this.#db.colleges.find(a.collegeId)?.isLive)
        .map((a) => ({ ...a.profile(), college: this.#db.colleges.find(a.collegeId)?.publicView() ?? null })),
    };
  }

  team(admin) {
    this.#requirePermission(admin, P.COLLEGE_TEAM_MANAGE);
    const desks = new Map(this.#db.departments.ofCollege(admin.collegeId, { includeInactive: true })
      .map((d) => [d.id, d.name]));
    return this.#db.accounts.ofCollege(admin.collegeId).map((account) => ({
      ...account.profile(),
      desks: account.departmentIds.map((id) => desks.get(id)).filter(Boolean),
    }));
  }
}
