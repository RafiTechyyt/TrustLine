// api-test.js — the HTTP layer, exercised the way a browser would.
//
// smoke.js proves the services work. This proves the wiring in front of them
// works: status codes, cookies, permission boundaries, and the handful of
// guarantees that would be invisible in a service-level test — a 401 for no
// session, a 403 that looks identical whether a report is missing or merely out
// of scope, and the platform office being unable to read a report over HTTP.
//
//   node scripts/api-test.js

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import assert from "node:assert/strict";

import { Container } from "../src/services/index.js";
import { DataStore } from "../src/repositories/index.js";
import { createApp } from "../src/http/app.js";
import { STATUS } from "../src/core/status/states.js";
import { PRIORITY, VISIBILITY, CONTACT_SHARING } from "../src/core/enums.js";
import { config } from "../src/config.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trustline-api-"));
const container = new Container({ db: new DataStore(dir) });
const { owner } = await container.boot({ startClock: false });
const server = createApp({ container }).listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const steps = [];
const step = (name) => {
  steps.push(name);
  process.stdout.write(`  ${String(steps.length).padStart(2)}. ${name}\n`);
};

/** One jar per actor, so three sessions can be held open at once. */
class Client {
  #jar = new Map();

  constructor(label) { this.label = label; }

  async send(method, url, { body, headers = {}, expect = null } = {}) {
    const cookie = [...this.#jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });

    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      const value = pair.slice(eq + 1);
      if (value) this.#jar.set(pair.slice(0, eq), value);
      else this.#jar.delete(pair.slice(0, eq));
    }

    const payload = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
    if (expect !== null && res.status !== expect) {
      throw new Error(`${this.label} ${method} ${url} → ${res.status}, expected ${expect}\n${JSON.stringify(payload, null, 2)}`);
    }
    return { status: res.status, body: payload, headers: res.headers };
  }

  get(url, options) { return this.send("GET", url, options); }
  post(url, body, options) { return this.send("POST", url, { ...options, body: body ?? {} }); }
  patch(url, body, options) { return this.send("PATCH", url, { ...options, body: body ?? {} }); }
  del(url, options) { return this.send("DELETE", url, options); }

  /** Held open rather than read to completion — the SSE stream never ends. */
  stream(url) {
    const cookie = [...this.#jar].map(([k, v]) => `${k}=${v}`).join("; ");
    return fetch(`${base}${url}`, { headers: { accept: "text/event-stream", cookie } });
  }
}

/**
 * A buffered SSE reader.
 *
 * The naive version — race reader.read() against a timer — is wrong in a way
 * that looks like a server bug: an abandoned read stays queued on the stream and
 * swallows the next chunk, so the frame you were waiting for gets delivered to
 * nobody. One background loop, and a buffer everything reads out of, instead.
 */
function sse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let ended = false;

  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
    } catch { /* cancelled below */ }
    ended = true;
  })();

  return {
    async next(ms = 4000) {
      const deadline = Date.now() + ms;
      while (!chunks.length && !ended && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return chunks.shift() ?? null;
    },
    close: () => reader.cancel().catch(() => {}),
  };
}

const anon = new Client("anon");
const platform = new Client("platform");
const admin = new Client("admin");
const officer = new Client("officer");

console.log(`\nTrustLine HTTP walkthrough\n  ${base}\n  data: ${dir}\n`);

// ---- what anyone can reach ------------------------------------------------

step("health answers, and every API response is uncacheable by design");
const health = await anon.get("/api/health", { expect: 200 });
assert.equal(health.body.ok, true);
assert.equal(health.body.service, "trustline");
assert.ok(Number.isFinite(health.body.uptimeSeconds));
// A liveness probe should be liveness only. The store counts and the listener
// table are real operational detail, and they answer at /api/platform/status
// behind a permission — not here, to anyone who asks.
for (const leaked of ["counts", "listeners", "events", "sla", "liveClients"]) {
  assert.equal(health.body[leaked], undefined, `/api/health is publishing ${leaked}`);
}
assert.equal(health.headers.get("cache-control"), "no-store", "a cached trace response is a leaked report");
assert.equal(health.headers.get("referrer-policy"), "no-referrer", "the page URL carries a trace code");
assert.match(health.headers.get("content-security-policy"), /default-src 'self'/);
assert.equal(health.headers.get("x-powered-by"), null, "express is advertising itself");

