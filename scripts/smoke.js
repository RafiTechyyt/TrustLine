// smoke.js — walks one report through the entire service layer.
//
// Not a unit test: a single narrative pass over the real objects, against a
// throwaway data directory. It exists to prove the wiring holds before the HTTP
// layer is written, and to fail loudly at the exact step that breaks.
//
//   node scripts/smoke.js

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import assert from "node:assert/strict";

import { Container } from "../src/services/index.js";
import { DataStore } from "../src/repositories/index.js";
import { STATUS } from "../src/core/status/states.js";
import { ROLES } from "../src/core/accounts/permissions.js";
import { PRIORITY, VISIBILITY, CONTACT_SHARING } from "../src/core/enums.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trustline-smoke-"));
const steps = [];
const step = (name) => { steps.push(name); process.stdout.write(`  ${String(steps.length).padStart(2)}. ${name}\n`); };

const container = new Container({ db: new DataStore(dir) });
const { owner } = await container.boot({ startClock: false });
const { auth, catalog, complaints, threads, analytics, announcements, sla, colleges } = container.services;

console.log(`\nTrustLine service smoke test\n  data: ${dir}\n`);

// ---- platform owner exists ------------------------------------------------
step("platform owner bootstrapped");
assert.equal(owner.role, ROLES.SUPER_ADMIN);
assert.equal(owner.canRead({}), false, "the platform office must never be able to read a report");

// ---- a college signs itself up --------------------------------------------
step("college registers with its founding admin");
const { college, admin } = await auth.registerCollege({
  name: "College of Engineering Perumon", shortName: "CEP", city: "Kollam",
  university: "APJ Abdul Kalam Technological University",
  adminName: "Dr. Anitha Menon", adminEmail: "admin@cep.ac.in", password: "perumon2026",
});
assert.equal(college.status, "pending");
assert.throws(() => auth.signIn({ email: "admin@cep.ac.in", password: "perumon2026" }), /waiting for approval/);

step("platform approves the college and its admin together");
await auth.reviewCollege(owner, college.id, { decision: "approve", note: "Verified" });
const signedIn = auth.signIn({ email: "admin@cep.ac.in", password: "perumon2026" });
assert.equal(signedIn.account.id, admin.id);
assert.ok(signedIn.college.isLive);

// ---- the admin builds the routing table ----------------------------------
step("admin creates desks and categories, then routes them");
const hostel = await catalog.createDepartment(admin, { name: "Hostel Office", code: "HOSTEL", slaHours: 48 });
const exams = await catalog.createDepartment(admin, { name: "Examination Cell", code: "EXAM" });
const icc = await catalog.createDepartment(admin, { name: "Internal Complaints Committee", code: "ICC", slaHours: 12 });

const water = await catalog.createCategory(admin, {
  name: "Hostel water supply", code: "WATER", keywords: ["water", "tap", "bathroom", "supply"],
  departmentId: hostel.id,
});
await catalog.createCategory(admin, {
  name: "Exam and revaluation", code: "REVAL", keywords: ["exam", "revaluation", "marks"], departmentId: exams.id,
});
const harassment = await catalog.createCategory(admin, {
  name: "Harassment", code: "HARASS", keywords: ["harassment", "ragging"],
  departmentId: icc.id, confidential: true, defaultPriority: PRIORITY.HIGH,
});
assert.equal(catalog.forAdmin(admin).warnings.length, 0, "no unrouted categories or idle desks expected");

step("an unrouted category is hidden from the report form");
const orphan = await catalog.createCategory(admin, { name: "Something else", code: "MISC" });
assert.equal(catalog.forReporters(college.id).some((c) => c.id === orphan.id), false);
await catalog.routeCategory(admin, orphan.id, hostel.id);

// ---- a desk officer -------------------------------------------------------
step("admin adds a desk officer scoped to one desk");
const officer = await auth.createOfficer(admin, {
  name: "Ramesh K", email: "hostel@cep.ac.in", title: "Hostel Warden",
  password: "hostel2026", departmentIds: [hostel.id],
});
assert.deepEqual(officer.departmentIds, [hostel.id]);

