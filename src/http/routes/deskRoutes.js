// deskRoutes.js — the ops queue: what a desk officer or an admin does all day.
//
// Every route here is guarded twice, on purpose. The middleware checks the
// permission, and the service checks it again along with the per-report scope,
// because the service is also called by the seed script and the SLA sweep. The
// duplication is the point: no route can accidentally become the only place a
// rule is enforced.
//
// Nothing in this file compares a role. `requirePermission(P.REPORTS_MERGE)`
// reads the same whether the caller is an officer, an admin, or a kind of account
// that does not exist yet.

import { Router } from "express";
import { route, ok, qs } from "../respond.js";
import { requireAccount, requireCollege, requireAnyPermission, requirePermission } from "../middleware/auth.js";
import { P } from "../../core/accounts/permissions.js";

export function deskRoutes({ services, db }) {
  const { complaints, threads, sla } = services;
  const api = Router();

  // A signed-in account, attached to a college that is actually live, with some
  // form of report access. Everything below can assume all three.
  api.use(requireAccount(), requireCollege({ db }), requireAnyPermission(P.REPORTS_READ_ALL, P.REPORTS_READ_ASSIGNED));

  /**
   * The queue. `counts` is computed over the caller's whole scope rather than the
   * filtered page, so the tab badges do not change when a filter is applied —
   * an officer needs "6 overdue" to mean six overdue, not six on this screen.
   */
  api.get("/reports", route((req, res) => ok(res, complaints.deskQueue(req.account, {
    status: qs.str(req.query.status) || null,
    priority: qs.str(req.query.priority) || null,
    departmentId: qs.str(req.query.department) || null,
    categoryId: qs.str(req.query.category) || null,
    overdue: qs.bool(req.query.overdue),
    unassigned: qs.bool(req.query.unassigned),
    query: qs.str(req.query.q),
    sort: qs.str(req.query.sort, "urgent"),
    limit: qs.int(req.query.limit, 40, { min: 1, max: 200 }),
    offset: qs.int(req.query.offset, 0, { min: 0, max: 100000 }),
  }))));

  /** The response-time picture for the whole college: open, due soon, overdue. */
  api.get("/health", route((req, res) => ok(res, sla.health(req.account.collegeId))));

  /**
   * How many reporter replies are sitting unread across the caller's scope — the
   * number on the "someone answered you" badge. A count rather than a list
   * because that is what the badge needs; the queue itself is the list.
   */
  api.get("/unread", route((req, res) => ok(res, { count: threads.unreadForDesk(req.account) })));

  /** One report, with the full thread including internal notes, and routing targets. */
  api.get("/reports/:code", route((req, res) => ok(res, complaints.deskOne(req.account, req.params.code))));

  api.get("/reports/:code/thread", route((req, res) => ok(res, {
    messages: threads.forDesk(req.account, req.params.code),
  })));

  // ---- talking to the reporter ---------------------------------------------

  /**
   * A desk reply. `askReporter` is the flag that matters: it moves the report to
   * "waiting for you" and stops the response clock, because the desk is no longer
   * the one holding things up.
   */
  api.post("/reports/:code/replies", requirePermission(P.REPORTS_REPLY), route(async (req, res) => ok(
    res,
    await threads.replyAsDesk(req.account, req.params.code, qs.str(req.body?.body), {
      askReporter: qs.bool(req.body?.askReporter),
    }),
  )));

  /** An internal note. Filtered out of the reporter's thread in the repository. */
  api.post("/reports/:code/notes", requirePermission(P.REPORTS_NOTE), route(async (req, res) => ok(
    res,
    await threads.note(req.account, req.params.code, qs.str(req.body?.body)),
  )));

  // ---- moving a report -----------------------------------------------------

  api.patch("/reports/:code/status", requirePermission(P.REPORTS_STATUS_WRITE), route(async (req, res) => ok(
    res,
    await complaints.changeStatus(req.account, req.params.code, {
      status: qs.str(req.body?.status),
      note: qs.str(req.body?.note),
      reason: qs.str(req.body?.reason),
    }),
  )));

  api.post("/reports/:code/claim", requirePermission(P.REPORTS_STATUS_WRITE), route(async (req, res) => ok(
    res,
    await complaints.claim(req.account, req.params.code),
  )));

  api.post("/reports/:code/assign", requirePermission(P.REPORTS_ASSIGN), route(async (req, res) => ok(
    res,
    await complaints.assign(req.account, req.params.code, qs.str(req.body?.officerId)),
  )));

  /** Re-routing gives the receiving desk a fresh response window, not the remains of one. */
  api.post("/reports/:code/route", requirePermission(P.REPORTS_ASSIGN), route(async (req, res) => ok(
    res,
    await complaints.reroute(req.account, req.params.code, {
      departmentId: qs.str(req.body?.departmentId),
      categoryId: qs.str(req.body?.categoryId) || undefined,
      reason: qs.str(req.body?.reason),
    }),
  )));

  /** Raising is free; going under the floor the reporter's situation sets is refused. */
  api.patch("/reports/:code/priority", requirePermission(P.REPORTS_STATUS_WRITE), route(async (req, res) => ok(
    res,
    await complaints.prioritise(req.account, req.params.code, qs.str(req.body?.priority), qs.str(req.body?.reason)),
  )));

  api.patch("/reports/:code/tags", requirePermission(P.REPORTS_STATUS_WRITE), route(async (req, res) => ok(
    res,
    await complaints.tag(req.account, req.params.code, {
      add: qs.list(req.body?.add),
      remove: qs.list(req.body?.remove),
    }),
  )));

  api.post("/reports/:code/escalate", requirePermission(P.REPORTS_ESCALATE), route(async (req, res) => ok(
    res,
    await complaints.escalate(req.account, req.params.code, qs.str(req.body?.reason)),
  )));

  /** Folds this report into another. The duplicate's trace code keeps working. */
  api.post("/reports/:code/merge", requirePermission(P.REPORTS_MERGE), route(async (req, res) => ok(
    res,
    await complaints.merge(req.account, req.params.code, qs.str(req.body?.into)),
  )));

  return api;
}