step("a college registers itself together with its founding admin");
const reg = await anon.post("/api/auth/register/college", {
  name: "College of Engineering Perumon", shortName: "CEP", city: "Kollam", state: "Kerala",
  university: "APJ Abdul Kalam Technological University",
  adminName: "Dr. Anitha Menon", adminEmail: "admin@cep.ac.in", password: "perumon2026",
}, { expect: 201 });
const slug = reg.body.college.slug;
const collegeId = reg.body.college.id;
assert.equal(reg.body.college.status, "pending");
assert.ok(slug && collegeId);

step("the founding admin's password does not work until the college is approved");
const early = await admin.post("/api/auth/sign-in", {
  email: "admin@cep.ac.in", password: "perumon2026",
}, { expect: 403 });
assert.match(early.body.error, /waiting for approval/i);
assert.equal(early.body.code, "forbidden");

step("a pending college is invisible to the public directory");
const hidden = await anon.get("/api/colleges", { expect: 200 });
assert.equal(hidden.body.colleges.some((c) => c.slug === slug), false);
await anon.get(`/api/colleges/${slug}`, { expect: 404 });

// ---- the platform office -------------------------------------------------

step("the platform office signs in and sees the approvals queue");
await platform.post("/api/auth/sign-in", {
  email: config.platformOwner.email, password: config.platformOwner.password,
}, { expect: 200 });
const queue = await platform.get("/api/platform/review", { expect: 200 });
const waiting = queue.body.colleges.find((c) => c.id === collegeId);
assert.ok(waiting, "the registered college should be in the queue");
assert.equal(waiting.admins.length, 1, "the founding admin rides along with the college");

step("approving the college activates its founding admin in the same call");
const approved = await platform.post(`/api/platform/colleges/${collegeId}/review`, {
  decision: "approve", note: "Verified against the university listing",
}, { expect: 200 });
assert.equal(approved.body.college.status, "active");
assert.equal(approved.body.activated, 1, "the founding admin should be approved alongside the college");
assert.equal(approved.body.review.colleges.length, 0, "the queue the console is looking at should have emptied");

// ---- the admin builds the routing table ----------------------------------

step("the same password now works, and /me carries what the console needs to draw");
await admin.post("/api/auth/sign-in", { email: "admin@cep.ac.in", password: "perumon2026" }, { expect: 200 });
const me = await admin.get("/api/auth/me", { expect: 200 });
assert.ok(me.body.account.permissions.length > 0, "profile() should carry the permission list");
assert.equal(me.body.college.slug, slug);
assert.ok(me.body.college.settings, "the console needs the settings to draw the switches");
// Warnings are about a routing table that is wrong, not one that is empty: a
// college with nothing set up yet has no misconfiguration to report.
assert.deepEqual(me.body.warnings, []);

step("before any desk exists, a report is refused rather than filed into a void");
const nowhere = await anon.post("/api/reports", {
  college: slug, reporterKey: "student", title: "Testing before setup",
  body: "This college has not created any desks yet, so there is nowhere for this to land.",
}, { expect: 409 });
assert.match(nowhere.body.error, /not finished setting up/i);
assert.equal((await anon.get(`/api/colleges/${slug}/catalogue`)).body.categories.length, 0);

step("desks are created, then categories, then routed to them");
const desks = {};
for (const desk of [
  { name: "Hostel Office", code: "HOSTEL", slaHours: 48 },
  { name: "Examination Cell", code: "EXAM" },
  { name: "Internal Complaints Committee", code: "ICC", slaHours: 12 },
]) {
  const res = await admin.post("/api/admin/departments", desk, { expect: 201 });
  desks[desk.code] = res.body.created;
  assert.ok(res.body.departments, "a mutation should answer with the whole board");
}