// ---- filing ---------------------------------------------------------------
step("preview warns about self-doxxing before anything is written");
const risky = complaints.preview({
  collegeId: college.id, title: "No water in B block since Monday",
  body: "I am Arun, room 214, call me on 9876543210. The taps have been dry for four days.",
});
assert.ok(risky.privacy.findings.length >= 2, "expected a phone number and a name to be flagged");

step("report is filed and auto-routed to the right desk");
const { report: filed, receipt } = await complaints.file({
  collegeId: college.id, reporterKey: "student",
  title: "No water in B block since Monday",
  body: "The taps on the second floor of B block have been dry for four days. Around forty of us are carrying buckets from the ground floor.",
  visibility: VISIBILITY.PUBLIC, wantsPublic: true, passphrase: "bucket",
}, { supportKey: "seed-a" });
assert.equal(filed.departmentId, hostel.id);
assert.equal(filed.categoryId, water.id);
assert.equal(filed.status, STATUS.SUBMITTED);
assert.ok(filed.traceCode.startsWith("TL-"));
assert.equal(receipt.visibility, VISIBILITY.PUBLIC, "the wizard's show-on-feed choice was dropped");
assert.equal(receipt.department, "Hostel Office");
assert.ok(receipt.handle, "the receipt should carry the anonymous handle the desk will see");
const code = filed.traceCode;

step("a parent filing about safety lands on a high-priority floor");
const { report: parentReport } = await complaints.file({
  collegeId: college.id, reporterKey: "parent", categoryId: harassment.id,
  title: "Seniors intimidating first years after hours",
  body: "My daughter says a group of seniors has been stopping first years near the back gate after 9pm and making them do things.",
}, { supportKey: "seed-b" });
assert.equal(parentReport.departmentId, icc.id);
assert.ok(["high", "urgent"].includes(parentReport.priority), `expected a raised floor, got ${parentReport.priority}`);

step("a confidential report never reaches the public feed");
const feed = complaints.feed(college.id, {});
assert.equal(feed.reports.some((r) => r.traceCode === parentReport.traceCode), false);
assert.equal(feed.reports.some((r) => r.traceCode === code), true);

step("duplicate detection surfaces the first report to the second reporter");
const echo = complaints.preview({
  collegeId: college.id, title: "B block taps dry",
  body: "No water in the second floor bathrooms of B block for days now, we are carrying buckets up.",
});
assert.ok(echo.duplicates.length >= 1, "expected the open water report to be suggested");
assert.equal(echo.routing.department, "Hostel Office", "preview should name the desk before anything is filed");

// ---- the reporter side ----------------------------------------------------
step("tracking requires the passphrase that was set at filing");
assert.throws(() => complaints.track(code, "wrong"), /passphrase/);
const tracked = complaints.track(code, "bucket");
assert.equal(tracked.traceCode, code);
assert.equal(tracked.thread.length >= 1, true, "the filing receipt should be in the thread");

step("backing a report counts once per person");
const first = await complaints.support(code, "someone-else");
assert.equal(first.supportCount, 2);
await assert.rejects(() => complaints.support(code, "someone-else"), /already/i);

// ---- the desk side --------------------------------------------------------
step("the officer sees their desk only");
const queue = complaints.deskQueue(officer, {});
assert.equal(queue.reports.every((r) => r.departmentName === "Hostel Office"), true);
assert.equal(queue.reports.some((r) => r.traceCode === parentReport.traceCode), false);
assert.throws(() => complaints.deskOne(officer, parentReport.traceCode), /not on your desk/);

step("desk reply acknowledges the report and claims it");
await threads.replyAsDesk(officer, code, "We have raised this with the water authority and a tanker is booked for tomorrow morning.");
let detail = complaints.deskOne(officer, code);
assert.equal(detail.status, STATUS.TRIAGED);
assert.equal(detail.assignedTo, officer.id);

step("an internal note stays off the reporter's thread");
await threads.note(officer, code, "Pump motor is actually burnt out — this will recur unless it is replaced.");
const reporterThread = threads.forReporter(code, "bucket");
assert.equal(reporterThread.some((m) => m.body.includes("burnt out")), false, "INTERNAL NOTE LEAKED TO REPORTER");
assert.equal(complaints.deskOne(officer, code).thread.some((m) => m.internal), true);

