// publicRoutes.js — everything a person can reach without an account.
//
// This is most of the product. A reporter never signs in, so these routes carry
// the college picker, the report form's own catalogue, the feed, the notice board
// and the transparency page. Nothing here takes a session cookie into account,
// which is what makes it all cacheable and what keeps a reporter from ever having
// a login to be linked to.

import { Router } from "express";
import { route, ok, qs } from "../respond.js";

export function publicRoutes({ services, container }) {
  const { colleges, complaints, announcements, analytics, sla } = services;
  const api = Router();

  /** The landing page picker. `?q=` matches name, short name or place. */
  api.get("/colleges", route((req, res) => ok(res, {
    colleges: colleges.directory({ query: qs.str(req.query.q) }),
  })));

  /**
   * Resolving a slug once, here, is what lets every other public route take an
   * id — so /r/cep in the browser and /api/colleges/cep both work, and the
   * frontend never has to know a college's uuid.
   */
  api.get("/colleges/:handle", route((req, res) => {
    const college = colleges.bySlugOrId(req.params.handle);
    return ok(res, {
      ...complaints.catalogue(college.id),
      announcements: announcements.forCollege(college.id, { limit: 4 }),
      // Counts only. The named list of late reports is a desk view — see the
      // comment on SlaService.health.
      health: sla.health(college.id, { includeWorst: false }),
    });
  }));

  /** The report form: categories, who-are-you options, and the status rail. */
  api.get("/colleges/:handle/catalogue", route((req, res) => {
    const college = colleges.bySlugOrId(req.params.handle);
    return ok(res, complaints.catalogue(college.id));
  }));

  api.get("/colleges/:handle/feed", route((req, res) => {
    const college = colleges.bySlugOrId(req.params.handle);
    return ok(res, complaints.feed(college.id, {
      sort: qs.str(req.query.sort, "hot"),
      categoryId: qs.str(req.query.category) || null,
      status: qs.str(req.query.status) || null,
      query: qs.str(req.query.q),
      limit: qs.int(req.query.limit, 60, { min: 1, max: 120 }),
    }));
  }));

  api.get("/colleges/:handle/announcements", route((req, res) => {
    const college = colleges.bySlugOrId(req.params.handle);
    return ok(res, {
      announcements: announcements.forCollege(college.id, {
        limit: qs.int(req.query.limit, 8, { min: 1, max: 30 }),
      }),
    });
  }));

  /**
   * The transparency page. Deliberately public and deliberately unflattering
   * where the numbers are unflattering — a college that publishes its median
   * response time has a reason to shorten it. Confidential categories are
   * excluded inside the service, not here.
   */
  api.get("/colleges/:handle/transparency", route((req, res) => {
    const college = colleges.bySlugOrId(req.params.handle);
    return ok(res, analytics.transparency(college.id, {
      days: qs.int(req.query.days, 90, { min: 7, max: 365 }),
    }));
  }));

  /**
   * Liveness, and nothing else.
   *
   * This used to answer with the whole of `container.status()` — store counts,
   * every registered listener, the SLA clock — to anyone who asked. None of it
   * names a person, but a public endpoint that enumerates the internals is a
   * free map for anyone probing the box, and no page ever needed it: the ops
   * console's system strip reads `/api/platform/status`, which is behind
   * `platform.metrics.read`. So the detail lives there and only there, and what
   * is left here is what a load balancer actually asks for.
   */
  api.get("/health", route((_req, res) => ok(res, {
    ok: container.booted,
    service: "trustline",
    uptimeSeconds: Math.round(process.uptime()),
    at: Date.now(),
  })));

  return api;
}