const cats = {};
for (const cat of [
  { name: "Hostel water supply", code: "WATER", keywords: ["water", "tap", "bathroom"], departmentId: desks.HOSTEL },
  { name: "Exam and revaluation", code: "REVAL", keywords: ["exam", "revaluation", "marks"], departmentId: desks.EXAM },
  {
    name: "Harassment", code: "HARASS", keywords: ["harassment", "ragging"],
    departmentId: desks.ICC, confidential: true, defaultPriority: PRIORITY.HIGH,
  },
]) {
  const res = await admin.post("/api/admin/categories", cat, { expect: 201 });
  cats[cat.code] = res.body.created;
}
const board = await admin.get("/api/admin/catalog", { expect: 200 });
assert.equal(board.body.warnings.length, 0, `expected a clean board, got ${JSON.stringify(board.body.warnings)}`);

step("an unrouted category is warned about and kept off the report form");
const orphan = await admin.post("/api/admin/categories", { name: "Something else", code: "MISC" }, { expect: 201 });
assert.equal(orphan.body.warnings.length, 1, "a category pointing nowhere should raise exactly one warning");
const form = await anon.get(`/api/colleges/${slug}/catalogue`, { expect: 200 });
assert.equal(form.body.categories.some((c) => c.id === orphan.body.created), false, "an unrouted category reached the form");
await admin.post(`/api/admin/categories/${orphan.body.created}/route`, { departmentId: desks.HOSTEL }, { expect: 200 });

step("a desk officer is created, scoped to one desk");
const officerRes = await admin.post("/api/admin/team/officers", {
  name: "Ramesh K", email: "hostel@cep.ac.in", title: "Hostel Warden",
  password: "hostel2026", departmentIds: [desks.HOSTEL],
}, { expect: 201 });
assert.deepEqual(officerRes.body.officer.departmentIds, [desks.HOSTEL]);

// ---- filing, with no account anywhere in sight ----------------------------

step("an approved college appears in the directory with a working landing payload");
const directory = await anon.get("/api/colleges", { expect: 200 });
assert.ok(directory.body.colleges.some((c) => c.slug === slug));
const landing = await anon.get(`/api/colleges/${slug}`, { expect: 200 });
assert.ok(landing.body.categories.length >= 3);
assert.ok(landing.body.health, "the landing page carries the college's response health");
assert.equal(landing.body.health.worst.length, 0,
  "the public landing page must not name late reports — openOfCollege does not filter by visibility, "
  + "so that list would hand out trace codes for private and confidential reports");
assert.ok(Array.isArray(landing.body.announcements));

step("preview advises on self-doxxing, names the desk, and writes nothing");
const preview = await anon.post("/api/reports/preview", {
  college: slug,
  title: "No water in B block since Monday",
  body: "I am Arun, room 214, call me on 9876543210. The taps have been dry for four days.",
}, { expect: 200 });
assert.ok(preview.body.privacy.findings.length >= 2, "expected a name and a phone number to be flagged");
assert.equal(preview.body.routing.department, "Hostel Office");
assert.ok(
  preview.body.privacy.findings.every((f) => !String(f.sample).includes("9876543210")),
  "the scanner echoed the leak back unmasked",
);
assert.equal(
  (await platform.get("/api/platform/status")).body.counts.complaints ?? 0,
  0,
  "preview wrote a record",
);

step("filing answers with the trace code, which is the only time it is ever shown");
const filed = await anon.post("/api/reports", {
  college: slug, reporterKey: "student",
  title: "No water in B block since Monday",
  body: "The taps on the second floor of B block have been dry for four days. Around forty of us are carrying buckets up from the ground floor.",
  wantsPublic: true, passphrase: "bucket",
}, { expect: 201 });
const code = filed.body.traceCode;
assert.match(code, /^TL-/);
assert.equal(filed.body.receipt.department, "Hostel Office", "the report did not reach the desk it is about");
assert.equal(filed.body.receipt.visibility, VISIBILITY.PUBLIC);
assert.ok(filed.body.receipt.handle, "the desk needs an anonymous handle to address");

step("a confidential category overrides the reporter's show-on-feed choice");
const parent = await anon.post("/api/reports", {
  college: slug, reporterKey: "parent", categoryId: cats.HARASS,
  title: "Seniors intimidating first years after hours",
  body: "My daughter says a group of seniors has been stopping first years near the back gate after 9pm and making them do things.",
  wantsPublic: true, passphrase: "backgate",
}, { expect: 201 });
const parentCode = parent.body.traceCode;
assert.equal(parent.body.receipt.visibility, VISIBILITY.PRIVATE);
assert.ok(["high", "urgent"].includes(parent.body.receipt.priority ?? "high"));