step("asking the reporter a question pauses the SLA clock");
await threads.replyAsDesk(officer, code, "Which floors exactly are dry — is the ground floor working?", { askReporter: true });
detail = complaints.deskOne(officer, code);
assert.equal(detail.status, STATUS.AWAITING_REPORTER);
assert.equal(detail.remainingMs, null, "the clock must not run while waiting on the reporter");

step("the reporter answers and the clock resumes");
await threads.replyAsReporter(code, "bucket", "Ground floor is fine. Second and third are dry.");
detail = complaints.deskOne(officer, code);
assert.equal(detail.status, STATUS.IN_PROGRESS);
assert.notEqual(detail.remainingMs, null);

step("a follow-up is re-scanned: advised for a phone number, blocked for an Aadhaar");
const doxxed = await threads.replyAsReporter(code, "bucket", "I am Arun Kumar, room 214, call me on 9876543210 any time.");
assert.ok(doxxed.privacyFindings.some((f) => f.kind === "phone"), "the follow-up phone number was not flagged");
assert.ok(doxxed.privacyFindings.some((f) => f.kind === "self_named"), "the follow-up name was not flagged");
assert.ok(
  doxxed.privacyFindings.every((f) => !f.sample.includes("9876543210")),
  "the scanner echoed the leak back unmasked",
);
await assert.rejects(
  () => threads.replyAsReporter(code, "bucket", "My Aadhaar is 4321 8765 2109 if you need to verify me."),
  /identity number/i,
);

step("optional identity reveal is scoped to the desk that asked");
await complaints.shareContact(code, "bucket", { sharing: CONTACT_SHARING.DEPARTMENT, channel: "phone", value: "9876500000" });
assert.equal(complaints.deskOne(officer, code).contact?.value, "9876500000");
assert.equal(complaints.publicOne(code).contact, undefined, "contact must never appear on the public view");

// ---- admin powers ---------------------------------------------------------
step("admin reroutes, and the new desk gets a fresh window");
const adminDetail = complaints.deskOne(admin, code);
assert.ok(adminDetail.desks.length >= 3, "an admin should see every desk as a routing target");
await complaints.reroute(admin, code, { departmentId: exams.id, reason: "misfiled on purpose, to test" });
assert.equal(complaints.deskOne(admin, code).departmentId, exams.id);
await complaints.reroute(admin, code, { departmentId: hostel.id, reason: "back where it belongs" });

step("priority can be raised but never pushed under the report's floor");
await assert.rejects(
  () => complaints.prioritise(admin, parentReport.traceCode, PRIORITY.LOW),
  /cannot go below|held at/i,
);
await complaints.prioritise(admin, parentReport.traceCode, PRIORITY.URGENT, "Safety report, no movement yet.");
assert.equal(complaints.deskOne(admin, parentReport.traceCode).priority, PRIORITY.URGENT);
await complaints.prioritise(admin, code, PRIORITY.LOW, "Water is back, leaving the pump follow-up open.");
assert.equal(complaints.deskOne(admin, code).priority, PRIORITY.LOW, "a student report has no floor to stop it");

step("merging folds the duplicate's backing into the survivor");
const { report: dup } = await complaints.file({
  collegeId: college.id, reporterKey: "student", categoryId: water.id,
  title: "B block bathrooms have no water",
  body: "Second floor B block bathrooms are completely dry, this has been going on for most of the week now.",
  wantsPublic: true,
}, { supportKey: "seed-c" });
await complaints.support(dup.traceCode, "backer-x");
const merged = await complaints.merge(admin, dup.traceCode, code);
assert.equal(merged.absorbed, dup.traceCode);
assert.ok(complaints.deskOne(admin, code).supportCount >= 3);
assert.equal(complaints.feed(college.id, {}).reports.some((r) => r.traceCode === dup.traceCode), false);

step("escalation is recorded with a reason");
await complaints.escalate(admin, parentReport.traceCode, "No movement in twelve hours on a safety report.");
assert.equal(complaints.deskOne(admin, parentReport.traceCode).escalated, true);

