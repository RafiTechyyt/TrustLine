// adminRoutes.js — the college admin's own console.
//
// Four jobs live here, and they are the four things that decide whether TrustLine
// works for a given college at all: the routing table (categories → desks), the
// team, what the college publishes, and its own settings.
//
// The routing table is the load-bearing one. A category with no department is a
// category that files reports into a void, so CatalogService hides it from the
// report form and returns a warning instead — which is why GET /catalog carries
// `warnings` and the dashboard shows them above everything else.

import { Router } from "express";
import { route, ok, created, gone, qs } from "../respond.js";
import { requireAccount, requireCollege, requirePermission } from "../middleware/auth.js";
import { P } from "../../core/accounts/permissions.js";

export function adminRoutes({ services, db, container }) {
  const { auth, catalog, colleges, announcements, analytics } = services;
  const api = Router();

  api.use(requireAccount(), requireCollege({ db }));

  // ---- the routing table ---------------------------------------------------

  const catalogWrite = requirePermission(P.COLLEGE_CATALOG_WRITE);

  /**
   * Every mutation below answers with the whole board rather than the one row it
   * changed. That is deliberate: `warnings` is derived from all of the desks and
   * all of the categories together, so a change that fixes or creates a warning
   * has to recompute it anyway. The console replaces its state from one payload
   * and cannot drift out of step with the server.
   */
  const board = (req) => catalog.forAdmin(req.account);

  api.get("/catalog", catalogWrite, route((req, res) => ok(res, board(req))));

  api.post("/departments", catalogWrite, route(async (req, res) => {
    const department = await catalog.createDepartment(req.account, {
      name: qs.str(req.body?.name),
      code: qs.str(req.body?.code),
      description: qs.str(req.body?.description),
      headName: qs.str(req.body?.headName),
      slaHours: req.body?.slaHours == null || req.body.slaHours === ""
        ? null
        : qs.int(req.body.slaHours, 72, { min: 2, max: 720 }),
    });
    return created(res, { created: department.id, ...board(req) });
  }));

  api.patch("/departments/:id", catalogWrite, route(async (req, res) => {
    await catalog.updateDepartment(req.account, req.params.id, req.body ?? {});
    return ok(res, board(req));
  }));

  /** Refuses while reports still point at the desk — see CatalogService. */
  api.delete("/departments/:id", catalogWrite, route(async (req, res) => {
    await catalog.deleteDepartment(req.account, req.params.id);
    return ok(res, board(req));
  }));

  api.post("/categories", catalogWrite, route(async (req, res) => {
    const category = await catalog.createCategory(req.account, {
      ...req.body,
      keywords: qs.list(req.body?.keywords),
      audiences: qs.list(req.body?.audiences),
    });
    return created(res, { created: category.id, ...board(req) });
  }));

  api.patch("/categories/:id", catalogWrite, route(async (req, res) => {
    await catalog.updateCategory(req.account, req.params.id, {
      ...req.body,
      ...(req.body?.keywords !== undefined ? { keywords: qs.list(req.body.keywords) } : {}),
      ...(req.body?.audiences !== undefined ? { audiences: qs.list(req.body.audiences) } : {}),
    });
    return ok(res, board(req));
  }));

  /** The one-click fix for the warning the dashboard shows. */
  api.post("/categories/:id/route", catalogWrite, route(async (req, res) => {
    await catalog.routeCategory(req.account, req.params.id, qs.str(req.body?.departmentId) || null);
    return ok(res, board(req));
  }));

  api.post("/categories/order", catalogWrite, route(async (req, res) => ok(
    res,
    await catalog.reorderCategories(req.account, qs.list(req.body?.ids)),
  )));

  api.delete("/categories/:id", catalogWrite, route(async (req, res) => {
    await catalog.deleteCategory(req.account, req.params.id);
    return ok(res, board(req));
  }));

  // ---- the team ------------------------------------------------------------

  const teamWrite = requirePermission(P.COLLEGE_TEAM_MANAGE);

  api.get("/team", teamWrite, route((req, res) => ok(res, { team: auth.team(req.account) })));

  /**
   * A desk officer is created here rather than registering themselves. Their
   * scope is the list of desks they are given, and it is the only thing that
   * decides which reports they can open.
   */
  api.post("/team/officers", teamWrite, route(async (req, res) => created(res, {
    officer: (await auth.createOfficer(req.account, {
      name: qs.str(req.body?.name),
      email: qs.str(req.body?.email),
      title: qs.str(req.body?.title),
      password: String(req.body?.password ?? ""),
      departmentIds: qs.list(req.body?.departmentIds),
    })).profile(),
  })));

  api.patch("/team/officers/:id", teamWrite, route(async (req, res) => ok(res, {
    officer: (await auth.updateOfficer(req.account, req.params.id, {
      name: req.body?.name,
      title: req.body?.title,
      password: req.body?.password,
      departmentIds: req.body?.departmentIds === undefined ? undefined : qs.list(req.body.departmentIds),
    })).profile(),
  })));

  /** A second admin who registered themselves still needs approving. */
  api.post("/team/:id/review", teamWrite, route(async (req, res) => ok(res, {
    account: (await auth.reviewAccount(req.account, req.params.id, {
      decision: qs.str(req.body?.decision),
      note: qs.str(req.body?.note),
    })).profile(),
  })));

  // ---- the notice board ----------------------------------------------------

  const announce = requirePermission(P.COLLEGE_ANNOUNCE);

  api.get("/announcements", announce, route((req, res) => ok(res, {
    announcements: announcements.forAdmin(req.account),
  })));

  /** Pre-written from the month's actual resolutions, because a blank box is where closing the loop dies. */
  api.get("/announcements/digest", announce, route((req, res) => ok(res, announcements.draftDigest(req.account, {
    days: qs.int(req.query.days, 30, { min: 7, max: 180 }),
  }))));

  api.post("/announcements", announce, route(async (req, res) => created(res, {
    announcement: await announcements.post(req.account, {
      title: qs.str(req.body?.title),
      body: qs.str(req.body?.body),
      pinned: qs.bool(req.body?.pinned),
      linkedTraceCodes: qs.list(req.body?.linkedTraceCodes),
      expiresInDays: req.body?.expiresInDays == null || req.body.expiresInDays === ""
        ? null
        : qs.int(req.body.expiresInDays, 30, { min: 1, max: 365 }),
    }),
  })));

  api.patch("/announcements/:id", announce, route(async (req, res) => ok(res, {
    announcement: await announcements.update(req.account, req.params.id, req.body ?? {}),
  })));

  api.delete("/announcements/:id", announce, route(async (req, res) => {
    await announcements.remove(req.account, req.params.id);
    return gone(res);
  }));

  // ---- the college itself --------------------------------------------------

  const settingsWrite = requirePermission(P.COLLEGE_SETTINGS_WRITE);

  api.get("/college", settingsWrite, route((req, res) => ok(res, colleges.profile(req.account))));

  api.patch("/college", settingsWrite, route(async (req, res) => ok(res, await colleges.updateProfile(req.account, req.body ?? {}))));

  /** Six switches, each of which changes the product for this college alone. */
  api.patch("/college/settings", settingsWrite, route(async (req, res) => ok(res, {
    settings: await colleges.updateSettings(req.account, req.body ?? {}),
  })));

  // ---- reading the numbers -------------------------------------------------

  /**
   * Scoped by the caller, not by a parameter: an officer asking for analytics
   * gets their desks' numbers, an admin gets the college's. Same route, and the
   * account object decides.
   */
  api.get("/analytics", requirePermission(P.COLLEGE_ANALYTICS_READ), route((req, res) => ok(
    res,
    analytics.forCollege(req.account, { days: qs.int(req.query.days, 30, { min: 7, max: 180 }) }),
  )));

  /** The activity strip: what has happened in this college in the last while. */
  api.get("/activity", requirePermission(P.COLLEGE_ANALYTICS_READ), route((req, res) => ok(res, {
    activity: container.live.recent(req.account.collegeId, qs.int(req.query.limit, 30, { min: 1, max: 100 })),
  })));

  /**
   * The audit log. Reporter actions are recorded with no actor at all — the
   * writer in subscribers.js labels them "TrustLine" — so this can be read
   * freely without it becoming a way to work out who filed what.
   */
  api.get("/audit", requirePermission(P.COLLEGE_ANALYTICS_READ), route((req, res) => ok(res, {
    events: db.audit.ofCollege(req.account.collegeId, qs.int(req.query.limit, 100, { min: 1, max: 500 }))
      .map((event) => event.view()),
  })));

  return api;
}