step("the feed carries the public report and never the confidential one");
const feed = await anon.get(`/api/colleges/${slug}/feed?sort=recent`, { expect: 200 });
assert.equal(feed.body.reports.some((r) => r.traceCode === code), true);
assert.equal(feed.body.reports.some((r) => r.traceCode === parentCode), false, "A CONFIDENTIAL REPORT REACHED THE FEED");
assert.equal(feed.body.reports.every((r) => r.contact === undefined), true);

step("backing a report is counted once per caller");
const backed = await anon.post(`/api/reports/${code}/support`, {}, { expect: 200 });
assert.equal(backed.body.supportCount, 2);
const twice = await anon.post(`/api/reports/${code}/support`, {}, { expect: 409 });
assert.match(twice.body.error, /already/i);

// ---- the reporter's own view, with no account behind it -------------------

step("the trace code alone will not open a report that was given a passphrase");
await anon.get(`/api/trace/${code}`, { expect: 403 });
await anon.get(`/api/trace/${code}`, { headers: { "x-trace-pass": "wrong" }, expect: 403 });
await anon.get("/api/trace/TL-ZZZZ-ZZZZ", { expect: 404 });

step("with the passphrase in a header, the reporter gets their report back");
const tracked = await anon.get(`/api/trace/${code}`, { headers: { "x-trace-pass": "bucket" }, expect: 200 });
assert.equal(tracked.body.traceCode, code);
assert.equal(tracked.body.status, STATUS.SUBMITTED);
assert.ok(tracked.body.thread.length >= 1, "the filing receipt should already be on the thread");

step("preview shows the open report to the next person about to file the same thing");
const echo = await anon.post("/api/reports/preview", {
  college: slug, title: "B block taps dry",
  body: "No water in the second floor bathrooms of B block for days now, we are carrying buckets up.",
}, { expect: 200 });
assert.ok(echo.body.duplicates.some((d) => d.traceCode === code), "the open water report was not suggested");

// ---- the desk ------------------------------------------------------------

step("an officer's queue is their desks and nothing else");
await officer.post("/api/auth/sign-in", { email: "hostel@cep.ac.in", password: "hostel2026" }, { expect: 200 });
const deskQueue = await officer.get("/api/desk/reports", { expect: 200 });
assert.ok(deskQueue.body.reports.length >= 1);
assert.equal(deskQueue.body.reports.every((r) => r.departmentName === "Hostel Office"), true);
assert.equal(deskQueue.body.reports.some((r) => r.traceCode === parentCode), false);
const outOfScope = await officer.get(`/api/desk/reports/${parentCode}`, { expect: 403 });
assert.match(outOfScope.body.error, /not on your desk/i);

step("a report that does not exist is refused the same way as one out of scope");
const nothingThere = await officer.get("/api/desk/reports/TL-ZZZZ-ZZZZ", { expect: 403 });
assert.equal(nothingThere.body.error, outOfScope.body.error, "the two answers must be indistinguishable");

step("a desk reply acknowledges the report and claims it in one move");
await officer.post(`/api/desk/reports/${code}/replies`, {
  body: "We have raised this with the water authority and a tanker is booked for tomorrow morning.",
}, { expect: 200 });
let detail = (await officer.get(`/api/desk/reports/${code}`, { expect: 200 })).body;
assert.equal(detail.status, STATUS.TRIAGED);
assert.equal(detail.assignedTo, officerRes.body.officer.id);

step("an internal note never reaches the reporter's thread");
await officer.post(`/api/desk/reports/${code}/notes`, {
  body: "Pump motor is actually burnt out — this will recur unless it is replaced.",
}, { expect: 200 });
const reporterThread = await anon.get(`/api/trace/${code}/thread`, {
  headers: { "x-trace-pass": "bucket" }, expect: 200,
});
assert.equal(
  reporterThread.body.messages.some((m) => m.body.includes("burnt out")),
  false,
  "INTERNAL NOTE LEAKED TO THE REPORTER OVER HTTP",
);
assert.equal((await officer.get(`/api/desk/reports/${code}/thread`)).body.messages.some((m) => m.internal), true);

