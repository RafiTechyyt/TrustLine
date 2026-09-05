// traceRoutes.js — the reporter's own view of their report.
//
// There is no account behind any of this. Authorisation is the trace code plus,
// if one was set, the passphrase — nothing else, which is the whole point: an
// anonymous reporter cannot be asked to prove who they are without stopping
// being anonymous.
//
// The passphrase arrives in a header rather than the query string. A query
// string ends up in browser history, in `Referer` on the next click, and in
// every access log in between; a header ends up in none of those. The body is
// accepted too for writes, and the query string only as a last resort so a
// pasted link still works — with the tradeoff acknowledged rather than hidden.

import { Router } from "express";
import { route, ok, qs } from "../respond.js";
import { throttle } from "../middleware/throttle.js";
import { config } from "../../config.js";
import { VISIBILITY, CONTACT_SHARING } from "../../core/enums.js";

const passOf = (req) => req.get("x-trace-pass")
  || (typeof req.body?.passphrase === "string" ? req.body.passphrase : null)
  || (typeof req.query?.pass === "string" ? req.query.pass : null)
  || null;

export function traceRoutes({ services }) {
  const { complaints, threads } = services;
  const api = Router();

  // Guessing a trace code should be pointless, and guessing thousands should be
  // expensive. This is the only brake on that.
  api.use(throttle({ windowMs: 60_000, max: 60 }, "trace"));

  /** Everything the reporter sees: status, rail, thread, ratings, contact state. */
  api.get("/:code", route((req, res) => ok(res, complaints.track(req.params.code, passOf(req)))));

  api.get("/:code/thread", route((req, res) => ok(res, {
    messages: threads.forReporter(req.params.code, passOf(req)),
  })));

  /**
   * A follow-up is scanned exactly like the original was. `privacyFindings` on
   * the response is how the thread UI shows "you put a phone number in that" —
   * after the message is posted, because advice that blocks a reply is advice
   * that gets worked around.
   */
  api.post("/:code/replies", throttle(config.rateLimits.thread, "reply"), route(async (req, res) => ok(
    res,
    await threads.replyAsReporter(req.params.code, passOf(req), qs.str(req.body?.body)),
  )));

  api.patch("/:code", route(async (req, res) => ok(res, await complaints.revise(req.params.code, passOf(req), {
    title: req.body?.title,
    body: req.body?.body,
    location: req.body?.location,
  }))));

  /** Putting it on the feed, or pulling it off, stays the reporter's call. */
  api.patch("/:code/visibility", route(async (req, res) => ok(res, await complaints.setVisibility(
    req.params.code,
    passOf(req),
    qs.bool(req.body?.public, false) ? VISIBILITY.PUBLIC : VISIBILITY.PRIVATE,
  ))));

  /**
   * The one route that can attach something identifying to a report. It is opt
   * in, it is scoped ("the desk handling this" or "the admin only"), and the
   * reporter can withdraw it again by posting `sharing: "none"`.
   */
  api.post("/:code/contact", route(async (req, res) => ok(res, await complaints.shareContact(
    req.params.code,
    passOf(req),
    {
      sharing: qs.str(req.body?.sharing, CONTACT_SHARING.DEPARTMENT),
      channel: qs.str(req.body?.channel, "phone"),
      value: qs.str(req.body?.value),
    },
  ))));

  api.post("/:code/rating", route(async (req, res) => ok(res, await complaints.rate(req.params.code, passOf(req), {
    score: qs.int(req.body?.score, 0, { min: 0, max: 5 }),
    note: qs.str(req.body?.note),
  }))));

  api.post("/:code/reopen", route(async (req, res) => ok(
    res,
    await complaints.reopen(req.params.code, passOf(req), qs.str(req.body?.reason)),
  )));

  api.post("/:code/withdraw", route(async (req, res) => ok(
    res,
    await complaints.withdraw(req.params.code, passOf(req), qs.str(req.body?.reason)),
  )));

  return api;
}