// ---- closing the loop ----------------------------------------------------
step("resolve, rate, reopen");
await complaints.changeStatus(officer, code, {
  status: STATUS.RESOLVED, note: "Tanker delivered and the pump motor was replaced on Thursday.",
});
assert.equal(complaints.deskOne(officer, code).status, STATUS.RESOLVED);
await complaints.rate(code, "bucket", { score: 4, note: "Took a while but it is fixed." });
assert.equal(complaints.track(code, "bucket").satisfaction, 4);
await complaints.reopen(code, "bucket", "It went dry again on Sunday.");
assert.equal(complaints.deskOne(officer, code).status, STATUS.IN_PROGRESS);

step("the SLA sweep is safe to run twice");
const sweepA = await sla.sweep();
const sweepB = await sla.sweep();
assert.deepEqual(
  { e: sweepB.escalated.length, c: sweepB.closed.length, n: sweepB.nudged.length },
  { e: 0, c: 0, n: 0 },
  `a second sweep must be a no-op, got ${JSON.stringify(sweepB)} after ${JSON.stringify(sweepA)}`,
);
assert.ok(sla.health(college.id).open >= 1);

// ---- reads --------------------------------------------------------------
step("college analytics add up to what the account can see");
const deskNumbers = analytics.forCollege(officer);
assert.equal(deskNumbers.headline.total, complaints.deskQueue(officer, {}).total);
const adminNumbers = analytics.forCollege(admin);
assert.ok(adminNumbers.headline.total > deskNumbers.headline.total);
assert.ok(adminNumbers.routing.length >= 1, "routing mix should name the strategy that placed each report");
assert.equal(adminNumbers.daily.length, 30);

step("the public transparency page excludes confidential categories");
const scoreboard = analytics.transparency(college.id);
assert.equal(scoreboard.categories.some((c) => c.name === "Harassment"), false);
assert.ok(scoreboard.totals.filed >= 1);

step("the platform console sees counts, never content");
const platform = analytics.platform(owner);
assert.equal(platform.colleges.active, 1);
assert.ok(platform.reports.total >= 3);
assert.equal(JSON.stringify(platform).includes("B block"), false, "PLATFORM VIEW LEAKED REPORT CONTENT");
assert.throws(() => complaints.deskOne(owner, code), /not on your desk/);

step("announcements can only cite public reports of the same college");
const digest = announcements.draftDigest(admin);
const posted = await announcements.post(admin, {
  title: "What we fixed in the hostels this month",
  body: digest.body || "The B block pump motor has been replaced and the water supply is back to normal on every floor.",
  linkedTraceCodes: [code, parentReport.traceCode, "TL-XXXX-XXXX"],
});
assert.deepEqual(posted.linkedTraceCodes, [code], "only the public report should have survived the citation filter");

step("college settings are per-tenant and a PATCH does not blank the rest");
await colleges.updateSettings(admin, { publicFeed: false });
assert.equal(colleges.profile(admin).settings.publicFeed, false);
assert.equal(colleges.profile(admin).settings.defaultSlaHours, 72);
await colleges.updateProfile(admin, { motto: "ignored here" });
assert.equal(colleges.profile(admin).city, "Kollam", "updateProfile blanked a field it was not given");
await colleges.updateSettings(admin, { publicFeed: true });

step("observers ran without any service knowing they exist");
const status = container.status();
assert.ok(status.events.total >= 20, `expected a busy event log, got ${status.events.total}`);
assert.ok(container.db.audit.ofCollege(college.id).length >= 10);
const reporterRows = container.db.audit.ofComplaint(code).filter((r) => r.action === "report.filed");
assert.equal(reporterRows.every((r) => r.view().actorLabel === "TrustLine"), true, "a reporter action was logged with an actor");

step("everything survives a restart from disk");
await container.shutdown();
const reloaded = new Container({ db: new DataStore(dir) });
await reloaded.boot({ startClock: false });
const rehydrated = reloaded.services.complaints.track(code, "bucket");
assert.equal(rehydrated.traceCode, code);
assert.equal(rehydrated.status, STATUS.IN_PROGRESS);
assert.equal(reloaded.services.analytics.platform(owner).reports.total, platform.reports.total);
await reloaded.shutdown();

await fs.rm(dir, { recursive: true, force: true });
console.log(`\n  ${steps.length} steps passed. Service layer is sound.\n`);