step("asking the reporter a question stops the response clock");
await officer.post(`/api/desk/reports/${code}/replies`, {
  body: "Which floors exactly are dry — is the ground floor working?", askReporter: true,
}, { expect: 200 });
detail = (await officer.get(`/api/desk/reports/${code}`)).body;
assert.equal(detail.status, STATUS.AWAITING_REPORTER);
assert.equal(detail.remainingMs, null, "the clock must not run while the desk is waiting on the reporter");

step("the reporter answers and the clock starts again");
const pass = { headers: { "x-trace-pass": "bucket" } };
await anon.post(`/api/trace/${code}/replies`, {
  body: "Ground floor is fine. Second and third are dry.",
}, { ...pass, expect: 200 });
detail = (await officer.get(`/api/desk/reports/${code}`)).body;
assert.equal(detail.status, STATUS.IN_PROGRESS);
assert.notEqual(detail.remainingMs, null);

step("a follow-up is scanned too: advised for a phone number, refused for an Aadhaar");
const doxxed = await anon.post(`/api/trace/${code}/replies`, {
  body: "I am Arun Kumar, room 214, call me on 9876543210 any time.",
}, { ...pass, expect: 200 });
assert.ok(doxxed.body.privacyFindings.some((f) => f.kind === "phone"));
const refused = await anon.post(`/api/trace/${code}/replies`, {
  body: "My Aadhaar is 4321 8765 2109 if you need to verify me.",
}, { ...pass, expect: 422 });
assert.equal(refused.body.code, "validation_failed");
assert.match(refused.body.error, /identity number/i);

step("identity reveal is opt in, and scoped to the desk that needs it");
await anon.post(`/api/trace/${code}/contact`, {
  sharing: CONTACT_SHARING.DEPARTMENT, channel: "phone", value: "9876500000",
}, { ...pass, expect: 200 });
assert.equal((await officer.get(`/api/desk/reports/${code}`)).body.contact?.value, "9876500000");
const publicOne = await anon.get(`/api/reports/${code}`, { expect: 200 });
assert.equal(publicOne.body.contact, undefined, "CONTACT DETAILS APPEARED ON THE PUBLIC VIEW");
assert.equal(JSON.stringify(publicOne.body).includes("9876500000"), false);

// ---- the boundaries ------------------------------------------------------

step("no session is 401; the wrong session is 403");
await anon.get("/api/desk/reports", { expect: 401 });
await anon.get("/api/admin/catalog", { expect: 401 });
await anon.get("/api/platform/analytics", { expect: 401 });
const notAdmin = await officer.get("/api/admin/catalog", { expect: 403 });
assert.equal(notAdmin.body.code, "forbidden");
await officer.get("/api/platform/review", { expect: 403 });
await officer.post(`/api/desk/reports/${code}/merge`, { into: parentCode }, { expect: 403 });

step("the platform office cannot open a report through any route it has");
const denied = await platform.get(`/api/desk/reports/${code}`, { expect: 403 });
assert.equal(JSON.stringify(denied.body).includes("B block"), false);
const platformNumbers = await platform.get("/api/platform/analytics", { expect: 200 });
assert.equal(platformNumbers.body.colleges.active, 1);
assert.equal(
  JSON.stringify(platformNumbers.body).includes("B block"),
  false,
  "THE PLATFORM CONSOLE LEAKED REPORT CONTENT",
);

// ---- the live stream -----------------------------------------------------

step("the live stream refuses an anonymous caller, then opens with a hello frame");
await anon.get("/api/live", { expect: 401 });
const live = await admin.stream("/api/live");
assert.equal(live.status, 200);
assert.match(live.headers.get("content-type"), /text\/event-stream/);
const stream = sse(live);
let opening = (await stream.next()) ?? "";
if (!opening.includes("event: hello")) opening += (await stream.next()) ?? "";
assert.match(opening, /retry: 3000/, "the browser is never told how soon to reconnect");
assert.match(opening, /event: hello/);

