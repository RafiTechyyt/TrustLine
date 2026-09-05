// reportRoutes.js — filing, and the two things anyone can do with a public report.
//
// The interesting route here is POST /preview. It is a dry run of filing that
// writes nothing: it returns what the draft gives away about the person writing
// it, what has already been reported that looks the same, and which desk it is
// about to reach. Running it on a debounce while someone types is what turns the
// privacy scanner from a rejection at the end into advice during.
//
// Note that both write routes are throttled and neither takes a session. A key
// derived from the caller (see middleware/anon.js) stands in for identity, so
// backing can be counted once per person without knowing who the person is.

import { Router } from "express";
import { route, ok, created, qs } from "../respond.js";
import { throttle } from "../middleware/throttle.js";
import { anonKey } from "../middleware/anon.js";
import { config } from "../../config.js";

export function reportRoutes({ services }) {
  const { colleges, complaints } = services;
  const api = Router();

  api.post("/preview", throttle({ windowMs: 60_000, max: 90 }, "preview"), route((req, res) => {
    const college = colleges.bySlugOrId(req.body?.college ?? req.body?.collegeId ?? "");
    return ok(res, complaints.preview({
      collegeId: college.id,
      title: qs.str(req.body?.title),
      body: qs.str(req.body?.body),
      categoryId: qs.str(req.body?.categoryId) || null,
      reporterKey: qs.str(req.body?.reporterKey, "student"),
    }));
  }));

  /**
   * Filing. The response is the only time the trace code is ever shown, which
   * the receipt screen says in as many words — there is no email to send it to,
   * by design.
   */
  api.post(
    "/",
    throttle(config.rateLimits.report, "file"),
    anonKey("file"),
    route(async (req, res) => {
      const college = colleges.bySlugOrId(req.body?.college ?? req.body?.collegeId ?? "");
      const { report, receipt } = await complaints.file(
        { ...req.body, collegeId: college.id },
        { supportKey: req.anonKey },
      );
      return created(res, { traceCode: report.traceCode, receipt });
    }),
  );

  /** A public report as anyone sees it: no contact, no internal notes. */
  api.get("/:code", route((req, res) => ok(res, complaints.publicOne(req.params.code))));

  /** "I face this too." One per caller per report, enforced in the aggregate. */
  api.post(
    "/:code/support",
    throttle(config.rateLimits.support, "support"),
    anonKey("support"),
    route(async (req, res) => ok(res, await complaints.support(req.params.code, req.anonKey))),
  );

  return api;
}
