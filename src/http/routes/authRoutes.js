// authRoutes.js — the only part of TrustLine with a login, and it is for staff.
//
// Three tiers, and the middle one cannot let itself in: a college registers, the
// platform office approves it, and only then does the founding admin's password
// work. That ordering is enforced in AuthService.signIn, not here, so the same
// rule holds for any future caller.
//
// The session cookie is HttpOnly and SameSite=Lax and holds a signed token, not
// a user id — see SessionService. This file only decides which routes attach and
// detach it.

import { Router } from "express";
import { route, ok, created, qs } from "../respond.js";
import { throttle, forgive } from "../middleware/throttle.js";
import { requireAccount } from "../middleware/auth.js";
import { P } from "../../core/accounts/permissions.js";
import { config } from "../../config.js";

export function authRoutes({ services, db }) {
  const { auth, sessions, colleges, catalog } = services;
  const api = Router();

  /** A college onboarding itself together with the person who will run its desk. */
  api.post("/register/college", throttle({ windowMs: 60 * 60_000, max: 6 }, "register"), route(async (req, res) => {
    const { college, admin } = await auth.registerCollege(req.body ?? {});
    return created(res, {
      college: college.publicView(),
      admin: admin.profile(),
      // Said plainly, because the next screen is a dead end otherwise: the
      // password works only once the platform office has approved the college.
      next: "Your registration is with the platform office. You will be able to sign in once it is approved.",
    });
  }));

  /** A second admin joining a college that is already live. */
  api.post("/register/admin", throttle({ windowMs: 60 * 60_000, max: 10 }, "register"), route(async (req, res) => {
    const college = colleges.bySlugOrId(qs.str(req.body?.college ?? req.body?.collegeId));
    const admin = await auth.registerAdmin({ ...req.body, collegeId: college.id });
    return created(res, {
      admin: admin.profile(),
      next: `Your request is with the platform office. ${college.shortName} will be able to add you to a desk once it is approved.`,
    });
  }));

  api.post("/sign-in", throttle(config.rateLimits.login, "login"), route((req, res) => {
    const { account, college } = auth.signIn({
      email: qs.str(req.body?.email),
      password: String(req.body?.password ?? ""),
    });
    // A caller who eventually got it right should not stay near their limit.
    forgive(config.rateLimits.login, "login", req);
    sessions.attach(res, account);
    return ok(res, { account: account.profile(), college: college?.publicView() ?? null });
  }));

  api.post("/sign-out", route((req, res) => {
    sessions.detach(res, req.sessionToken);
    return ok(res, { ok: true });
  }));

  /**
   * What the console calls on load to decide which shell to draw. Includes the
   * catalogue warnings, so an admin whose categories point nowhere sees it on the
   * first screen instead of finding out from a misrouted report.
   *
   * The college is read straight from the store rather than through
   * colleges.bySlugOrId, which refuses anything not live — an admin whose college
   * has just been suspended needs to be told that, not handed a 404.
   */
  api.get("/me", requireAccount(), route((req, res) => {
    const account = req.account;
    const college = account.collegeId ? db.colleges.find(account.collegeId) : null;
    return ok(res, {
      // profile() already carries the permission list and the scope sentence.
      account: account.profile(),
      college: college ? { ...college.publicView(), settings: college.settings } : null,
      warnings: account.can(P.COLLEGE_CATALOG_WRITE) ? catalog.forAdmin(account).warnings : [],
    });
  }));

  api.post("/password", requireAccount(), route((req, res) => {
    auth.changePassword(req.account, {
      current: String(req.body?.current ?? ""),
      next: String(req.body?.next ?? ""),
    });
    // Every other session for this account keeps working; the token is signed
    // over the account id, not the password hash. Said here so the omission is
    // a decision on record rather than an oversight.
    return ok(res, { ok: true });
  }));

  return api;
}