step("the replay means a console that has just loaded is not staring at nothing");
// subscribe() sends up to twelve past items; drain them so the next read is new.
let drained = opening.includes("event: activity") ? 1 : 0;
for (let quiet = false; !quiet;) {
  const more = await stream.next(400);
  if (more === null) quiet = true;
  else drained += 1;
}
assert.ok(drained >= 1, "nothing was replayed to a client joining a college mid-conversation");

step("resolving the report pushes a frame down the stream that is already open");
await officer.patch(`/api/desk/reports/${code}/status`, {
  status: STATUS.RESOLVED, note: "Tanker delivered and the pump motor was replaced on Thursday.",
}, { expect: 200 });
const pushed = await stream.next();
assert.ok(pushed, "the status change never reached the open stream");
assert.match(pushed, /event: activity/);
assert.match(pushed, /report\.status/);
await stream.close();

// ---- closing the loop ----------------------------------------------------

step("the reporter rates the outcome, then says it is not actually fixed");
await anon.post(`/api/trace/${code}/rating`, { score: 4, note: "Took a while but it is fixed." }, { ...pass, expect: 200 });
assert.equal((await anon.get(`/api/trace/${code}`, pass)).body.satisfaction, 4);
await anon.post(`/api/trace/${code}/reopen`, { reason: "It went dry again on Sunday." }, { ...pass, expect: 200 });
assert.equal((await officer.get(`/api/desk/reports/${code}`)).body.status, STATUS.IN_PROGRESS);

step("an illegal move is refused with the two states named");
const illegal = await officer.patch(`/api/desk/reports/${code}/status`, { status: STATUS.SUBMITTED }, { expect: 409 });
assert.equal(illegal.body.code, "illegal_transition");
assert.ok(illegal.body.details.from && illegal.body.details.to);

step("an admin reroutes, reprioritises, and merges a duplicate");
const dup = await anon.post("/api/reports", {
  college: slug, reporterKey: "student", categoryId: cats.WATER,
  title: "B block bathrooms have no water",
  body: "Second floor B block bathrooms are completely dry, this has been going on for most of the week now.",
  wantsPublic: true,
}, { expect: 201 });
await admin.post(`/api/desk/reports/${code}/route`, {
  departmentId: desks.EXAM, reason: "misfiled on purpose, to prove the route works",
}, { expect: 200 });
await admin.post(`/api/desk/reports/${code}/route`, { departmentId: desks.HOSTEL, reason: "back where it belongs" }, { expect: 200 });
const floored = await admin.patch(`/api/desk/reports/${parentCode}/priority`, { priority: PRIORITY.LOW }, { expect: 422 });
assert.match(floored.body.error, /cannot go below|held at/i);
await admin.patch(`/api/desk/reports/${parentCode}/priority`, { priority: PRIORITY.URGENT, reason: "No movement yet." }, { expect: 200 });
const merged = await admin.post(`/api/desk/reports/${dup.body.traceCode}/merge`, { into: code }, { expect: 200 });
assert.equal(merged.body.absorbed, dup.body.traceCode);
assert.equal(merged.body.into, code);
const afterMerge = await anon.get(`/api/colleges/${slug}/feed`, { expect: 200 });
assert.equal(afterMerge.body.reports.some((r) => r.traceCode === dup.body.traceCode), false);

// ---- what the consoles read ----------------------------------------------

step("a report filed without a passphrase opens on the trace code alone");
// Which is exactly why /api/live is behind a session: its frames carry codes.
await anon.get(`/api/trace/${dup.body.traceCode}`, { expect: 200 });

step("the desk's own reads: response health, and the unread-replies badge");
const deskHealth = await officer.get("/api/desk/health", { expect: 200 });
assert.ok(deskHealth.body.open >= 1);
const unread = await officer.get("/api/desk/unread", { expect: 200 });
assert.equal(typeof unread.body.count, "number");

step("analytics are scoped by the account asking, on the same route");
const deskNumbers = await officer.get("/api/admin/analytics", { expect: 200 });
const adminNumbers = await admin.get("/api/admin/analytics", { expect: 200 });
assert.ok(adminNumbers.body.headline.total > deskNumbers.body.headline.total, "an officer saw the whole college");
assert.equal(adminNumbers.body.daily.length, 30);

