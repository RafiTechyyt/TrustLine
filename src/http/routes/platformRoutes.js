// platformRoutes.js — the platform office: the third tier, and the least powerful one.
//
// The platform office decides who gets to run a college desk on TrustLine, and
// that is all it decides. It cannot open a report. SuperAdmin#canRead returns
// false for every complaint, so there is no route here that could serve one even
// if someone added it — which is the reason this console is limited to counts,
// approvals and system health.
//
// That inversion is worth stating plainly because it is the opposite of the usual
// arrangement: the highest tier of the product has the least visibility into it.

import { Router } from "express";
import { route, ok, qs } from "../respond.js";
import { requireAccount, requirePermission, requireAnyPermission } from "../middleware/auth.js";
import { P } from "../../core/accounts/permissions.js";

export function platformRoutes({ services, db, container }) {
  const { auth, analytics } = services;
  const api = Router();

  api.use(requireAccount(), requireAnyPermission(
    P.PLATFORM_COLLEGES_REVIEW, P.PLATFORM_ADMINS_REVIEW, P.PLATFORM_METRICS_READ,
  ));

  /** The approvals queue: colleges waiting, and admins of live colleges waiting. */
  api.get("/review", requirePermission(P.PLATFORM_COLLEGES_REVIEW), route((req, res) => ok(
    res,
    auth.platformReview(req.account),
  )));

  /** Approving a college activates the founding admin in the same call. */
  api.post("/colleges/:id/review", requirePermission(P.PLATFORM_COLLEGES_REVIEW), route(async (req, res) => {
    const { college, activated } = await auth.reviewCollege(req.account, req.params.id, {
      decision: qs.str(req.body?.decision),
      note: qs.str(req.body?.note),
    });
    // The refreshed queue rides along so the console never has to follow up with
    // a second request just to redraw the list it was looking at.
    return ok(res, { college: college.publicView(), activated, review: auth.platformReview(req.account) });
  }));

  api.post("/accounts/:id/review", requirePermission(P.PLATFORM_ADMINS_REVIEW), route(async (req, res) => {
    const account = await auth.reviewAccount(req.account, req.params.id, {
      decision: qs.str(req.body?.decision),
      note: qs.str(req.body?.note),
    });
    return ok(res, { account: account.profile(), review: auth.platformReview(req.account) });
  }));

  /** Volume and health per tenant. No titles, no bodies, no trace codes. */
  api.get("/analytics", requirePermission(P.PLATFORM_METRICS_READ), route((req, res) => ok(
    res,
    analytics.platform(req.account),
  )));

  /** Every college on the platform, including the ones not yet approved. */
  api.get("/colleges", requirePermission(P.PLATFORM_METRICS_READ), route((_req, res) => ok(res, {
    colleges: db.colleges.all()
      .map((college) => ({
        ...college.publicView(),
        contactEmail: college.contactEmail,
        createdAt: college.createdAt,
        reviewNote: college.reviewNote,
        admins: db.accounts.admins(college.id).length,
        reports: db.complaints.ofCollege(college.id).length,
      }))
      .sort((a, b) => b.createdAt - a.createdAt),
  })));

  /** Store counts, event totals, registered listeners, SLA clock, uptime. */
  api.get("/status", requirePermission(P.PLATFORM_METRICS_READ), route((_req, res) => ok(res, container.status())));

  /** The cross-college activity ticker. Summaries only — see LiveFeed#handle. */
  api.get("/activity", requirePermission(P.PLATFORM_METRICS_READ), route((req, res) => ok(res, {
    activity: container.live.recent(null, qs.int(req.query.limit, 40, { min: 1, max: 200 })),
  })));

  api.get("/audit", requirePermission(P.PLATFORM_METRICS_READ), route((req, res) => ok(res, {
    events: db.audit.platform(qs.int(req.query.limit, 120, { min: 1, max: 500 })).map((event) => event.view()),
  })));

  /** Forces a sweep instead of waiting for the minute timer. Handy in a demo. */
  api.post("/sla/sweep", requirePermission(P.PLATFORM_METRICS_READ), route(async (_req, res) => ok(
    res,
    await services.sla.sweep(),
  )));

  return api;
}
