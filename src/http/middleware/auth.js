// auth.js — RBAC middleware.
//
// Note what is absent: any comparison against a role string. Every guard below
// asks the account object a question and lets the subclass answer. Adding a
// fourth kind of account later means writing one class, not editing this file.

import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";
import { COLLEGE_STATUS } from "../../core/enums.js";

/** Populates req.account when a valid cookie is present. Never rejects. */
export function attachSession({ sessions }) {
  return function readSession(req, _res, next) {
    const token = req.cookies?.[sessions.cookieName];
    req.sessionToken = token || null;
    req.account = token ? sessions.resolve(token) : null;
    return next();
  };
}

export function requireAccount() {
  return function guard(req, _res, next) {
    if (!req.account) return next(new UnauthorizedError());
    return next();
  };
}

/** Every listed permission must be held. */
export function requirePermission(...permissions) {
  return function guard(req, _res, next) {
    if (!req.account) return next(new UnauthorizedError());
    const missing = permissions.find((p) => !req.account.can(p));
    if (missing) return next(new ForbiddenError("Your account cannot do that"));
    return next();
  };
}

/** Any one of the listed permissions is enough. */
export function requireAnyPermission(...permissions) {
  return function guard(req, _res, next) {
    if (!req.account) return next(new UnauthorizedError());
    if (!permissions.some((p) => req.account.can(p))) {
      return next(new ForbiddenError("Your account cannot do that"));
    }
    return next();
  };
}

/** Resolves req.college from the signed-in account and refuses a dormant tenant. */
export function requireCollege({ db }) {
  return function guard(req, _res, next) {
    if (!req.account) return next(new UnauthorizedError());
    const college = req.account.collegeId ? db.colleges.find(req.account.collegeId) : null;
    if (!college) return next(new ForbiddenError("This account is not attached to a college"));
    if (college.status !== COLLEGE_STATUS.ACTIVE) {
      return next(new ForbiddenError(`${college.name} is not active on TrustLine`));
    }
    req.college = college;
    return next();
  };
}

/**
 * The per-report boundary. canRead() is a different method on each subclass:
 * an admin sees their whole college, an officer only their desks, and the
 * platform office deliberately sees no report content at all.
 */
export function requireReportAccess({ db, param = "code" }) {
  return function guard(req, _res, next) {
    if (!req.account) return next(new UnauthorizedError());
    const report = db.complaints.find(String(req.params[param] || "").toUpperCase());
    // 403 rather than 404 would confirm a trace code exists to someone who
    // guessed it, so an out-of-scope report is indistinguishable from a missing one.
    if (!report || !req.account.canRead(report)) return next(new ForbiddenError("That report is not on your desk"));
    req.report = report;
    return next();
  };
}