step("the activity strip and the audit log are readable without naming a reporter");
const activity = await admin.get("/api/admin/activity", { expect: 200 });
assert.ok(activity.body.activity.length >= 5);
const audit = await admin.get("/api/admin/audit?limit=200", { expect: 200 });
assert.ok(audit.body.events.length >= 10);
const filedRows = audit.body.events.filter((e) => e.action === "report.filed");
assert.ok(filedRows.length >= 1);
assert.equal(filedRows.every((e) => e.actorLabel === "TrustLine"), true, "a reporter action was logged with an actor");

step("the transparency page publishes the numbers but not the confidential categories");
const scoreboard = await anon.get(`/api/colleges/${slug}/transparency?days=90`, { expect: 200 });
assert.equal(scoreboard.body.categories.some((c) => c.name === "Harassment"), false);
// One report survives the filter: the confidential one and the merged duplicate
// are both excluded, so a college cannot pad its own scoreboard with duplicates.
assert.equal(scoreboard.body.totals.filed, 1);
assert.ok(scoreboard.body.totals.backed >= 3, "the absorbed duplicate's backing should have carried across");

step("an announcement can only cite a public report of the same college");
const digest = await admin.get("/api/admin/announcements/digest", { expect: 200 });
const posted = await admin.post("/api/admin/announcements", {
  title: "What we fixed in the hostels this month",
  body: digest.body.body || "The B block pump motor has been replaced and the water supply is back on every floor.",
  linkedTraceCodes: [code, parentCode, "TL-XXXX-XXXX"],
  pinned: true,
}, { expect: 201 });
assert.deepEqual(posted.body.announcement.linkedTraceCodes, [code], "the citation filter let something through");
assert.ok((await anon.get(`/api/colleges/${slug}/announcements`)).body.announcements.length >= 1);

step("a settings switch changes the product for this college alone");
const off = await admin.patch("/api/admin/college/settings", { publicFeed: false }, { expect: 200 });
assert.equal(off.body.settings.publicFeed, false);
assert.equal(off.body.settings.defaultSlaHours, 72, "a PATCH blanked a setting it was not given");
assert.deepEqual((await anon.get(`/api/colleges/${slug}/feed`, { expect: 200 })).body.reports, []);
await admin.patch("/api/admin/college/settings", { publicFeed: true }, { expect: 200 });
assert.equal((await admin.get("/api/admin/college", { expect: 200 })).body.city, "Kollam");

step("the platform console reads counts, health and its own audit trail");
assert.ok((await platform.get("/api/platform/status", { expect: 200 })).body.counts.complaints >= 3);
assert.equal((await platform.get("/api/platform/colleges", { expect: 200 })).body.colleges[0].admins, 1);
assert.ok((await platform.get("/api/platform/audit", { expect: 200 })).body.events.length >= 5);
const sweep = await platform.post("/api/platform/sla/sweep", {}, { expect: 200 });
assert.ok(Array.isArray(sweep.body.escalated) && Array.isArray(sweep.body.nudged));

// ---- the edges -----------------------------------------------------------

step("an unknown API path is a JSON 404, and the SPA shell still serves elsewhere");
const missing = await anon.get("/api/nope", { expect: 404 });
assert.equal(missing.body.code, "no_route");
const shell = await anon.get("/some/deep/client/route", { expect: 200 });
assert.match(shell.headers.get("content-type") ?? "", /text\/html/);

step("malformed JSON is a 400, not a stack trace");
const broken = await fetch(`${base}/api/reports/preview`, {
  method: "POST", headers: { "content-type": "application/json" }, body: "{oh no",
});
assert.equal(broken.status, 400);
assert.equal((await broken.json()).code, "bad_json");

step("signing out actually detaches the session");
await admin.post("/api/auth/sign-out", {}, { expect: 200 });
await admin.get("/api/auth/me", { expect: 401 });

await new Promise((resolve) => server.close(resolve));
await container.shutdown();
await fs.rm(dir, { recursive: true, force: true });
console.log(`\n  ${steps.length} steps passed. The API holds.\n`);
