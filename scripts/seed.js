// seed.js — builds the campus TrustLine gets demonstrated on.
//
// Nothing in here is faked into place. Both colleges register themselves and are
// approved by the platform office, every desk and category is created by a college
// admin, every report goes in through ComplaintService and is worked through
// ThreadService, and every status move is one the state machine agreed to. There
// is no hand-written JSON anywhere in this file, which is the point: what comes
// out of here is data the running product could have produced itself.
//
// It rebuilds the data directory from nothing, so whatever was in there is gone.
// That is what a seed is for, but it deserves saying out loud.
//
//   node scripts/seed.js
//   TRUSTLINE_DATA_DIR=/tmp/demo node scripts/seed.js

import fs from "node:fs/promises";
import path from "node:path";

import { Container } from "../src/services/index.js";
import { DataStore } from "../src/repositories/index.js";
import { config } from "../src/config.js";
import { STATUS } from "../src/core/status/states.js";
import { PRIORITY, CONTACT_SHARING } from "../src/core/enums.js";
import { ACCOUNT_STATUS } from "../src/core/accounts/permissions.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Every timestamp below is an offset from one instant, so a report that is three
// days old stays three days old however long the script takes to run.
const NOW = Date.now();

const steps = [];
const step = (name) => {
  steps.push(name);
  process.stdout.write(`  ${String(steps.length).padStart(2)}. ${name}\n`);
};

/**
 * Rewrites the stored fields that have no setter, by taking the row an entity
 * would have been saved as, changing it, and hydrating it back.
 *
 * This is not a way around encapsulation — it *is* the persistence round trip.
 * Every repository does this on boot: `toJSON()` out, `hydrate()` in. Seeding
 * needs it because `createdAt` is private with no setter, correctly so: nothing
 * in the running product may move a report's age. But demo data filed today and
 * demo data filed over ninety days are the difference between a transparency
 * page with a median on it and an empty one, so the seed files each report for
 * real and then rebases its timeline through the same round trip.
 */
const rebase = (repo, entity, patch) => repo.save(repo.hydrate({ ...entity.toJSON(), ...patch }));

/** Empties the data directory but keeps .gitkeep, which git tracks so a clone boots. */
async function wipe(dir) {
  await fs.mkdir(dir, { recursive: true });
  for (const entry of await fs.readdir(dir)) {
    if (entry === ".gitkeep") continue;
    await fs.rm(path.join(dir, entry), { recursive: true, force: true });
  }
}

// ---- college one: the one this was written for -------------------------------
//
// Eight desks and twelve categories, because that is roughly what a real KTU
// college's grievance structure looks like once you write it down. The glyph on
// each category has to be a name the icon map in public/assets/ui.js knows.

const CEP = {
  slug: "cep",
  note: "Checked against the KTU affiliation list and the principal's office address.",
  motto: "Every complaint gets a desk, a name and a deadline.",
  settings: { defaultSlaHours: 48, autoCloseAfterDays: 10 },
  registration: {
    name: "College of Engineering Perumon",
    shortName: "CEP",
    city: "Kollam",
    state: "Kerala",
    university: "APJ Abdul Kalam Technological University",
    emailDomain: "cep.ac.in",
    contactEmail: "principal@cep.ac.in",
    adminName: "Dr. Anitha Menon",
    adminEmail: "anitha.menon@cep.ac.in",
    adminTitle: "Grievance Redressal Officer",
    password: "perumon-admin-2026",
  },
  desks: [
    { code: "ACAD", name: "Academics & Examinations", headName: "Dr. Jayasree Nair", slaHours: 72,
      description: "Results, revaluation, internal marks and anything the university end of the office handles." },
    { code: "HOSTEL", name: "Hostel & Mess", headName: "Ramesh Pillai", slaHours: 24,
      description: "Both hostels, the mess contract and the warden roster." },
    { code: "INFRA", name: "Campus Infrastructure", headName: "Sujith Kumar", slaHours: 48,
      description: "Buildings, water lines, lighting, furniture and the workshop sheds." },
    { code: "IT", name: "IT & Network", headName: "Vinod Chandran", slaHours: 36,
      description: "Campus WiFi, the labs' machines, the student portal and printing." },
    { code: "LIB", name: "Library", headName: "Bindu Raveendran", slaHours: 96,
      description: "Lending, reading room, journals and the digital subscriptions." },
    { code: "TRANS", name: "Transport", headName: "Sujith Kumar", slaHours: 48,
      description: "The four college buses, their routes and their timings." },
    { code: "ICC", name: "Internal Complaints Cell", headName: "Dr. Anitha Menon", slaHours: 8,
      description: "Ragging, harassment and discrimination. Handled by the cell alone." },
    { code: "FEES", name: "Scholarships & Fees", headName: "Dr. Jayasree Nair", slaHours: 120,
      description: "e-Grantz, fee refunds, caution deposits and hostel dues." },
  ],
  categories: [
    { code: "REVAL", name: "Exams & revaluation", desk: "ACAD", glyph: "file", slaHours: 96,
      description: "Results, revaluation, missing internal marks, supplementary exams.",
      keywords: ["revaluation", "revalue", "result", "mark list", "marklist", "answer script", "supplementary", "internal marks", "grade card", "exam cell"] },
    { code: "MESS", name: "Mess & food quality", desk: "HOSTEL", glyph: "layers", slaHours: 24,
      description: "The mess menu, the kitchen, the canteen and anything served in them.",
      keywords: ["mess", "food", "breakfast", "dinner", "curry", "canteen", "kitchen", "menu", "cook"] },
    { code: "WATER", name: "Water supply", desk: "HOSTEL", glyph: "refresh", slaHours: 12,
      defaultPriority: PRIORITY.HIGH, description: "Taps, tanks, pumps and bathrooms running dry.",
      keywords: ["water", "tap", "motor", "tank", "bathroom", "overhead", "pump", "plumbing"] },
    { code: "ROOMS", name: "Hostel rooms & wardens", desk: "HOSTEL", glyph: "home", slaHours: 48,
      audiences: ["student", "parent"], description: "Rooms, furniture, the warden roster and hostel rules.",
      keywords: ["hostel", "room", "warden", "bunk", "mattress", "fan", "roommate", "curfew"] },
    { code: "LABS", name: "Labs & equipment", desk: "INFRA", glyph: "desk", slaHours: 72,
      description: "Lab machines, instruments, workshop tools and lab furniture.",
      keywords: ["lab", "equipment", "oscilloscope", "apparatus", "workshop", "bench", "microscope", "machine"] },
    { code: "LIGHT", name: "Lighting & campus paths", desk: "INFRA", glyph: "spark", slaHours: 24,
      defaultPriority: PRIORITY.HIGH, description: "Lights, walkways, the back gate and getting across campus after dark.",
      keywords: ["light", "lamp", "dark", "path", "bulb", "gate", "walkway"] },
    { code: "ACCESS", name: "Accessibility", desk: "INFRA", glyph: "up", slaHours: 72,
      description: "Ramps, railings, lifts and anything that makes a building unusable for someone.",
      keywords: ["ramp", "wheelchair", "lift", "railing", "accessible", "crutches"] },
    { code: "WIFI", name: "Network & WiFi", desk: "IT", glyph: "route", slaHours: 36,
      description: "Campus WiFi, the student portal, lab machines and printing.",
      keywords: ["wifi", "internet", "network", "portal", "login", "bandwidth", "router", "printer"] },
    { code: "BOOKS", name: "Library", desk: "LIB", glyph: "copy", slaHours: 96,
      defaultPriority: PRIORITY.LOW, description: "Lending, the reading room, journals and online subscriptions.",
      keywords: ["library", "book", "journal", "reading room", "ieee", "renewal", "catalogue"] },
    { code: "BUS", name: "College bus & transport", desk: "TRANS", glyph: "arrow", slaHours: 48,
      description: "Bus routes, timings, crowding and the drivers.",
      keywords: ["bus", "bus route", "driver", "timing", "bus stop", "conductor", "overcrowd"] },
    { code: "GRIEV", name: "Ragging & harassment", desk: "ICC", glyph: "lock", slaHours: 8,
      confidential: true, defaultPriority: PRIORITY.URGENT,
      description: "Ragging, harassment, discrimination. Never public, and only the cell can read it.",
      keywords: ["ragging", "harassment", "molest", "casteist", "discriminat", "intimidat", "threatened", "stalking", "abuse"] },
    { code: "SCHOL", name: "Scholarships & fee refunds", desk: "FEES", glyph: "tag", slaHours: 120,
      requireEvidence: true, description: "e-Grantz, refunds, caution deposits. Say what paperwork you can show.",
      keywords: ["scholarship", "e-grantz", "egrantz", "refund", "caution deposit", "fees", "fee refund", "stipend", "dues", "sanction"] },
  ],
  // The Internal Complaints Cell is deliberately not given an officer: at CEP the
  // grievance officer works it herself, which is also what the UGC rules expect.
  officers: [
    { name: "Ramesh Pillai", email: "ramesh.pillai@cep.ac.in", title: "Hostel Superintendent",
      password: "hostel-desk-2026", desks: ["HOSTEL"] },
    { name: "Sujith Kumar", email: "sujith.kumar@cep.ac.in", title: "Assistant Engineer, Estates",
      password: "estates-desk-2026", desks: ["INFRA", "TRANS"] },
    { name: "Vinod Chandran", email: "vinod.chandran@cep.ac.in", title: "Systems Administrator",
      password: "network-desk-2026", desks: ["IT", "LIB"] },
    { name: "Dr. Jayasree Nair", email: "jayasree.nair@cep.ac.in", title: "Exam Cell Officer",
      password: "examcell-desk-2026", desks: ["ACAD", "FEES"] },
    // Created and then put back to pending. The approvals screen needs a row, and
    // an officer waiting on the admin is the honest thing to put in it.
    { name: "Sreelakshmi Raveendran", email: "sreelakshmi.r@cep.ac.in", title: "Assistant Librarian",
      password: "library-desk-2026", desks: ["LIB"], pending: true },
  ],
};

// ---- college two: smaller, and set up differently on purpose ------------------
//
// GECB exists so the demo has a second tenant with its own desks, its own routing
// table and its own switches — visitor reports are off here, which is the kind of
// per-college decision multi-tenancy is for.

const GECB = {
  slug: "gecb",
  note: "Government college, verified through the Directorate of Technical Education.",
  motto: "Say it once. We will tell you where it went.",
  settings: { allowVisitorReports: false, defaultSlaHours: 72 },
  registration: {
    name: "Government Engineering College Barton Hill",
    shortName: "GECB",
    city: "Thiruvananthapuram",
    state: "Kerala",
    university: "APJ Abdul Kalam Technological University",
    emailDomain: "gecbh.ac.in",
    contactEmail: "office@gecbh.ac.in",
    adminName: "Dr. Suresh Babu",
    adminEmail: "suresh.babu@gecbh.ac.in",
    adminTitle: "Principal",
    password: "bartonhill-admin-2026",
  },
  desks: [
    { code: "ACAD", name: "Academics & Examinations", headName: "Dr. Leena George", slaHours: 72,
      description: "Results, revaluation and the exam cell." },
    { code: "HOSTEL", name: "Hostel & Mess", headName: "Deepa Rajan", slaHours: 24,
      description: "Both hostels and the mess." },
    { code: "INFRA", name: "Campus Maintenance", headName: "Anil Varghese", slaHours: 48,
      description: "Buildings, water, electrical and the grounds." },
    { code: "IT", name: "Computing & Network", headName: "Fathima Beevi", slaHours: 36,
      description: "Network, labs and the portal." },
    { code: "ICC", name: "Internal Complaints Cell", headName: "Dr. Suresh Babu", slaHours: 8,
      description: "Ragging and harassment. Confidential." },
    { code: "FEES", name: "Fees & Scholarships", headName: "Deepa Rajan", slaHours: 120,
      description: "e-Grantz, refunds and hostel dues." },
  ],
  categories: [
    { code: "REVAL", name: "Exams & revaluation", desk: "ACAD", glyph: "file", slaHours: 96,
      description: "Results, revaluation and internal marks.",
      keywords: ["revaluation", "result", "mark list", "answer script", "supplementary", "internal marks", "exam cell"] },
    { code: "MESS", name: "Mess & food quality", desk: "HOSTEL", glyph: "layers", slaHours: 24,
      description: "The mess, the kitchen and the canteen.",
      keywords: ["mess", "food", "breakfast", "dinner", "canteen", "kitchen", "menu"] },
    { code: "WATER", name: "Water supply", desk: "HOSTEL", glyph: "refresh", slaHours: 12,
      defaultPriority: PRIORITY.HIGH, description: "Taps, tanks and bathrooms.",
      keywords: ["water", "tap", "motor", "tank", "bathroom", "pump"] },
    { code: "LABS", name: "Labs & equipment", desk: "INFRA", glyph: "desk", slaHours: 72,
      description: "Lab machines, instruments and furniture.",
      keywords: ["lab", "equipment", "apparatus", "workshop", "bench", "machine"] },
    { code: "LIGHT", name: "Lighting & campus paths", desk: "INFRA", glyph: "spark", slaHours: 24,
      defaultPriority: PRIORITY.HIGH, description: "Lights, walkways and the gates.",
      keywords: ["light", "lamp", "dark", "path", "bulb", "gate"] },
    { code: "WIFI", name: "Network & WiFi", desk: "IT", glyph: "route", slaHours: 36,
      description: "Network, portal and printing.",
      keywords: ["wifi", "internet", "network", "portal", "login", "printer"] },
    { code: "GRIEV", name: "Ragging & harassment", desk: "ICC", glyph: "lock", slaHours: 8,
      confidential: true, defaultPriority: PRIORITY.URGENT,
      description: "Ragging, harassment, discrimination. Never public.",
      keywords: ["ragging", "harassment", "molest", "casteist", "discriminat", "intimidat", "threatened", "abuse"] },
    { code: "SCHOL", name: "Scholarships & fee refunds", desk: "FEES", glyph: "tag", slaHours: 120,
      requireEvidence: true, description: "e-Grantz, refunds and deposits. Say what you can show.",
      keywords: ["scholarship", "e-grantz", "refund", "caution deposit", "fees", "stipend", "dues"] },
  ],
  officers: [
    { name: "Deepa Rajan", email: "deepa.rajan@gecbh.ac.in", title: "Hostel Matron",
      password: "hostel-tvm-2026", desks: ["HOSTEL", "FEES"] },
    { name: "Anil Varghese", email: "anil.varghese@gecbh.ac.in", title: "Maintenance Engineer",
      password: "estates-tvm-2026", desks: ["INFRA"] },
    { name: "Fathima Beevi", email: "fathima.beevi@gecbh.ac.in", title: "Lab & Network In-charge",
      password: "network-tvm-2026", desks: ["IT", "ACAD"] },
  ],
};

// ---- college three: the one still in the queue ---------------------------------
//
// Registered and never reviewed, because a review queue with nothing in it proves
// nothing. Nothing else in the demo touches SNIT: a pending college cannot take
// reports at all, and being able to show that refusal is worth more than a third
// set of desks.

const SNIT = {
  registration: {
    name: "Sree Narayana Institute of Technology",
    shortName: "SNIT",
    city: "Adoor",
    state: "Kerala",
    university: "APJ Abdul Kalam Technological University",
    emailDomain: "snitadoor.ac.in",
    contactEmail: "office@snitadoor.ac.in",
    adminName: "Bency Thomas",
    adminEmail: "bency.thomas@snitadoor.ac.in",
    adminTitle: "Academic Coordinator",
    password: "adoor-admin-2026",
  },
};

// ---- a random source that answers the same way every run -----------------------
//
// The numbers on the transparency page, the order of the queue and the wording of
// a thread should not move because someone re-seeded. mulberry32 with a fixed
// constant is enough for choosing between fixtures and, unlike Math.random, can be
// reasoned about after the fact.
//
// Trace codes, reporter handles and entity ids stay genuinely random: those come
// out of node:crypto inside the domain layer, where a guessable trace code would
// be a hole rather than a convenience. So ids differ between runs; everything the
// demo is judged on does not.

let prngState = 0x5eed1e;
const rand = () => {
  prngState = (prngState + 0x6d2b79f5) | 0;
  let t = prngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// ---- what people actually filed ------------------------------------------------
//
// One object per report, grouped by where it ended up so the shape of the campus
// is readable here rather than only in the output.
//
//   cat     category code, or omitted to let the router match on wording — a
//           handful are left off on purpose so the routing mix on the analytics
//           page is not one solid bar
//   who     reporter kind; defaults to student
//   pub     goes on the public feed; defaults to true
//   days    how long ago it was filed
//   hrs     how long the desk took, read only for resolved and closed reports
//   pause   hours the clock spent stopped waiting on the reporter
//   due     hours left on the clock right now, read only for open reports;
//           negative means late
//   back    how many people backed it after the reporter
//   esc     went up to the admin on the way through
//   talk    the thread: d = desk reply, q = desk question, r = reporter reply,
//           n = internal note
//
// `days`, `hrs` and `due` are chosen rather than rolled. They are what become the
// median on the transparency page, the on-time rate per desk and the overdue count
// on the dashboard, and a demo whose numbers are noise is a demo of nothing. See
// `applyTimeline` for how they are put on the record.
//
// Deliberately absent outside the ICC reports: any word from
// SafetyNetStrategy.WORDS. Those route to the grievance cell whatever category was
// picked, which is right, and would quietly empty every other desk here.

const CEP_REPORTS = [
  // -- closed, and old enough to be what the median is built out of --------------
  { cat: "WATER", days: 34, hrs: 8, back: 27, status: "closed", pass: "block-c-taps",
    loc: "Men's Hostel, Block C", tags: ["hostel", "water"], occ: 36,
    rate: [4, "Took a day, but the pump was actually replaced and not just looked at."],
    title: "No water in the Block C bathrooms after 7am",
    body: "From about 7 in the morning the taps on the second and third floor of Block C give nothing. It comes back around 11. Roughly forty of us are getting ready inside that window and there are two working taps on the ground floor for all of them.",
    talk: [
      ["n", "Pump 2 has been tripping on overload since the monsoon. Estates already has the quote from last month, so this is a purchase order problem, not a plumbing one."],
      ["d", "The plumber checked it this morning. The second pump cuts out on overload, so the tank never fills before the morning rush. A replacement is being fitted tomorrow."],
      ["r", "Thanks. Is there some way to know when it is done, so we are not testing taps at 7am to find out?"],
      ["d", "The warden will put a note on the Block C board once the tank is filling normally. Fitted and tested today. Tell us here if it drops again."],
    ] },

  { cat: "MESS", days: 61, hrs: 3, back: 12, status: "closed", who: "student",
    loc: "Hostel mess", tags: ["mess"], occ: 62,
    title: "Tuesday breakfast idli was served half cooked",
    body: "The idli at breakfast on Tuesday was raw in the middle. Three of us put it back. The cook said the steamer was started late because the gas cylinder was changed that morning.",
    talk: [
      ["d", "Confirmed with the mess supervisor. The cylinder change pushed the steaming by twenty minutes and the first two trays went out anyway. The supervisor has been told to hold the counter rather than serve early."],
    ] },
  { cat: "WIFI", days: 46, hrs: 5, back: 19, status: "closed", who: "scholar",
    loc: "Library reading room", tags: ["wifi", "library"], occ: 47,
    rate: [5, "Answered the same evening and the access point was actually moved."],
    title: "Campus wifi drops every few minutes in the reading room",
    body: "Sitting in the reading room the wifi disconnects roughly every four or five minutes and takes a while to come back. It is fine in the corridor outside, which suggests the access point is on the wrong side of the wall.",
    talk: [
      ["n", "The AP for that wing is mounted behind the stack shelves. Signal is being eaten by the metal racks."],
      ["d", "You were right about the wall. The access point was behind the metal stacks, so the racks were absorbing most of it. It has been moved to the reading room side of the partition and the drop is gone on our test."],
    ] },
  { cat: "LIGHT", days: 52, hrs: 18, back: 34, status: "closed", who: "parent",
    loc: "Back gate to ladies hostel path", tags: ["lighting", "campus"], occ: 55,
    rate: [4, "Lights are on now. Would rather it had not needed thirty people to say it."],
    title: "The path from the back gate to the ladies hostel is completely dark",
    body: "My daughter walks that stretch after the evening lab and there is no working light between the back gate and the hostel turning. There is one pole halfway and its lamp has been out for weeks. Several girls walk it together because of that.",
    talk: [
      ["d", "Two poles on that stretch had failed lamps and one had a broken fitting. All three are replaced and the timer for that line has been moved to 6pm so they come on before the labs finish."],
      ["r", "Checked yesterday evening, all three are lit. Thank you for actually going and looking."],
    ] },

  { cat: "LABS", days: 71, hrs: 44, back: 8, status: "closed", who: "faculty",
    loc: "CS Lab 2", tags: ["lab", "computers"], occ: 73,
    title: "Four machines in CS Lab 2 will not switch on",
    body: "Benches 11, 12, 17 and 18 do not power up at all. With sixty students in a batch and fifty-six working machines the practical runs two to a seat, which does not work for a coding exam.",
    talk: [
      ["n", "Two are SMPS, one is a loose front panel connector. The fourth may be the board."],
      ["d", "Three are back up: two power supplies replaced and one had a disconnected front panel switch. Bench 18 has a dead motherboard and is being sent out, so the lab is at fifty-nine until it returns."],
    ] },
  { cat: "REVAL", days: 77, hrs: 168, back: 23, status: "closed", esc: true,
    loc: "Exam cell", tags: ["exams", "revaluation"], occ: 100,
    rate: [2, "Got the result in the end but nobody told us anything for a week."],
    title: "S5 electronics revaluation result has not come out",
    body: "Twelve of us applied for revaluation of the S5 analog electronics paper. The university published revaluation results for other colleges three weeks ago. The exam cell says it has not received the list. Nobody can tell us who to ask next.",
    talk: [
      ["d", "The university had not released this college's list on the portal when you filed. We have written to the CE office asking for a status."],
      ["r", "It has been another five days. Is there anything we can do from our side, or do we just wait?"],
      ["n", "CE office says the list was stuck behind a fee reconciliation for this centre. Escalating to the principal's office to get it moved."],
      ["d", "The list came through. Nine of the twelve papers were revised upward and the revised marks are on the portal now. The delay was at the university end, but a week of silence from us was not acceptable and the exam cell will now write to applicants every Friday while a revaluation is pending."],
    ] },

  { cat: "REVAL", days: 84, hrs: 210, back: 15, status: "closed", pause: 26,
    loc: "Student portal", tags: ["exams", "internal marks"], occ: 90,
    rate: [3, "Fixed correctly. Nine days for a data entry error is a long time."],
    title: "Internal marks for S3 mathematics are missing from the portal",
    body: "The portal shows internal marks for every S3 subject except mathematics, which is blank for the whole class. The subject teacher says the marks were submitted before the deadline.",
    talk: [
      ["q", "Could you confirm which division you are in? The upload for one of the two S3 divisions went through and the other did not, and we need to know which one to chase."],
      ["r", "S3 division B, the one that has maths in the second hour."],
      ["d", "Division B's sheet had been saved but not submitted, so it never reached the university side. The exam cell has re-uploaded it and the marks are showing now."],
    ] },
  { cat: "BOOKS", days: 66, hrs: 14, back: 6, status: "closed", who: "student",
    loc: "Library", tags: ["library"], occ: 68,
    title: "Reading room shuts at five during study leave",
    body: "During study leave the reading room closes at five like a normal working day, which is the only time most of us can actually use it. The hostel study rooms have four tables between two blocks.",
    talk: [
      ["d", "The librarian has agreed to keep the reading room open till 9pm on study leave days, with one attendant on duty. It starts from this Monday and will be reviewed after the exam."],
    ] },
  { cat: "SCHOL", days: 58, hrs: 96, back: 11, status: "closed", who: "student",
    loc: "Accounts section", tags: ["scholarship", "e-grantz"], occ: 75,
    ev: ["e-Grantz application acknowledgement slip", "Bank passbook first page"],
    rate: [4, "The accounts section explained where it was stuck, which was all I wanted."],
    title: "e-Grantz amount for last semester has not been credited",
    body: "My e-Grantz sanction shows as approved on the portal but nothing has come into the account. Three others in my class from the same category are in the same position. The accounts section told us to check with the department office and the department office sent us back.",
    talk: [
      ["n", "These four are in the batch that was sent in the second instalment file. That file was rejected once for an IFSC mismatch."],
      ["d", "Your four names were in an instalment file the treasury rejected over a bank code mismatch, so it was never a sanction problem. The file has been corrected and resubmitted. Credit normally follows in two to three weeks from resubmission."],
      ["r", "Received it this week. Thanks for finding out where it actually was."],
    ] },

  { cat: "BUS", days: 43, hrs: 26, back: 21, status: "closed", who: "student",
    loc: "Kottarakkara route", tags: ["bus", "transport"], occ: 44,
    rate: [3, "Sorted, though the driver was not happy about it."],
    title: "The 4.30 bus on the Kottarakkara route leaves before time",
    body: "The Kottarakkara bus is scheduled at 4.30 but has been pulling out around 4.20 for the last two weeks. Anyone whose last hour ends at 4.15 has to run for it and a few have missed it outright.",
    talk: [
      ["d", "Spoke to the driver and the transport clerk. The bus was leaving early to get ahead of the level crossing. The timing board stays at 4.30 and the driver has been told to hold until then. Please file again if it happens next week."],
    ] },

  // -- resolved but not closed yet, so the reopen window is visible --------------
  //
  // Every resolvedAt below is inside the last seven days on purpose:
  // SlaService closes a resolved report after config.sla.autoCloseHours, so an
  // older one would vanish from this group the first time the clock ticks.
  { cat: "WATER", days: 6, hrs: 11, back: 14, status: "resolved", pass: "tank-motor",
    loc: "Ladies Hostel overhead tank", tags: ["hostel", "water"], occ: 7,
    title: "The overhead tank motor trips every evening around seven",
    body: "The motor for the ladies hostel tank cuts out most evenings and someone has to go and reset it at the panel. By then the second floor has no water for an hour.",
    talk: [
      ["d", "The starter relay is worn and is being replaced this week. Until then the panel has been left accessible to the hostel staff so it can be reset without waiting for the electrician."],
      ["r", "It has not tripped for two days now."],
    ] },
  { cat: "MESS", days: 5, hrs: 22, back: 31, status: "resolved", who: "student",
    loc: "Hostel mess, dinner counter", tags: ["mess", "hygiene"], occ: 6,
    rate: [4, "Kitchen looked different when we went back. Good."],
    title: "There was a cockroach in Thursday night's curry",
    body: "One of the serving vessels at dinner on Thursday had a cockroach in it. The counter was closed after we pointed it out but the same vessels went back out the next morning. The area behind the wash counter is where they are coming from.",
    talk: [
      ["n", "Pest control contract lapsed in June and was not renewed. This is the second mess complaint this month."],
      ["d", "The counter was shut and the batch discarded. Pest control had lapsed and has been renewed with a monthly visit, first one done on Saturday. The mess committee has also been asked to inspect the wash area weekly with a student member present."],
    ] },

  { cat: "LIGHT", days: 4, hrs: 30, back: 9, status: "resolved", who: "staff",
    loc: "Workshop road", tags: ["lighting"], occ: 5,
    title: "Two of the four lamps on the workshop road are out",
    body: "The stretch between the workshop shed and the main block has four poles and two of them are dark. The security round at ten goes past there and it is the part of campus with the least footfall.",
    talk: [
      ["d", "Both lamps replaced. The line to the third pole also needed a new fuse, which is likely why it kept failing after the last replacement."],
    ] },
  { cat: "WIFI", days: 3, hrs: 34, back: 17, status: "resolved", who: "student",
    loc: "Library desktops", tags: ["printing", "library"], occ: 4,
    title: "Printing from the library desktops fails halfway through",
    body: "Print jobs from the library machines stop after two or three pages and the queue then refuses anything else until someone restarts the printer. It has been like this for about ten days and it is the only place we can print a project report.",
    talk: [
      ["n", "Spooler on the print server is filling up. Disk is at 96 percent."],
      ["d", "The print server had run out of disk, so the spool was filling and jamming the queue. Cleared it and put a weekly cleanup in place. Please try a long job and tell us if it still stops."],
      ["r", "Printed a thirty page report this morning with no problem."],
    ] },
  { cat: "LABS", days: 5, hrs: 60, back: 5, status: "resolved", who: "scholar",
    loc: "Electronics Lab, bench 6", tags: ["lab", "equipment"], occ: 8,
    title: "The oscilloscope on bench 6 shows no trace on either channel",
    body: "Bench 6 scope gives a flat line on both channels with a known signal in. The probes test fine on the next bench, so it is the instrument. Two project groups are sharing bench 5 because of it.",
    talk: [
      ["d", "The scope has been sent to the service centre in Kollam. Estimated ten days. In the meantime the spare from the communication lab has been moved to bench 6 so both project groups can work."],
    ] },

  { cat: "REVAL", days: 8, hrs: 132, back: 26, status: "resolved", pass: "hall-ticket",
    loc: "Exam cell", tags: ["exams", "supplementary"], occ: 10,
    rate: [3, "Corrected in time, but two days before the exam is cutting it fine."],
    title: "Supplementary hall ticket has the wrong subject code on it",
    body: "The hall ticket for my supplementary exam lists a subject code I never registered for, and the paper I actually registered for is not on it. Four others have the same swap. The exam is in nine days.",
    talk: [
      ["d", "We can see the mismatch. It looks like the registration file for the supplementary batch was mapped against the wrong scheme year. The exam cell is raising it with the university today."],
      ["r", "Is there a chance we will not be allowed to sit the paper because of this?"],
      ["d", "No. Corrected hall tickets are on the portal now with the right code, and the exam cell has the university's mail confirming it in case a hall invigilator asks."],
    ] },
  { cat: "REVAL", days: 10, hrs: 190, back: 18, status: "resolved", esc: true, pause: 18,
    loc: "Exam cell", tags: ["exams", "grade card"], occ: 14,
    title: "S6 grade card still shows one paper as pending",
    body: "My S6 grade card shows the microprocessors paper as pending even though the result was published two months ago. I need a complete grade card for a placement form and the exam cell says it can only print what the portal shows.",
    talk: [
      ["q", "Do you have the result notification number from when that paper was published? It will let us point the university at the exact entry."],
      ["r", "Yes, it was in the second result notification for S6, published in July."],
      ["n", "This is the third grade card mismatch from that notification. Worth asking the CE office whether the whole batch is affected rather than one student at a time."],
      ["d", "The university has updated the entry and the grade card now prints complete. Seven other students from the same notification had the same gap and have been corrected together."],
    ] },
  { cat: "SCHOL", days: 9, hrs: 140, back: 7, status: "resolved", who: "parent",
    loc: "Accounts section", tags: ["fees", "refund"], occ: 40,
    ev: ["Caution deposit receipt from first year", "Hostel vacating clearance form"],
    title: "Caution deposit refund from last year has not been paid",
    body: "My son vacated the hostel in April after finishing and submitted the clearance form. The caution deposit has still not been refunded. The accounts section says the list has gone for sanction and could not say when.",
    talk: [
      ["d", "Your son's name is on the April vacating list, which went for sanction in June and has been approved. Cheques for that list are being issued this fortnight and the accounts section will call the number on the clearance form."],
      ["r", "Received. Thank you for giving an actual date instead of asking us to come back next week."],
    ] },

  // -- open and being worked ------------------------------------------------------
  //
  // `ref` names a report the duplicates further down get merged into. The names are
  // local to this file; the merge itself goes through ComplaintService.merge, which
  // is what moves the backing across and closes the duplicate.
  { cat: "WATER", days: 2, due: 6, back: 38, status: "in_progress", ref: "water-first-floor",
    loc: "Men's Hostel, Block A first floor", tags: ["hostel", "water"], occ: 3,
    title: "First floor tap in Block A has been running non stop for three days",
    body: "The washbasin tap at the end of the first floor corridor in Block A cannot be closed. It has been running since Sunday. The washer is gone and the whole floor can hear it at night.",
    talk: [
      ["n", "Same tap was rewashered in March. The seat is probably worn and needs a new body, not a washer."],
      ["d", "The plumber has seen it. The tap body is worn, so a new washer will not hold. A replacement is on the estates purchase list for this week and the line will be shut at the floor valve tonight so it is not running until then."],
    ] },
  { cat: "MESS", days: 3, due: -6, back: 22, status: "in_progress", who: "student",
    loc: "Hostel mess", tags: ["mess", "food"], occ: 4,
    title: "Dinner has been served cold for the last five days",
    body: "Dinner is put out at 7.30 and by the time the second sitting reaches the counter at 8.15 the rice and the curry are both cold. There is no warmer on the serving counter, only the vessels.",
    talk: [
      ["d", "The mess supervisor has been asked to split the cooking so the second sitting gets a fresh vessel rather than the tail of the first. A hot case for the counter has been quoted for and is with the admin office."],
    ] },
  { cat: "LABS", days: 5, due: 18, back: 4, status: "in_progress", who: "faculty",
    loc: "Workshop, fitting section", tags: ["workshop", "equipment"], occ: 6,
    title: "The lathe in the fitting section slips under load",
    body: "The belt on the centre lathe slips as soon as any real cut is taken, so the second year workshop batch cannot do the turning exercise. The instructor has been running that group on the second lathe two at a time.",
    talk: [
      ["n", "Belt and the motor mount both need attention. The mount bolts have worked loose more than once."],
      ["d", "New belt ordered along with the mounting bolts. The instructor has been asked to keep the batch on the second lathe until it is fitted, which will slow the practical but not stop it."],
    ] },

  { cat: "WIFI", days: 1, due: 20, back: 29, status: "in_progress", ref: "wifi-login-loop",
    loc: "Whole campus", tags: ["wifi", "login"], occ: 2,
    title: "Campus wifi login page keeps sending you back to the login page",
    body: "Since yesterday morning the wifi login accepts the portal password and then throws you straight back to the login page. It happens on phones and on laptops, in the labs and in the hostel. Nobody has had a working connection since.",
    talk: [
      ["n", "Controller certificate expired at midnight on the 2nd. Renewal is a manual step on this model."],
      ["d", "The controller's certificate expired overnight, which is why the login accepts you and then refuses to hold the session. A renewed certificate is being installed this afternoon and the whole campus should reconnect after that without doing anything."],
    ] },
  { cat: "ROOMS", days: 7, due: 30, back: 3, status: "in_progress", who: "parent",
    loc: "Ladies Hostel, room 214", tags: ["hostel", "furniture"], occ: 9,
    title: "Ceiling fan in room 214 has not worked since the term started",
    body: "My daughter's room has one fan for three girls and it has not run since they moved in. The warden was told twice in July. The room is on the west side and gets the afternoon sun.",
    talk: [
      ["d", "The fan has a burnt out winding, so it needs replacing rather than a capacitor. It is on the electrician's list for this week. A pedestal fan has been sent to the room in the meantime."],
      ["r", "She confirmed the pedestal fan arrived. Please do follow up on the ceiling one."],
    ] },
  { cat: "ACCESS", days: 9, due: -20, back: 16, status: "in_progress", who: "student",
    loc: "Seminar hall, main block", tags: ["accessibility", "ramp"], occ: 20,
    title: "There is no ramp to the seminar hall and no lift in the main block",
    body: "Every department seminar and every guest lecture happens in the seminar hall, which is up eleven steps with no ramp. A classmate on crutches since his accident has missed four sessions this month because getting him up there means two people carrying him.",
    talk: [
      ["n", "A ramp at the south entrance is feasible. The lift is a building sanction question and will not move quickly."],
      ["d", "A ramp at the south entrance has been measured and costed and the estimate is with the principal for sanction. Until it is built, any session in the seminar hall can be moved to the ground floor conference room on request, and the department offices have been told so."],
    ] },

  { cat: "BUS", days: 4, due: 26, back: 24, status: "in_progress", who: "student",
    loc: "Chathannoor route, morning trip", tags: ["bus", "overcrowding"], occ: 5,
    title: "Morning bus on the Chathannoor route is badly overcrowded",
    body: "The 7.15 from Chathannoor has around eighty people on a fifty seater. People stand on the footboard from Paravur onwards. It has been like this since the second year batch started this term.",
    talk: [
      ["d", "The route has grown by about twenty five students this term. Transport is working out whether the Kollam bus can be re-timed to take the Paravur stop, which would take the pressure off without a new vehicle. A decision goes to the principal on Friday."],
    ] },
  { cat: "REVAL", days: 12, due: 40, back: 13, status: "in_progress", who: "student",
    loc: "Exam cell", tags: ["exams", "answer script"], occ: 30,
    title: "Answer script copy applied for a month ago has not arrived",
    body: "I applied and paid for a photocopy of my S5 signals answer script five weeks ago. The exam cell has no update and the university portal shows the application as received. I need it before the revaluation window closes.",
    talk: [
      ["d", "The exam cell has the receipt and has written to the university twice. We are chasing it. If the revaluation window closes before the copy arrives, the exam cell will file the revaluation application on your behalf with the receipt attached so you do not lose the right to it."],
    ] },

  // -- picked up and sitting in a queue --------------------------------------------
  { cat: "BOOKS", days: 2, due: 60, back: 2, status: "triaged", who: "scholar",
    loc: "Library", tags: ["library", "journals"], occ: 3,
    title: "IEEE journal access has stopped working from campus",
    body: "The IEEE subscription no longer opens full text from campus machines. It asks for an institutional login that the library desk does not have. Two of us have papers due this month.",
    talk: [["n", "Subscription renewal is due in September. Need to check with the librarian whether the invoice went out."]] },
  { cat: "LIGHT", days: 1, due: -3, back: 11, status: "triaged", who: "staff",
    loc: "Staff parking area", tags: ["lighting", "parking"], occ: 2,
    title: "The lamp over the staff parking area has been out for a fortnight",
    body: "The single lamp over the parking strip behind the admin block has been dead for two weeks. Anyone leaving after the evening class is finding their vehicle by phone torch.",
    talk: [] },

  { cat: "MESS", days: 1, due: 16, back: 8, status: "triaged", who: "student",
    loc: "Canteen", tags: ["canteen", "prices"], occ: 2,
    title: "Canteen is charging more than the rate list on the wall",
    body: "The rate list next to the counter has not been changed but the prices being charged are higher on tea, on the veg meal and on the egg puffs. When asked, the counter says the list is old.",
    talk: [["n", "Contract rates were revised in June and the board was never reprinted. Both need to match before this goes any further."]] },
  { cat: "LABS", days: 3, due: 36, back: 1, status: "triaged", who: "faculty",
    loc: "Mechanical lab store", tags: ["lab", "manuals"], occ: 4,
    title: "Lab manuals for the third semester batch have not been printed",
    body: "The fluid mechanics lab manual was sent for printing in the first week and has not come back. The batch is doing the first three experiments from photocopied sheets.",
    talk: [] },

  // -- filed and not yet touched, which is what a live queue looks like ------------
  { cat: "WIFI", days: 0.4, due: 30, back: 0, status: "submitted", who: "student",
    loc: "CS Lab 1", tags: ["wifi"], occ: 1,
    title: "Lab 1 machines cannot reach the student portal",
    body: "The machines in CS Lab 1 open every other site but time out on the student portal. It works from the phone on wifi in the same room, so it is something on the lab network." },
  { cat: "SCHOL", days: 1, due: 110, back: 2, status: "submitted", who: "student",
    loc: "Accounts section", tags: ["fees", "receipt"], occ: 3,
    ev: ["Bank transfer confirmation screenshot description", "Fee challan number noted at the counter"],
    title: "No receipt was issued for the semester fee paid by transfer",
    body: "I paid the semester fee by bank transfer three weeks ago as the notice said to. The accounts counter says receipts for transfers are issued separately and has not given one. Without it the hostel office will not confirm my room for next term." },
  { cat: "ROOMS", days: 0.2, due: 44, back: 1, status: "submitted", who: "parent",
    loc: "Men's Hostel, Block B", tags: ["hostel", "warden"], occ: 2,
    title: "No warden on duty in Block B on weekend nights",
    body: "There has been nobody on the warden's desk in Block B on Saturday and Sunday nights for the last three weekends. The boys are being told to call the security gate instead, which is at the other end of the campus." },

  // No category on the next two, so KeywordStrategy has to place them. Both are
  // written to hit the wording of exactly one category, which is the honest test:
  // if the routing table is wrong these land on the wrong desk and the seed shows it.
  { days: 1, due: 40, back: 5, status: "submitted", who: "visitor",
    loc: "Main gate bus stop", tags: ["transport"], occ: 2,
    title: "No shelter at the bus stop outside the main gate",
    body: "I come to the college once a month as a vendor and wait at the bus stop outside the main gate. There is no shelter of any kind, and in the rain everyone including the students stands under the tree. A driver told me a shelter was sanctioned two years ago." },
  { days: 0.6, due: 20, back: 3, status: "submitted", who: "student",
    loc: "Hostel mess", tags: [], occ: 1,
    title: "Breakfast menu has been the same six days a week for a month",
    body: "The breakfast menu on the board says four items rotating but for the last month it has been puttu and kadala every day except Sunday. Nobody minds it once or twice. Six days a week for four weeks is a lot." },

  // -- waiting on the reporter, which is why their clocks are stopped ---------------
  { cat: "REVAL", days: 14, due: 30, back: 6, status: "awaiting_reporter", idle: 3, pass: "s4-mark",
    loc: "Exam cell", tags: ["exams"], occ: 18,
    title: "One internal mark on the S4 result looks wrong",
    body: "The S4 result shows twelve out of fifty for the design internals. The department notice board list had a different figure against my roll number when it was put up.",
    talk: [
      ["d", "We can pull the internal mark sheet for that subject, but it is filed by division and roll number."],
      ["q", "Could you tell us your division and the subject teacher's name? The mark sheet is filed that way and we do not want to open the wrong one."],
    ] },
  { cat: "LABS", days: 11, due: 48, back: 2, status: "awaiting_reporter", idle: 2, who: "student",
    loc: "Electrical machines lab", tags: ["lab"], occ: 13,
    title: "One of the rheostats in the machines lab is missing its slider",
    body: "The rheostat on the third table has no slider, so the experiment cannot be set up on that table. The lab instructor said to report it here rather than in the lab register.",
    talk: [["q", "Is it the table nearest the window or the one by the door? There are two rheostats of that rating and the store needs to know which one to swap."]] },

  // Idle for nine days, so the first SLA sweep after boot will nudge this one in
  // the thread. That nudge is the product working, not a gap in the seed.
  { cat: "SCHOL", days: 16, due: 80, back: 1, status: "awaiting_reporter", idle: 9, who: "student",
    loc: "Accounts section", tags: ["scholarship"], occ: 25,
    ev: ["Income certificate from the village office"],
    title: "Post matric scholarship application was returned without a reason",
    body: "My application was handed back at the counter with a note saying incomplete. Nothing was circled and nobody at the counter could say which part was incomplete.",
    talk: [["q", "The counter register shows two applications returned that week. Which date did you submit on, and was the income certificate the one from this year or last?"]] },
  { cat: "WATER", days: 8, due: 10, back: 4, status: "awaiting_reporter", idle: 4, who: "staff",
    loc: "Admin block ground floor", tags: ["water"], occ: 9,
    title: "The drinking water cooler on the admin block ground floor is warm",
    body: "The cooler by the ground floor stairs has been giving room temperature water for about a fortnight. The one on the first floor is fine, so it is not the supply.",
    talk: [
      ["d", "The technician will look at the compressor. Before he comes out, one thing to rule out."],
      ["q", "Is the socket it is plugged into the one that also runs the notice board light? That circuit has tripped twice this month and the cooler would look exactly like this if it had no power."],
    ] },

  // -- with the college admin now ---------------------------------------------------
  //
  // The three below carry escalated = true, which keeps them out of
  // ComplaintRepository.breaching(). They stay overdue on the dashboard instead of
  // being escalated again by the first sweep.
  { cat: "GRIEV", days: 3, due: -14, back: 0, status: "escalated", pub: false, who: "student",
    loc: "Men's Hostel, Block B", tags: [], occ: 4, pass: "block-b-nights",
    title: "Senior students are making first years stand in the corridor at night",
    body: "For the last two weeks a group of seniors in Block B has been calling first year students out into the corridor after eleven and making them stand there for an hour or more, and shouting at anyone who goes back to their room. This is ragging and everyone on the floor knows it is happening. I am filing this without my name because the same group is in my department.",
    talk: [
      ["n", "Cell informed the same evening. Warden's night register for the last fortnight has been taken. Names of the four seniors are with the cell and are not going in this thread."],
      ["d", "The cell has your report and has already taken the Block B night register. You do not need to identify yourself at any stage. There will be an anti-ragging committee sitting this week and the hostel has been asked to put a staff member on that floor after eleven starting tonight."],
    ] },

  { cat: "REVAL", days: 20, due: -52, back: 19, status: "escalated", who: "student",
    loc: "Exam cell", tags: ["exams", "revaluation"], occ: 24,
    title: "Revaluation applications from July have had no response at all",
    body: "Nineteen of us applied for revaluation in the third week of July. The exam cell has not put out a single notice since. Two people in the group have joining dates in October that need a final grade card.",
    talk: [
      ["d", "The applications were forwarded. We do not have a date from the university and cannot invent one."],
      ["r", "It has been six weeks. Can the college at least tell us who at the university is holding it, so those of us with joining dates can write ourselves?"],
      ["n", "This desk is now two weeks past its window on this. Sending it up rather than sitting on it."],
    ] },
  { cat: "WATER", days: 6, due: -30, back: 33, status: "escalated", who: "student",
    loc: "Men's Hostel, Block C", tags: ["hostel", "water"], occ: 7,
    title: "Both hostel tanks were empty from Friday evening to Sunday morning",
    body: "There was no water in either Block C tank from Friday evening until Sunday morning. Around a hundred and twenty of us were in the hostel over the weekend. The mess ran on drums brought from the pump house and the bathrooms were not usable at all.",
    talk: [
      ["d", "The main line from the panchayat connection was cut for road work on Friday and nobody told the hostel. The lorry that was arranged came on Saturday night."],
      ["r", "Nobody told us either. A note on the board on Friday would have meant people went home for the weekend instead of finding out at nine at night."],
      ["n", "Escalating. The supply cut was outside our control, the two days of silence was not, and a standing arrangement for tanker water needs a decision above this desk."],
    ] },

  // -- turned down, with the reason on the record -------------------------------------
  { days: 17, back: 2, status: "declined", who: "student",
    loc: "", tags: [], occ: 18,
    title: "Please reset the wifi password for my portal login",
    body: "I have forgotten my student portal password and the reset link is not coming to my email. Can someone reset it from the office side and tell me the new one.",
    talk: [
      ["d", "This is a helpdesk request rather than a grievance, and a password cannot be sent through an anonymous thread even if we wanted to. Walk into the IT room in the main block with your ID card and it takes two minutes. Declining this so it does not sit in the queue, not because it does not matter."],
    ] },

  { cat: "MESS", days: 22, back: 1, status: "declined", who: "student",
    loc: "Hostel mess", tags: ["mess"], occ: 23,
    title: "The mess should serve only north Indian food on weekdays",
    body: "The mess menu is almost entirely Kerala food. Those of us from outside the state would prefer roti and sabzi on weekdays instead of rice.",
    talk: [
      ["d", "The mess menu is set by the mess committee, which has elected student members, and a change of this size is a committee decision rather than a grievance one desk can act on. Two seats on the committee are open this month and the hostel office has the nomination form. Declining here so it is not stuck waiting on us, and the request has been passed to the committee secretary."],
    ] },

  // -- pulled back by the reporter ------------------------------------------------------
  { cat: "LIGHT", days: 13, back: 3, status: "withdrawn", who: "student", pass: "corridor-lamp",
    loc: "Civil block corridor", tags: ["lighting"], occ: 14,
    withdrawReason: "The department got the electrician the next morning, so this is already done.",
    title: "Corridor lights on the civil block first floor are all out",
    body: "None of the four tube lights in the first floor corridor of the civil block are working. The evening batch uses that corridor at seven.",
    talk: [] },
  { cat: "BOOKS", days: 29, back: 0, status: "withdrawn", who: "scholar", pass: "missing-volume",
    loc: "Library", tags: ["library"], occ: 30,
    withdrawReason: "Found it. It had been shelved under the wrong classification number.",
    title: "A volume of the standards series is missing from the reference shelf",
    body: "The third volume of the standards series is not on the reference shelf and the catalogue shows it as available. It is a reference copy so it cannot have been lent out.",
    talk: [
      ["q", "The library will check the reshelving trolley and the bindery list. Do you remember roughly when you last saw it on the shelf?"],
    ] },

  // -- the duplicates, merged into the reports named by `ref` above -----------------------
  //
  // Two people filing the same broken tap is the normal case, not the odd one. Merging
  // moves the backing onto the report being worked and leaves the duplicate's trace code
  // pointing at it, so neither reporter loses their thread.
  { cat: "WATER", days: 2, back: 6, into: "water-first-floor", who: "student",
    loc: "Men's Hostel, Block A", tags: ["hostel", "water"], occ: 2,
    title: "Water running all night on the Block A first floor",
    body: "There is a tap on the first floor of Block A that has been left running for days. The sound carries into the rooms at that end and it is a lot of water going down the drain." },
  { cat: "WIFI", days: 1, back: 4, into: "wifi-login-loop", who: "faculty",
    loc: "Staff room, main block", tags: ["wifi"], occ: 1,
    title: "Cannot connect to campus wifi since yesterday",
    body: "The wifi login on the staff side is not letting anyone through since yesterday morning. It takes the portal password and returns to the same page. Nobody in the staff room has a connection." },
];

// GECB is smaller and quieter, which is the point of having it: two tenants with
// different volumes, different desks and a different answer on visitor reports.
// No visitor entries below — GECB switched that off, and the seed has to respect a
// college's own setting rather than work around it.

const GECB_REPORTS = [
  { cat: "WATER", days: 40, hrs: 6, back: 9, status: "closed", who: "student",
    loc: "Men's hostel washrooms", tags: ["hostel", "water"], occ: 41,
    rate: [5, "Same day. Nothing to complain about."],
    title: "No water in the men's hostel washrooms in the morning",
    body: "The washrooms on the upper floors have no water between six and nine, which is exactly when everyone needs them. It has been three days.",
    talk: [["d", "The pump timer had been set to start at eight. It now starts at half past four so the tank is full before the morning. Please tell us if it is still short."]] },
  { cat: "MESS", days: 55, hrs: 16, back: 14, status: "closed", who: "student",
    loc: "Mess", tags: ["mess", "hygiene"], occ: 56,
    title: "Water served at the mess counter is not filtered",
    body: "The jugs on the mess tables are being filled from the tap behind the counter, not from the filter. The filter unit next to it has a note on it saying candle to be changed and has had that note for weeks.",
    talk: [["d", "The candles have been replaced and the unit is working. The mess staff have been told the jugs come off the filter only. The note stays until the next scheduled change so anyone can see the date."]] },
  { cat: "REVAL", days: 62, hrs: 150, back: 11, status: "closed", esc: true, pause: 20,
    loc: "Exam cell", tags: ["exams", "revaluation"], occ: 80,
    rate: [2, "Right answer, far too slow, and we had to keep asking."],
    title: "Revaluation result for the S6 structures paper is still not out",
    body: "Eight of us applied for revaluation of the S6 structures paper in June. Nothing has come out. The exam cell says the file is with the university and cannot say anything further.",
    talk: [
      ["q", "Can you confirm how many of the eight paid the fee at the college counter rather than online? The two payment routes are tracked separately at the university end."],
      ["r", "Six paid at the counter, two paid online."],
      ["d", "The counter batch had not been forwarded with the right challan reference, which is why nothing moved. It has been corrected and resubmitted, and the revised results are on the portal for all eight."],
    ] },
  { cat: "WIFI", days: 33, hrs: 10, back: 7, status: "closed", who: "scholar",
    loc: "Research block", tags: ["wifi"], occ: 34,
    title: "Research block has no wifi coverage on the top floor",
    body: "There is no signal at all on the top floor of the research block. Everyone up there is using mobile data, which is not workable for downloading datasets.",
    talk: [["d", "An access point has been mounted in the top floor corridor and the switch port enabled. Tested at both ends of the floor."]] },

  { cat: "LIGHT", days: 4, hrs: 28, back: 6, status: "resolved", who: "staff",
    loc: "Path behind the library", tags: ["lighting"], occ: 5,
    title: "The path behind the library has one working lamp out of five",
    body: "Four of the five lamps along the library path are out. Staff leaving after five in the evening use that path to the gate.",
    talk: [["d", "All four lamps replaced. The underground cable to two of them was also damaged and has been rerun, which is why they kept failing."]] },
  { cat: "LABS", days: 6, hrs: 40, back: 3, status: "resolved", who: "faculty",
    loc: "Surveying lab", tags: ["lab", "equipment"], occ: 8,
    title: "Two total stations in the surveying lab are out of calibration",
    body: "Two of the four total stations are giving readings that do not agree with the other two over the same baseline. The batch is being run four groups to an instrument as a result.",
    talk: [["d", "Both have gone for calibration under the service contract and are back with certificates. The lab has been asked to log a baseline check at the start of every term rather than waiting for a mismatch to show up."]] },
  { cat: "SCHOL", days: 7, hrs: 88, back: 4, status: "resolved", who: "student",
    loc: "Accounts", tags: ["scholarship", "e-grantz"], occ: 30,
    ev: ["e-Grantz sanction order print", "Bank account details as submitted"],
    rate: [4, "Straight answer within the week."],
    title: "e-Grantz instalment shows sanctioned but has not been credited",
    body: "The sanction order is dated over a month ago and nothing has been credited. The accounts section says the file has gone but cannot say when it went.",
    talk: [["d", "The instalment file for this college went to the treasury on the 12th and is in the queue for release. Accounts has the acknowledgement number and will put the release date on the notice board when it comes, for everyone in that file rather than one at a time."]] },

  { cat: "WATER", days: 2, due: 10, back: 12, status: "in_progress", who: "student",
    loc: "Ladies hostel", tags: ["hostel", "water"], occ: 3,
    title: "Ladies hostel bathroom on the second floor has no water pressure",
    body: "The second floor bathrooms have a trickle at best while the ground floor is fine. It has been like this since the tank was cleaned last week.",
    talk: [["d", "An air lock in the riser after the tank cleaning would look exactly like this. The plumber is bleeding the line tomorrow morning before the water is turned on."]] },
  { cat: "MESS", days: 3, due: -8, back: 18, status: "in_progress", who: "student",
    loc: "Mess", tags: ["mess", "food"], occ: 4,
    title: "The chapati at dinner has been hard enough to be inedible all week",
    body: "The chapati served at dinner has been dry and hard every night this week. Most of it goes into the waste bin, which is a waste of food and of the mess bill.",
    talk: [["d", "The mess supervisor has been asked to make the chapati in two batches rather than one at six o'clock. We will check it ourselves at the counter for the rest of the week."]] },

  { cat: "WIFI", days: 1, due: 24, back: 8, status: "in_progress", who: "student",
    loc: "Computing lab", tags: ["wifi", "network"], occ: 2,
    title: "Internet in the computing lab is unusable in the afternoon",
    body: "From about two in the afternoon the network in the computing lab slows to the point where a page takes a minute. Mornings are fine. Two batches have practicals in that slot.",
    talk: [["n", "Afternoon slot has both third and fifth semester batches on the same uplink. Bandwidth split needs looking at, not the lab."]] },
  { cat: "LABS", days: 5, due: 30, back: 2, status: "in_progress", who: "scholar",
    loc: "Materials lab", tags: ["lab"], occ: 7,
    title: "The universal testing machine load cell reads zero",
    body: "The UTM shows no load however much is applied. The display works and the hydraulics run, so it looks like the load cell or its cable.",
    talk: [["d", "The service engineer is coming on Thursday. If it is the cable it will be done the same day; a load cell will have to be ordered."]] },

  { cat: "REVAL", days: 2, due: 70, back: 5, status: "triaged", who: "student",
    loc: "Exam cell", tags: ["exams"], occ: 3,
    title: "Answer script photocopy application has no acknowledgement",
    body: "I applied for a photocopy of an answer script and paid at the counter but was not given any acknowledgement, so there is nothing to follow up with.",
    talk: [["n", "The counter has stopped issuing the carbon slip since the book ran out. Needs reprinting before this happens again."]] },
  { cat: "LIGHT", days: 1, due: 18, back: 4, status: "triaged", who: "student",
    loc: "Main gate to academic block", tags: ["lighting"], occ: 2,
    title: "Half the lamps between the gate and the academic block are dark",
    body: "Walking in from the gate after six, every second pole is dark. The evening batch comes in at that time.",
    talk: [] },
  { days: 1, due: 40, back: 1, status: "triaged", who: "staff",
    loc: "Admin block", tags: [], occ: 2,
    title: "The printer in the admin block office jams on every second sheet",
    body: "The office printer picks two sheets at a time and jams. It has been like this for a week and every letter takes three attempts.",
    talk: [] },

  { cat: "SCHOL", days: 1, due: 105, back: 0, status: "submitted", who: "student",
    loc: "Accounts", tags: ["fees"], occ: 4,
    ev: ["Hostel dues receipt for the last two semesters"],
    title: "Hostel dues receipt shows an amount I have already paid",
    body: "The dues statement handed out this week shows an arrear for last semester that I paid at the counter in February. I have the receipt." },
  { cat: "WIFI", days: 0.5, due: 30, back: 2, status: "submitted", who: "student",
    loc: "Ladies hostel study room", tags: ["wifi"], occ: 1,
    title: "No network in the hostel study room after ten at night",
    body: "The wifi in the ladies hostel study room stops working after ten. That is when most people are actually using it, so presumably something is being switched off." },
  { days: 0.3, due: 48, back: 0, status: "submitted", who: "faculty",
    loc: "Second year classroom", tags: [], occ: 1,
    title: "Benches in the second year classroom are broken at the back",
    body: "Four benches at the back of the second year civil classroom have broken seats and cannot be sat on. The batch is squeezing onto the remaining rows." },

  { cat: "REVAL", days: 9, due: 36, back: 3, status: "awaiting_reporter", idle: 4, who: "student",
    loc: "Exam cell", tags: ["exams"], occ: 11,
    title: "A subject is missing from my provisional certificate",
    body: "The provisional certificate lists every subject except one elective which I passed in the supplementary. The exam cell needs something from me but could not say what.",
    talk: [["q", "Which supplementary session was that elective cleared in, and do you have the result notification date? The certificate is generated from the notification list, so we need to find which list it should have been on."]] },
  { cat: "MESS", days: 6, due: 14, back: 2, status: "awaiting_reporter", idle: 3, who: "parent",
    loc: "Mess", tags: ["mess"], occ: 8,
    title: "My son says the mess does not keep anything aside for the late lab batch",
    body: "The batch with a lab until six gets to the mess after the counter has been cleared and is told to manage with what is left. This has happened often enough that he now buys food outside.",
    talk: [["q", "Which day of the week is that lab? The mess keeps a late plate on request and we want to make it standing for that batch rather than a favour they have to ask for."]] },

  // GECB's one escalation, and its only confidential report.
  { cat: "GRIEV", days: 2, due: -9, back: 0, status: "escalated", pub: false, who: "student",
    loc: "Department corridor", tags: [], occ: 3, pass: "corridor-remarks",
    title: "A staff member keeps making remarks about a classmate's community",
    body: "One staff member has twice made remarks in front of the class about which community a classmate belongs to, in a way that is clearly meant to single her out. It is harassment and it has happened in front of about fifty people both times. She does not want to file it herself.",
    talk: [
      ["n", "Cell has the dates of both incidents. Statements will be taken from students who were present, not from the person named in the report."],
      ["d", "The cell has this and it is being treated as a formal complaint. Your classmate does not have to file anything herself for the committee to act. There will be a sitting this week and nothing in this thread identifies either of you."],
    ] },
];

// ---- what the colleges said back ------------------------------------------------
//
// `days` is how long ago it went up and `expires` is the window it was given from
// that moment, so a post with a window shorter than its age is already off the
// board. The admin's announcements screen needs both kinds to be worth looking at.
// `cite` names reports by the opening of their title; the service refuses any code
// that is not a public, unmerged report of the same college, which is the check
// that keeps a private report from being quoted onto a notice board.

const CEP_NEWS = [
  { days: 4, pinned: true, cite: ["No water in the Block C bathrooms", "The overhead tank motor trips"],
    title: "Hostel water: pump 2 replaced, both tanks back on the morning schedule",
    body: "The second pump in the hostel pump house was cutting out on overload, which is why the tanks were not full before seven in the morning. It has been replaced and the starter relay on the ladies hostel line goes in this week. Both tanks are now filling on schedule. Nineteen reports on this over the last two months; the two linked below are the ones that were worked. If a tap on your floor is still dry after eight in the morning, file it — the desk would rather have the duplicate than the silence." },
  { days: 9, pinned: true, expires: 30, cite: ["S5 electronics revaluation result", "Supplementary hall ticket has the wrong subject code"],
    title: "Exam cell: what we are doing about the revaluation delays",
    body: "The exam cell is the slowest desk on this platform at the moment and there is no point pretending otherwise. Most of the delay is at the university end, but a fortnight of silence from us while a file sits there is our fault, not theirs. From this month the exam cell writes to every pending revaluation applicant on a Friday, whether or not there is news, and any application with no movement in three weeks goes to the principal's office rather than waiting to be asked about." },
  { days: 2, expires: 8,
    title: "Mess committee meets every Friday at four in the dining hall",
    body: "Two student seats on the mess committee are open. The committee sets the menu, checks the kitchen and sees the contractor's bill, so it is the place where menu and quality decisions actually get made. Nomination forms are with the hostel office until Thursday." },
  { days: 34, expires: 14, cite: ["Reading room shuts at five during study leave"],
    title: "Library reading room stays open until nine during study leave",
    body: "Following a report from a student that the reading room shut at five on study leave days, the reading room now stays open until nine on every study leave day with an attendant on duty. This will be reviewed after the semester exam." },
  { days: 17,
    title: "How a report to the Internal Complaints Cell is handled",
    body: "Anything filed under ragging and harassment goes to the Internal Complaints Cell and nowhere else. It never appears on the public feed, it is not visible to any other desk, and the cell does not need to know who you are to act on it. You will get a trace code; keep it, because it is the only thing that links you to the report and we cannot recover it for you. If you are reporting something that happened to someone else, that is allowed and the committee can act on it." },
];

const GECB_NEWS = [
  { days: 6, pinned: true,
    title: "The six desks at Barton Hill and who sits behind each one",
    body: "Hostel and Mess, and Fees and Scholarships, both go to Deepa Rajan. Campus Maintenance goes to Anil Varghese. Computing and Network, and Academics and Examinations, go to Fathima Beevi. The Internal Complaints Cell is handled by the principal directly and by nobody else, and so is anything filed under a desk that has no officer yet. Every desk has a response window written against it and the clock starts the moment you file, not the moment someone opens it." },
  { days: 3, expires: 14,
    title: "Lab equipment audit in the second week of September",
    body: "Every lab is being audited for instruments that are broken, missing or out of calibration, after two total stations in the surveying lab were found reading against each other. If something in a lab you use does not work, file it this week and it goes into the audit list rather than waiting for next term." },
  { days: 11, cite: ["No water in the men's hostel washrooms", "Research block has no wifi coverage"],
    title: "August: fourteen reports, eleven answered inside their window",
    body: "Fourteen reports came in last month. Eleven were answered inside the window the desk had committed to, one was late by a day, and two are still open. The slowest was a revaluation file at the university end which took five weeks and should not have. The two linked below are the ones the desks closed quickest, which is only worth saying because the numbers are on the transparency page either way." },
  { days: 5, expires: 30,
    title: "Water supply work on the Kunnukuzhi side of campus",
    body: "The line that feeds the ladies hostel and the research block is being replaced in sections over the next three weeks. Supply to those two buildings will be off between ten in the morning and two in the afternoon on the days the work is on the relevant section. The hostel office will have the day's schedule by the previous evening." },
];

// ---- the rest of the KTU roster ---------------------------------------------------
//
// CEP and GECB above are hand-written because they are the two people meet first.
// Everything after them is built by one generator with one shape, so the demo can
// show a whole university instead of two colleges. Each campus gets the standard
// eight-desk structure, the twelve KTU categories, four working officers plus one
// who is parked (so every college shows an approvals row), about twenty reports at
// the same mix of lifecycles, and four updates. The texts are drawn from a fixed
// template bank so the transparency medians and the cited updates line up, exactly
// like the hand-written colleges do.

const KTU_DOMAIN = "ktu.ac.in";

const KTU_COLLEGES = [
  { slug: "cet", note: "State apex college, verified against the CET office listing.",
    name: "College of Engineering Trivandrum", shortName: "CET", city: "Thiruvananthapuram",
    emailDomain: "cet.ac.in", mess: "main mess", line: "the Kulathoor line", labs: "the Strength of Materials lab",
    motto: "An open register for a campus that outgrew word of mouth.",
    allowVisitorReports: true, adminName: "Dr. Shantha Mohan", adminTitle: "Principal",
    adminEmail: "shantha.mohan@cet.ac.in", adminPass: "trivandrum-admin-2026",
    staff: [["Girish Pillai", "Assistant Registrar", ["ACAD", "FEES"]],
      ["Lekshmi S.", "Hostel Superintendent", ["HOSTEL"]],
      ["Mahesh Kumar", "Assistant Engineer", ["INFRA", "TRANS"]],
      ["Divya Menon", "Systems Administrator", ["IT", "LIB"]],
      ["Anoop Varma", "Librarian", ["LIB"]]] },
  { slug: "gcek", note: "Government college, verified through the DTE list.",
    name: "Government College of Engineering Kannur", shortName: "GCEK", city: "Kannur",
    emailDomain: "gcek.ac.in", mess: "the campus mess", line: "the Payyanur line", labs: "the electronics lab",
    motto: "Filed in thirty seconds, answered inside the window it promises.",
    allowVisitorReports: true, adminName: "Dr. Rajan Kottayi", adminTitle: "Principal",
    adminEmail: "rajan.kottayi@gcek.ac.in", adminPass: "kannur-admin-2026",
    staff: [["Sajith Mathew", "Assistant Registrar", ["ACAD", "FEES"]],
      ["Beena Thomas", "Hostel Superintendent", ["HOSTEL"]],
      ["Ratheesh Kumar", "Assistant Engineer", ["INFRA", "TRANS"]],
      ["Naveen Suresh", "Systems Administrator", ["IT", "LIB"]],
      ["Aiswarya L.", "Librarian", ["LIB"]]] },
  { slug: "gect", note: "Government college, verified through the DTE list.",
    name: "Government Engineering College Thrissur", shortName: "GECT", city: "Thrissur",
    emailDomain: "gect.ac.in", mess: "the girls hostel mess", line: "the Guruvayur line", labs: "the mechanical workshop",
    motto: "A public clock on every desk, including this one.",
    allowVisitorReports: true, adminName: "Dr. Bindhu Rajan", adminTitle: "Principal",
    adminEmail: "bindhu.rajan@gect.ac.in", adminPass: "thrissur-admin-2026",
    staff: [["Deepak V.", "Assistant Registrar", ["ACAD", "FEES"]],
      ["Suma K.", "Hostel Superintendent", ["HOSTEL"]],
      ["Arun Prakash", "Assistant Engineer", ["INFRA", "TRANS"]],
      ["Reshma K. K.", "Systems Administrator", ["IT", "LIB"]],
      ["Jithin John", "Librarian", ["LIB"]]] },
  { slug: "cek", note: "Government college, verified through the DTE list.",
    name: "College of Engineering Kidangoor", shortName: "CEK", city: "Kottayam",
    emailDomain: "cek.ac.in", mess: "the HQ mess", line: "the Kanjirappally line", labs: "the civil materials lab",
    motto: "Your words, filed as you wrote them.",
    allowVisitorReports: true, adminName: "Dr. Manoj K. V.", adminTitle: "Principal",
    adminEmail: "manoj.kv@cek.ac.in", adminPass: "kidangoor-admin-2026",
    staff: [["Sreejith Nair", "Assistant Registrar", ["ACAD", "FEES"]],
      ["Vinitha R.", "Hostel Superintendent", ["HOSTEL"]],
      ["Binu Mathew", "Assistant Engineer", ["INFRA", "TRANS"]],
      ["Ajay Menon", "Systems Administrator", ["IT", "LIB"]],
      ["Parvathy S.", "Librarian", ["LIB"]]] },
  { slug: "rit", note: "Verified against the RIT Kottayam public listing.",
    name: "Rajiv Gandhi Institute of Technology", shortName: "RIT", city: "Kottayam",
    emailDomain: "rit.ac.in", mess: "the hostel mess", line: "the Pampady line", labs: "the microprocessors lab",
    motto: "Say it once. We will tell you where it went.",
    allowVisitorReports: false, adminName: "Dr. Santhosh Kumar", adminTitle: "Principal",
    adminEmail: "santhosh.kumar@rit.ac.in", adminPass: "kottayam-rit-admin-2026",
    staff: [["Aneesh P.", "Assistant Registrar", ["ACAD", "FEES"]],
      ["Sherin Joseph", "Hostel Superintendent", ["HOSTEL"]],
      ["Manu Thomas", "Assistant Engineer", ["INFRA", "TRANS"]],
      ["Lakshmi Narayanan", "Systems Administrator", ["IT", "LIB"]],
      ["Femi Paul", "Librarian", ["LIB"]]] },
  { slug: "mec", note: "Verified against the MEC Thrikkakara public listing.",
    name: "Model Engineering College", shortName: "MEC", city: "Ernakulam",
    emailDomain: "mec.ac.in", mess: "the MEC mess", line: "the Aluva line", labs: "the VLSI lab",
    motto: "Anonymous without being anonymous — it gets a desk either way.",
    allowVisitorReports: true, adminName: "Dr. Saji K. Mathew", adminTitle: "Principal",
    adminEmail: "saji.mathew@mec.ac.in", adminPass: "thrikkakara-admin-2026",
    staff: [["Rajesh V.", "Assistant Registrar", ["ACAD", "FEES"]],
      ["Kavitha Menon", "Hostel Superintendent", ["HOSTEL"]],
      ["Silpa Das", "Assistant Engineer", ["INFRA", "TRANS"]],
      ["Harikrishnan T.", "Systems Administrator", ["IT", "LIB"]],
      ["Anju George", "Librarian", ["LIB"]]] },
  { slug: "tkm", note: "Private aided college, verified against the TKMCE listing.",
    name: "TKM College of Engineering", shortName: "TKM", city: "Kollam",
    emailDomain: "tkmce.ac.in", mess: "the TKM mess", line: "the Kottiyam line", labs: "the fluid mechanics lab",
    motto: "The desk you cannot see is the one that answers fastest.",
    allowVisitorReports: true, adminName: "Dr. Bindu G. R.", adminTitle: "Principal",
    adminEmail: "bindu.gr@tkmce.ac.in", adminPass: "kollam-tkm-admin-2026",
    staff: [["Vineeth Kumar", "Assistant Registrar", ["ACAD", "FEES"]],
      ["Sreelekshmi R.", "Hostel Superintendent", ["HOSTEL"]],
      ["Baiju George", "Assistant Engineer", ["INFRA", "TRANS"]],
      ["Sanal K.", "Systems Administrator", ["IT", "LIB"]],
      ["Jyothi S.", "Librarian", ["LIB"]]] },
  { slug: "mace", note: "Private aided college, verified against the MACE listing.",
    name: "Mar Athanasius College of Engineering", shortName: "MACE", city: "Kothamangalam",
    emailDomain: "mace.ac.in", mess: "the MACE mess", line: "the Munnar line", labs: "the structural lab",
    motto: "Forty desks, one door.",
    allowVisitorReports: true, adminName: "Dr. Tom Jacob", adminTitle: "Principal",
    adminEmail: "tom.jacob@mace.ac.in", adminPass: "kothamangalam-admin-2026",
    staff: [["Joju Varghese", "Assistant Registrar", ["ACAD", "FEES"]],
      ["Annamma J.", "Hostel Superintendent", ["HOSTEL"]],
      ["Roopesh Cherian", "Assistant Engineer", ["INFRA", "TRANS"]],
      ["Siby Moncy", "Systems Administrator", ["IT", "LIB"]],
      ["Neena Philip", "Librarian", ["LIB"]]] },
  { slug: "sahrdaya", note: "Private un-aided college, verified against the college listing.",
    name: "Sahrdaya College of Engineering", shortName: "Sahrdaya", city: "Kodakara",
    emailDomain: "sahrdaya.ac.in", mess: "the Sahrdaya mess", line: "the Ollur line", labs: "the analog lab",
    motto: "A quiet place to say a loud thing.",
    allowVisitorReports: true, adminName: "Dr. Georgekutty Joseph", adminTitle: "Principal",
    adminEmail: "georgekutty.joseph@sahrdaya.ac.in", adminPass: "kodakara-admin-2026",
    staff: [["Jimmy Jose", "Assistant Registrar", ["ACAD", "FEES"]],
      ["Reetha Cherian", "Hostel Superintendent", ["HOSTEL"]],
      ["Shibu K. T.", "Assistant Engineer", ["INFRA", "TRANS"]],
      ["Arun Gopi", "Systems Administrator", ["IT", "LIB"]],
      ["Bindu S.", "Librarian", ["LIB"]]] },
  { slug: "vidya", note: "Private un-aided college, verified against the college listing.",
    name: "Vidya Academy of Science and Technology", shortName: "Vidya", city: "Thrissur",
    emailDomain: "vidyaacademy.ac.in", mess: "the Vidya mess", line: "the Wadakkanchery line", labs: "the DSP lab",
    motto: "The answer is printed too — response times are public here.",
    allowVisitorReports: true, adminName: "Dr. Sudheesh K. V.", adminTitle: "Principal",
    adminEmail: "sudheesh.kv@vidyaacademy.ac.in", adminPass: "kurumassery-admin-2026",
    staff: [["Saju P. K.", "Assistant Registrar", ["ACAD", "FEES"]],
      ["Divya K. P.", "Hostel Superintendent", ["HOSTEL"]],
      ["Vipin Kumar", "Assistant Engineer", ["INFRA", "TRANS"]],
      ["Aswin R.", "Systems Administrator", ["IT", "LIB"]],
      ["Kavya P.", "Librarian", ["LIB"]]] },
  { slug: "fisat", note: "Private un-aided college, verified against the FISAT listing.",
    name: "Federal Institute of Science and Technology", shortName: "FISAT", city: "Angamaly",
    emailDomain: "fisat.ac.in", mess: "the FISAT mess", line: "the Kalady line", labs: "the networking lab",
    motto: "Complaints that leave a paper trail, not a grudge.",
    allowVisitorReports: true, adminName: "Dr. Abraham K. Varghese", adminTitle: "Principal",
    adminEmail: "abraham.kv@fisat.ac.in", adminPass: "angamaly-admin-2026",
    staff: [["Prakash K.", "Assistant Registrar", ["ACAD", "FEES"]],
      ["Anitha Sreedhar", "Hostel Superintendent", ["HOSTEL"]],
      ["Biju Kuriakose", "Assistant Engineer", ["INFRA", "TRANS"]],
      ["Manish P. M.", "Systems Administrator", ["IT", "LIB"]],
      ["Sruthi M.", "Librarian", ["LIB"]]] },
  { slug: "asiet", note: "Private un-aided college, verified against the college listing.",
    name: "Adi Shankara Institute of Engineering and Technology", shortName: "ASIET", city: "Kalady",
    emailDomain: "adishankara.ac.in", mess: "the ASIET mess", line: "the Aluva line", labs: "the robotics lab",
    motto: "Filed once, routed right, answered on the record.",
    allowVisitorReports: true, adminName: "Dr. Jayan K. V.", adminTitle: "Principal",
    adminEmail: "jayan.kv@adishankara.ac.in", adminPass: "kalady-admin-2026",
    staff: [["Sreekanth S.", "Assistant Registrar", ["ACAD", "FEES"]],
      ["Lalitha Nair", "Hostel Superintendent", ["HOSTEL"]],
      ["Paul Augustine", "Assistant Engineer", ["INFRA", "TRANS"]],
      ["Aravind K.", "Systems Administrator", ["IT", "LIB"]],
      ["Megha Jose", "Librarian", ["LIB"]]] },
];

/** Registered and left for the platform office, so Approve and Reject have rows. */
const KTU_PENDING = [
  { registration: {
    name: "Government Engineering College Wayanad", shortName: "GECW", city: "Mananthavady",
    state: "Kerala", university: "APJ Abdul Kalam Technological University",
    emailDomain: "gecwayanad.ac.in", contactEmail: "office@gecwayanad.ac.in",
    adminName: "Dr. Reena George", adminEmail: "reena.george@gecwayanad.ac.in",
    adminTitle: "Academic Coordinator", password: "mananthavady-admin-2026" } },
  { registration: {
    name: "Nehru College of Engineering and Research Centre", shortName: "NCERC", city: "Pambady",
    state: "Kerala", university: "APJ Abdul Kalam Technological University",
    emailDomain: "ncerc.ac.in", contactEmail: "office@ncerc.ac.in",
    adminName: "Dr. Soja Sreedhar", adminEmail: "soja.sreedhar@ncerc.ac.in",
    adminTitle: "Dean, Students", password: "pambady-admin-2026" } },
];

const KTU_DESKS = [
  { code: "ACAD", name: "Academics & Examinations", slaHours: 72,
    description: "Results, revaluation and the exam cell." },
  { code: "HOSTEL", name: "Hostel & Mess", slaHours: 24,
    description: "The hostels, the mess and the warden roster." },
  { code: "INFRA", name: "Campus Infrastructure", slaHours: 48,
    description: "Buildings, water, lighting and the grounds." },
  { code: "IT", name: "IT & Network", slaHours: 36,
    description: "Campus WiFi, lab machines and the portal." },
  { code: "LIB", name: "Library", slaHours: 96,
    description: "Lending, the reading room and journals." },
  { code: "TRANS", name: "Transport", slaHours: 48,
    description: "The college buses, routes and timings." },
  { code: "ICC", name: "Internal Complaints Cell", slaHours: 8,
    description: "Ragging and harassment. Confidential." },
  { code: "FEES", name: "Scholarships & Fees", slaHours: 120,
    description: "e-Grantz, refunds and hostel dues." },
];

/** The twelve KTU categories, sharing the shape CEP and GECB use. */
const KTU_CATS = CEP.categories.map((cat) => ({ ...cat }));

/** One college spec produced from the roster line above. */
function makeKtuSpec(cfg) {
  const headFor = new Map();
  for (const [name, , codes] of cfg.staff) for (const code of codes) headFor.set(code, name);
  const desks = KTU_DESKS.map((desk) => ({
    ...desk,
    headName: headFor.get(desk.code) ?? cfg.adminName,
    description: desk.description,
  }));
  const officers = cfg.staff.map(([name, title, codes], i) => ({
    name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@${cfg.emailDomain}`, title,
    password: `${cfg.slug}-officer-2026`, desks: codes,
    pending: i === cfg.staff.length - 1, // the last staff line is parked for an approvals row
  }));
  return {
    slug: cfg.slug,
    note: cfg.note,
    motto: cfg.motto,
    settings: { defaultSlaHours: 48, autoCloseAfterDays: 10, allowVisitorReports: cfg.allowVisitorReports },
    registration: {
      name: cfg.name, shortName: cfg.shortName, city: cfg.city, state: "Kerala",
      university: "APJ Abdul Kalam Technological University",
      emailDomain: cfg.emailDomain, contactEmail: `office@${cfg.emailDomain}`,
      adminName: cfg.adminName, adminEmail: cfg.adminEmail, adminTitle: cfg.adminTitle,
      password: cfg.adminPass,
    },
    desks,
    categories: KTU_CATS,
    officers,
  };
}

/** The standard lifecycle mix every generated college gets. */
const KTU_PLAN = [
  { cat: "WATER", status: "closed", days: 36, hrs: 8, back: 24, rate: [4, "The pump was replaced, not just looked at."], v: 0 },
  { cat: "WIFI", status: "closed", days: 46, hrs: 5, back: 16, v: 1 },
  { cat: "MESS", status: "closed", days: 61, hrs: 3, back: 10, v: 0 },
  { cat: "BUS", status: "closed", days: 54, hrs: 22, back: 13, v: 0 },
  { cat: "ROOMS", status: "resolved", days: 40, hrs: 14, back: 6, rate: [5, "The warden answered before breakfast the next day."], v: 0 },
  { cat: "LABS", status: "closed", days: 70, hrs: 40, back: 9, v: 0 },
  { cat: "REVAL", status: "in_progress", days: 6, due: 14, back: 5, ref: "reval-ref", v: 0, talk: ["d"] },
  { cat: "REVAL", status: "submitted", days: 30, into: "reval-ref", back: 1, v: 1 },
  { cat: "SCHOL", status: "closed", days: 74, hrs: 120, back: 6, v: 0,
    ev: ["e-Grantz acknowledgement slip", "Bank passbook first page"] },
  { cat: "ACCESS", status: "resolved", days: 20, hrs: 66, back: 3, v: 0 },
  { cat: "MESS", status: "in_progress", days: 1, due: 8, back: 2, v: 1 },
  { cat: "LABS", status: "in_progress", days: 2, due: 22, back: 3, v: 1 },
  { cat: "WIFI", status: "triaged", days: 1, due: 30, back: 1, v: 2 },
  { cat: "WATER", status: "in_progress", days: 0, due: 3, back: 4, v: 1 },
  { cat: "LIGHT", status: "in_progress", days: 2, due: -5, back: 11, v: 0 },
  { cat: "REVAL", status: "escalated", days: 6, due: 20, back: 2, v: 2,
    escReason: "The application sits with the university counter and the desk has no movement to report." },
  { cat: "ROOMS", status: "awaiting_reporter", days: 4, idle: 2, due: 24, v: 1, talk: ["q"] },
  { cat: "BUS", status: "declined", days: 12, v: 1,
    declineReason: "This is the town bus depot's run, not the college's — the reason is in the thread." },
  { cat: "MESS", status: "withdrawn", days: 9, pass: "withdrawn-plan", who: "parent", v: 2 },
  { cat: "GRIEV", status: "resolved", days: 22, hrs: 30, pub: false, pass: "icc-plan-pass", v: 0, who: "scholar", talk: ["n", "d"] },
];

const KTU_TITLES = {
  WATER: [
    (s, w) => `No water in the ${w} hostel washrooms after 7am`,
    (s, w) => `The overhead tank motor for the ${w} hostel keeps tripping`,
  ],
  WIFI: [
    (s, w) => `${s.labs} has no wifi coverage at all`,
    (s, w) => `Campus wifi drops every few minutes in the reading room`,
    (s, w) => `The student portal times out every evening after 6pm`,
  ],
  MESS: [
    (s, w) => `Breakfast in ${s.mess} was served half cooked`,
    (s, w) => `The menu this week for ${s.mess} is mostly missed items`,
    (s, w) => `No vegetarian option at lunch in ${s.mess} for three days`,
  ],
  BUS: [
    (s, w) => `The ${s.line} bus leaves before the timetable it prints`,
    (s, w) => `The bus on ${s.line} is overcrowded after the 4pm lab`,
  ],
  LABS: [
    (s, w) => `Four machines in ${s.labs} will not switch on`,
    (s, w) => `${s.labs} is short of working oscilloscopes`,
  ],
  LIGHT: [
    (s, w) => `The path from the back gate to the ${w} hostel is completely dark`,
  ],
  REVAL: [
    (s, w) => `S3 revaluation result has not moved in a month`,
    (s, w) => `Supplementary hall ticket prints the wrong subject code`,
    (s, w) => `No reply from the exam cell about a revaluation file`,
  ],
  ROOMS: [
    (s, w) => `The room fan on the top floor barely turns — ${w} hostel`,
    (s, w) => `No mattress on my bunk ${w} hostel, promised last month`,
  ],
  SCHOL: [
    (s, w) => `e-Grantz sanction for last term has not been released`,
  ],
  ACCESS: [
    (s, w) => `The ramp to the CS block has a broken railing`,
  ],
  GRIEV: [
    (s, w) => `Comments at the ${w} hostel stairs have gone past a joke`,
    (s, w) => `I am being followed on the walk between the gate and the ${w} hostel`,
  ],
};

const KTU_BODIES = {
  WATER: [
    (s, who) => `From about seven in the morning the taps in the ${who} hostel give nothing on the floors above the first. It comes back around eleven. Roughly forty people are getting ready in that window and there are two working taps on the ground floor for all of them.`,
    (s, who) => `The overhead tank motor for the ${who} hostel has tripped twice this week and the tank never fills before the morning rush. Each time it takes the caretaker a few hours to notice and reset it.`,
  ],
  WIFI: [
    (s, who) => `Sitting in ${s.labs} there is no wifi at all, while the corridor outside works fine. We carry our files on pen drives because it has been like this for a term.`,
    (s, who) => `Sitting in the reading room the wifi disconnects every few minutes and takes a while to come back. It is fine in the corridor, which suggests the access point sits behind the metal stack shelves.`,
    (s, who) => `Every evening after six the student portal takes minutes to load, and right before a deadline it fails entirely. The lab across the wing is on the same network and works, so it looks like one of the two uplinks is saturated.`,
  ],
  MESS: [
    (s, who) => `The idli at breakfast was raw in the middle and three of us put it back. The cook said the steamer was started late because the gas cylinder was changed that morning.`,
    (s, who) => `Of the fourteen items on this week's printed menu for ${s.mess}, five have never appeared and three were replaced without saying. The menu is how people decide whether to eat on campus at all.`,
    (s, who) => `For three days this week lunch in ${s.mess} had no vegetarian main at all. There are at least a dozen of us and we ate rice and whatever chutney was left.`,
  ],
  BUS: [
    (s, who) => `The bus on ${s.line} prints one departure time in the notice and leaves five minutes earlier in practice. People who arrive on the printed time watch it pull away.`,
    (s, who) => `After the 4pm lab the bus on ${s.line} runs standing room only, and twice it has left people at the stop because it was full. A third trip for that window would fix it.`,
  ],
  LABS: [
    (s, who) => `Four machines in ${s.labs} will not switch on and a fifth takes ten minutes to get past the login. The lab seats us in groups of three around the ones that do work.`,
    (s, who) => `${s.labs} has two working oscilloscopes for a twenty-four bench lab. The box of them marked for repair has been full since last term.`,
  ],
  LIGHT: [
    (s, who) => `There is no working light on the stretch between the back gate and the ${who} hostel turning. One pole halfway has been dark for weeks and people walk that part in groups on purpose.`,
  ],
  REVAL: [
    (s, who) => `The revaluation application from last month shows no movement on the university portal and the exam cell here has not told us anything either way. A file that silent for a month is not being worked.`,
    (s, who) => `The supplementary hall ticket generated for my subject prints the wrong subject code — a code from a different programme. I checked against the portal and the exam cell has not answered.`,
    (s, who) => `I wrote to the exam cell twice about a revaluation file and there is no reply on the portal or by email. I am filing this here because it is the only place an answer is on the record.`,
  ],
  ROOMS: [
    (s, who) => `The ceiling fan on the top floor of the ${who} hostel barely turns and spins the wrong way on slow. We have two hours of study left after the mess closes.`,
    (s, who) => `My bunk has no mattress two months after the allotment, despite being promised one "this week" since the start. The linen room says it is not their list.`,
  ],
  SCHOL: [
    (s, who) => `The e-Grantz sanction for last term has not been released and the office says the payment file is "with the treasury". Without it the hostel installment is due on my head.`,
  ],
  ACCESS: [
    (s, who) => `The ramp to the CS block threw me off when a railing bolt came free and the rail swung away. Someone who needs the rail to climb would have come down.`,
  ],
  GRIEV: [
    (s, who) => `Comments have stopped being a joke at the ${who} hostel stairs. It happens in a group so nobody has said anything, but it is every evening now and I would rather the cell hold them to it than it escalate.`,
    (s, who) => `For a week I am being followed on the walk between the gate and the ${who} hostel, always the same distance behind. I cannot identify the person in a line-up, so I am reporting the pattern while it is a pattern.`,
  ],
};

const titleFor = (cat, variant, cfg) => {
  const fn = KTU_TITLES[cat][variant % KTU_TITLES[cat].length];
  const who = cat === "GRIEV" || cat === "WATER" || cat === "ROOMS" || cat === "LIGHT"
    ? (cat === "LIGHT" ? "ladies" : "second-year") : "main";
  return fn(cfg, who);
};

// Which desk messages a plan position gets. Kinds: n = internal note, d = reply to
// the reporter, q = a reply that parks the report waiting on the reporter.
const KTU_TALK_KINDS = {
  "WATER|0": ["n", "d"], "WATER|1": ["d"],
  "WIFI|1": ["d"], "WIFI|2": [],
  "MESS|0": ["n", "d"], "MESS|1": ["d"], "MESS|2": [],
  "BUS|0": ["n", "d"], "BUS|1": ["d"],
  "ROOMS|0": ["d"], "ROOMS|1": ["q"],
  "LABS|0": ["n", "d"], "LABS|1": ["d"],
  "REVAL|0": ["d"], "REVAL|1": [], "REVAL|2": [],
  "SCHOL|0": ["n", "d"],
  "ACCESS|0": ["d"],
  "LIGHT|0": ["d"],
  "GRIEV|0": ["n", "d"],
};

// The words behind those kinds, picked by category then by the fixture's variant.
const KTU_MESSAGES = {
  WATER: {
    n: [(s) => `The night caretaker logged the pump tripping at 5.20am; the pump attendant had it back by six.`],
    d: [
      (s) => `The pump was serviced this morning and the tank filled before seven. If the taps run dry again tomorrow, the warden's office number is pinned in this thread.`,
      (s) => `The motor was tripping on the thermal overload every time the starter reset, so the starter was past its job. The spare motor is in and it filled normally this morning.`,
    ],
  },
  WIFI: {
    d: [
      () => `The access point behind the stack shelves was dead and has been moved in front of the partition. Coverage is now across the room.`,
      () => `The access point firmware was restarting on memory pressure. It has been replaced and the channel plan spread out. Report back through this thread if the readout drops again.`,
      () => `The evening saturation was one uplink: the loads have been split across both lines and the portal comes up in under a second now.`,
    ],
  },
  MESS: {
    n: [(s) => `The kitchen ledger for that meal was pulled and the supplier's slip is attached.`],
    d: [
      () => `The steamer is started an hour earlier from tomorrow and the cook roster marks it. That meal should not be served raw again.`,
      () => `The menu committee meets Friday afternoon. The missed items go on the agenda with the dates they were promised, and the committee keeps the printed menu honest.`,
      () => `A vegetarian main now has to be on every lunch and dinner service. The mess committee is adding it to the signed contract.`,
    ],
  },
  BUS: {
    n: [(s) => `The departure time in the notice was checked against the gate camera for that week.`],
    d: [
      () => `The driver was a contract fill-in that month. The timed departure is being set from the camera log, not the printed notice, and the notice follows it.`,
      () => `The 4pm run is now shared with the 4.30 feeder so nobody waits past the timetable. Try the next departure and say so here if it staggers the same way.`,
    ],
  },
  ROOMS: {
    d: [() => `The fan on the top floor was found bridged on a bad winding. It is replaced with a working unit and the whole top floor was checked before it went back on.`],
    q: [() => `The linen register shows your bunk number with a mattress issued on the fifteenth. Was there ever one on the bed, or was the room handed over empty? A word in and we will pull the issue slip.`],
  },
  LABS: {
    n: [(s) => `The machines were bench-tested this morning; two are PSU faults and two are RAM.`],
    d: [
      () => `Two machines had failed power supplies and two had bad RAM sticks. All four are back on the network and the fifth boots in under a minute now.`,
      () => `The oscilloscope stock is short because the calibration contract has a three-week backlog. Two working units are being moved here from the research wing and the repair queue is in this thread.`,
    ],
  },
  REVAL: {
    d: [
      () => `The exam cell tracked this file to the university counter this week, where it is with the subject officer. The cell is writing to you on Fridays with whatever the counter has said by then.`,
      () => `The hall ticket code is a portal cache from a syllabus before the code shuffle. The corrected print is ready at the exam cell desk and the portal copy refreshes overnight.`,
    ],
  },
  SCHOL: {
    n: [(s) => `The sanction file for that instalment was checked against the treasury mention twice.`],
    d: [() => `The instalment file was rejected by the treasury on an old bank code, not a sanction issue. It has been corrected and resubmitted; credit follows in two to three weeks. The mention is scanned into this thread.`],
  },
  ACCESS: {
    d: [() => `The railing bolt came free where the handrail meets the ramp landing. It is re-welded and the other landings were given the same check this week.`],
  },
  LIGHT: {
    d: [() => `The pole was dead on the photocell, not the lamp. The cell is replaced and the stretch from the gate to the turning is lit from tonight.`],
  },
  GRIEV: {
    n: [(s) => `The cell walked the route at the time given and spoke to the till and mess staff who were around. The autumn camp letter is on file.`],
    d: [() => `The cell has looked into this and taken it up directly, which is why this thread says little. The harassment has been told plainly to stop, and the cell remains open to you through the confidential desk.`],
  },
};

/** The thread a fixture replays, as tuples of [kind, words the desk/reporter said]. */
const talkFor = (plan, cfg) => {
  const kinds = KTU_TALK_KINDS[`${plan.cat}|${plan.v}`]
    ?? (plan.into || plan.status === "withdrawn" ? [] : ["d"]);
  return kinds.map((kind) => {
    const bank = KTU_MESSAGES[plan.cat]?.[kind] ?? [];
    const line = bank[plan.v % Math.max(bank.length, 1)];
    return [kind, (typeof line === "function" ? line : () => `The ${plan.cat.toLowerCase()} desk is on it and will reply through this thread.`)(cfg)];
  });
};

/** The ~20 fixture records a generated college files. */
function makeKtuReports(cfg) {
  return KTU_PLAN.map((plan, i) => {
    const fixture = { ...plan, talk: undefined, v: undefined, ref: undefined, into: undefined, escReason: undefined, declineReason: undefined, pass: undefined, pub: plan.pub, who: plan.who };
    if (plan.ref) fixture.ref = plan.ref;
    if (plan.into) fixture.into = plan.into;
    if (plan.escReason) fixture.escReason = plan.escReason;
    if (plan.declineReason) fixture.declineReason = plan.declineReason;
    if (plan.pass) fixture.pass = plan.pass;
    fixture.title = titleFor(plan.cat, plan.v, cfg);
    fixture.body = KTU_BODIES[plan.cat][plan.v % KTU_BODIES[plan.cat].length](cfg, plan.who ?? "main");
    fixture.loc = plan.cat === "MESS" ? cfg.mess
      : plan.cat === "BUS" ? `${cfg.line} bus stop`
        : plan.cat === "GRIEV" ? `${cfg.shortName} campus` : `${cfg.shortName} campus`;
    fixture.tags = [plan.cat === "GRIEV" ? "confidential" : plan.cat.toLowerCase()];
    fixture.occ = (plan.days ?? 0) + 1;
    fixture.talk = talkFor(plan, cfg);
    if (plan.status === "in_progress" || plan.status === "triaged") fixture.pause = 0;
    return fixture;
  });
}

/** The four updates a generated college posts, citing the reports it worked. */
function makeKtuNews(cfg) {
  const cite = (cat, variant) => titleFor(cat, variant, cfg);
  return [
    { days: 3, pinned: true, cite: [cite("WATER", 0), cite("WATER", 1)],
      title: `Water supply: ${cfg.mess} pump house back on schedule`,
      body: `The two pumps that feed the ${cfg.name} hostels have both been overhauled after a fortnight of one tripping on overload, and the tanks now fill before seven in the morning. The reports linked below were the two that got it moving. If your floor is still dry after eight, file it — the hostel desk would rather have a duplicate than a silence.` },
    { days: 8, expires: 30, cite: [cite("WIFI", 0)],
      title: "Wifi in the labs: what changed this week",
      body: `The coverage complaints across the campus have been walked this week and the quiet spots are being fixed in the order the reports arrived. The desks publish their response windows on the transparency page, and the clock starts the moment you file.` },
    { days: 15, expires: 14, cite: [cite("MESS", 0)],
      title: `${cfg.mess} committee meets every Friday at four`,
      body: `Two student seats on the mess committee are open. The committee sets the menu, checks the kitchen and sees the contractor's bill, so it is the place where menu and quality decisions actually get made. Nomination forms are with the hostel office until Thursday.` },
    { days: 21, cite: [cite("REVAL", 0), cite("REVAL", 2)],
      title: `Exam cell: what we are doing about the revaluation delays`,
      body: `The exam cell is the slowest desk on this platform at the moment and there is no point pretending otherwise. From this month the exam cell writes to every pending revaluation applicant on a Friday whether or not there is news, and any file with no movement in three weeks goes to the principal's office rather than waiting to be asked about.` },
  ];
}

// ---- building the campus ----------------------------------------------------------

/**
 * Registers a college, has the platform office approve it, then lets the college's
 * own admin build the desks, the categories and the team.
 *
 * Nothing here writes a row by hand. This is the same sequence a real college walks
 * through in the console, in the same order, through the same services — which is
 * the only reason the output is worth showing to anybody.
 */
async function buildCollege(services, db, owner, spec) {
  const { auth, colleges, catalog } = services;
  const { college: registered, admin } = await auth.registerCollege(spec.registration);
  await auth.reviewCollege(owner, registered.id, { decision: "approve", note: spec.note });
  await colleges.updateSettings(admin, { ...spec.settings, motto: spec.motto });

  // Registration derives the slug from the full name, which is right when nobody has
  // said otherwise but leaves /c/college-of-engineering-perumon on a poster. The short
  // handle is the one a college would actually pick, so the fixture names it and it
  // goes on through the same round trip as every other stored-field change here.
  const college = rebase(db.colleges, registered, { slug: spec.slug });

  const desks = new Map();
  for (const desk of spec.desks) desks.set(desk.code, await catalog.createDepartment(admin, desk));

  const cats = new Map();
  for (const { desk, ...attrs } of spec.categories) {
    cats.set(attrs.code, await catalog.createCategory(admin, { ...attrs, departmentId: desks.get(desk).id }));
  }

  const officers = [];
  for (const { desks: codes, pending, ...attrs } of spec.officers) {
    const officer = await auth.createOfficer(admin, {
      ...attrs, departmentIds: codes.map((code) => desks.get(code).id),
    });
    // A parked officer cannot work a report, so it never joins the roster the
    // driver picks desk replies from.
    if (pending) park(db, officer);
    else officers.push(officer);
  }
  return { college, admin, desks, cats, officers };
}

/**
 * Puts an officer the admin just created back to pending.
 *
 * There is no service call for this and there should not be: an approval that can
 * be quietly un-approved is not an approval. The approvals screen needs one row to
 * be worth looking at, so it goes through the same round trip as everything else
 * `rebase` is used for.
 */
const park = (db, account) => rebase(db.accounts, account, {
  status: ACCOUNT_STATUS.PENDING, reviewedBy: null, reviewedAt: null, reviewNote: "",
});

/** Whoever holds the desk the router chose, and the admin when nobody does. */
const deskFor = (ctx, departmentId) => ctx.officers
  .find((officer) => officer.isActive && officer.departmentIds.includes(departmentId)) ?? ctx.admin;

/**
 * Files one report exactly as the public form would, then lets people back it.
 *
 * Backing goes through the service rather than the entity so the priority policy
 * runs each time — which is how a report with thirty backers ends up urgent with a
 * line in its thread explaining why, instead of urgent for no stated reason.
 */
async function fileReport(ctx, spec) {
  const { complaints } = ctx.services;
  // A minority of reporters leave a way to be reached, and who may see it stays
  // their choice. Parents do it far more often than students.
  const contact = spec.who === "parent" && rand() < 0.7
    ? { sharing: CONTACT_SHARING.DEPARTMENT, channel: "phone", value: `0474 2${between(100000, 899999)}` }
    : spec.who === "faculty" && rand() < 0.5
      ? { sharing: CONTACT_SHARING.ADMIN_ONLY, channel: "email", value: `staff.${between(10, 99)}@${ctx.college.emailDomain}` }
      : null;

  const { report } = await complaints.file({
    collegeId: ctx.college.id,
    reporterKey: spec.who ?? "student",
    categoryId: spec.cat ? ctx.cats.get(spec.cat).id : null,
    title: spec.title,
    body: spec.body,
    wantsPublic: spec.pub !== false,
    location: spec.loc ?? "",
    occurredAt: spec.occ ? NOW - Math.round(spec.occ * DAY) : null,
    tags: spec.tags ?? [],
    passphrase: spec.pass ?? null,
    evidence: (spec.ev ?? []).map((name) => ({ name })),
    contact,
  });

  if (report.isPublic) {
    for (let i = 0; i < (spec.back ?? 0); i += 1) {
      await complaints.support(report.traceCode, `seed-backer-${report.traceCode}-${i}`);
    }
  }
  return report;
}

/**
 * Replays a thread and then walks the report to the status the fixture asks for.
 *
 * The order matters and is the order it happens in real life: people talk first and
 * the status follows what was said. Replying as the desk already moves a submitted
 * report to triaged and a question already parks it on the reporter, so the switch
 * below only has to close the gap the conversation left.
 */
async function work(ctx, report, spec) {
  const { complaints, threads } = ctx.services;
  const code = report.traceCode;
  const desk = deskFor(ctx, report.departmentId);

  for (const [kind, body] of spec.talk ?? []) {
    if (kind === "d") await threads.replyAsDesk(desk, code, body);
    else if (kind === "q") await threads.replyAsDesk(desk, code, body, { askReporter: true });
    else if (kind === "r") await threads.replyAsReporter(code, spec.pass ?? null, body);
    else if (kind === "n") await threads.note(desk, code, body);
  }

  // Escalation is the admin's act, not the desk's — the desk is what is being
  // escalated past.
  const escalate = (why) => complaints.escalate(ctx.admin, code, why);
  const move = (status, note) => complaints.changeStatus(desk, code, { status, note });
  // Repositories mutate in place, so the entity in hand is always current. Every
  // guard below reads it rather than assuming what the thread left behind: the
  // state machine throws on an illegal move and a fixture is not worth crashing on.
  const at = () => report.status;

  switch (spec.status) {
    case "submitted":
      break;
    case "triaged":
      if (at() === STATUS.SUBMITTED) await complaints.claim(desk, code);
      break;
    case "in_progress":
      if (at() !== STATUS.IN_PROGRESS) await move(STATUS.IN_PROGRESS, "Picked up by the desk.");
      break;
    case "awaiting_reporter":
      if (at() !== STATUS.AWAITING_REPORTER) await move(STATUS.AWAITING_REPORTER, "Waiting on the reporter.");
      break;
    case "escalated":
      await escalate(spec.escReason ?? "Past the window this desk was given, and the decision needed is above it.");
      break;
    case "resolved":
    case "closed":
      if (spec.esc) await escalate("Sent up on the way through: the desk could not close this on its own.");
      if (at() !== STATUS.IN_PROGRESS) await move(STATUS.IN_PROGRESS, "Being worked.");
      await move(STATUS.RESOLVED, "Done, and said so in the thread.");
      if (spec.status === "closed") await move(STATUS.CLOSED, "Closed after the review window.");
      break;
    case "declined":
      await complaints.changeStatus(desk, code, {
        status: STATUS.DECLINED,
        reason: spec.declineReason ?? "Not something this desk can act on. The reason is in the thread.",
      });
      break;
    case "withdrawn":
      await complaints.withdraw(code, spec.pass ?? null, spec.withdrawReason);
      break;
    default:
      throw new Error(`fixture asks for an unknown status: ${spec.status}`);
  }

  if (spec.rate) {
    const [score, note] = spec.rate;
    await complaints.rate(code, spec.pass ?? null, { score, note });
  }
  return report;
}

// ---- putting the past back on the record ------------------------------------------
//
// Everything above ran just now, so every timestamp in the store says "now". This is
// the one place that changes, and it is deliberately the only one: services stamp
// Date.now() because that is correct in production, so a demo that needs a ninety day
// history has to rewrite the clock afterwards rather than lie to the services about it.
//
// What is rewritten and why:
//   createdAt        when the fixture says it was filed
//   dueAt            for a report already closed out, the window it was actually
//                    given, measured from filing; for one still open, whatever puts
//                    `due` hours on the dashboard right now
//   resolvedAt       createdAt + hrs + pause, because resolutionMs subtracts the
//                    paused time back out — so `hrs` is what reaches the median
//   pausedAt         only for a report waiting on its reporter, set to when the wait
//                    began so the nudge sweep can see how long it has been
//   lastActivityAt   the last thing that happened, which is what the queue sorts on
//   messages         spread across the report's life, receipt pinned to filing
//
// Nothing here invents a status, a priority or a routing decision. Those came out of
// the services and are left exactly as they were.

async function applyTimeline(db, code, spec) {
  const report = db.complaints.byTraceCode(code);
  const created = NOW - Math.round((spec.days ?? 1) * DAY);
  // The window the router and the SLA policy settled on, read back rather than
  // recomputed here — the seed should not get a second opinion on it.
  const windowMs = report.dueAt === null ? null : report.dueAt - report.createdAt;
  const fromFiling = windowMs === null ? null : created + windowMs;
  const pausedMs = Math.round((spec.pause ?? 0) * HOUR);
  const patch = { createdAt: created, pausedMs, pausedAt: null };
  let last = created;

  if (spec.into) {
    // A duplicate is spotted soon after filing and never resolved, so it keeps a
    // closedAt and no resolution time. Leaving resolvedAt null is what keeps it out
    // of the median instead of counting as a three hour fix.
    patch.dueAt = fromFiling;
    patch.resolvedAt = null;
    patch.closedAt = created + 3 * HOUR;
    last = patch.closedAt;
  } else if (report.status === STATUS.RESOLVED || report.status === STATUS.CLOSED) {
    const resolved = created + Math.round((spec.hrs ?? 24) * HOUR) + pausedMs;
    patch.dueAt = fromFiling;
    patch.resolvedAt = resolved;
    patch.closedAt = report.status === STATUS.CLOSED ? Math.min(resolved + 5 * DAY, NOW - HOUR) : null;
    last = patch.closedAt ?? resolved;
  } else if (report.status === STATUS.AWAITING_REPORTER) {
    const since = NOW - Math.round((spec.idle ?? 1) * DAY);
    patch.pausedAt = since;
    // remainingMs adds the paused time back in when the clock restarts, so dueAt
    // has to be pulled back by the wait for `due` to still be true on resume.
    patch.dueAt = NOW + Math.round((spec.due ?? 24) * HOUR) - (NOW - since);
    last = since;
  } else if (!report.isOpen) {
    patch.dueAt = fromFiling;
    last = Math.min(created + Math.round((spec.hrs ?? between(3, 20)) * HOUR), NOW - HOUR);
  } else {
    // Still open with the clock running. `due` is what the dashboard shows, so it is
    // measured from now, not from filing.
    patch.dueAt = NOW + Math.round((spec.due ?? 24) * HOUR);
    last = Math.min(created + Math.round(between(2, 20) * HOUR), NOW - 20 * 60 * 1000);
  }

  const messages = db.messages.ofComplaint(code, { includeInternal: true });
  const filed = created + 20 * 1000;
  if (messages.length < 2) last = filed;
  const stamps = messages.map((_, i) => (i === 0
    ? filed
    : filed + Math.round(((last - filed) * i) / (messages.length - 1))));

  patch.lastActivityAt = last;
  patch.updatedAt = last;
  // A desk that never spoke never acknowledged anything, so a null stays null.
  patch.acknowledgedAt = report.acknowledgedAt === null ? null : stamps[1] ?? filed;

  rebase(db.complaints, report, patch);
  messages.forEach((message, i) => rebase(db.messages, message, { createdAt: stamps[i], updatedAt: stamps[i] }));
}

// ---- announcements -----------------------------------------------------------------

/**
 * Turns the titles a fixture cites into trace codes.
 *
 * Fixtures cite by wording because a trace code is generated at file time and cannot
 * be written down in advance. A prefix match is enough here and wrong anywhere else,
 * so it stays in the seed. AnnouncementService drops any code that is confidential,
 * merged away or another college's, so a citation that should not be public cannot
 * become one by being named here.
 */
const citeCodes = (db, collegeId, titles = []) => titles
  .map((wanted) => db.complaints.all()
    .find((report) => report.collegeId === collegeId && report.title.startsWith(wanted)))
  .filter(Boolean)
  .map((report) => report.traceCode);

/** Posts each update as the college admin, then puts it back in the past. */
async function postNews(services, db, ctx, news) {
  for (const spec of news) {
    const view = await services.announcements.post(ctx.admin, {
      title: spec.title,
      body: spec.body,
      pinned: spec.pinned ?? false,
      expiresInDays: spec.expires ?? null,
      linkedTraceCodes: citeCodes(db, ctx.college.id, spec.cite),
    });
    const created = NOW - Math.round(spec.days * DAY);
    rebase(db.announcements, db.announcements.require(view.id), {
      createdAt: created,
      updatedAt: created,
      // Measured from when it was posted, so a notice posted 34 days ago with a two
      // week life has already lapsed — which is what the expiry is there to show.
      expiresAt: spec.expires ? created + Math.round(spec.expires * DAY) : null,
    });
  }
}

// ---- one whole college -------------------------------------------------------------

/**
 * Registers a college, fills it, and hands back what was built.
 *
 * The three passes are separate for a reason. Everything is filed before anything is
 * merged, so a duplicate can name a report that had not been filed yet when its own
 * fixture was written. Everything is worked before any timeline is rewritten, because
 * `applyTimeline` spreads a thread across a report's life and needs the whole thread
 * to exist first.
 */
async function seedCollege(services, db, owner, spec, reports, news) {
  const built = await buildCollege(services, db, owner, spec);
  const ctx = { services, ...built };
  step(`${built.college.shortName}: approved, ${built.desks.size} desks, ${built.cats.size} categories, `
    + `${spec.officers.length} staff accounts`);

  const filed = [];
  const refs = new Map();
  for (const fixture of reports) {
    const report = await fileReport(ctx, fixture);
    if (fixture.ref) refs.set(fixture.ref, report.traceCode);
    filed.push([report, fixture]);
  }
  step(`${built.college.shortName}: ${filed.length} reports filed through the public form`);

  let merged = 0;
  for (const [report, fixture] of filed) {
    if (!fixture.into) { await work(ctx, report, fixture); continue; }
    const into = refs.get(fixture.into);
    if (!into) throw new Error(`fixture merges into an unknown ref: ${fixture.into}`);
    await services.complaints.merge(ctx.admin, report.traceCode, into);
    merged += 1;
  }
  step(`${built.college.shortName}: threads replayed, statuses walked, ${merged} duplicates merged`);

  await postNews(services, db, ctx, news);
  for (const [report, fixture] of filed) await applyTimeline(db, report.traceCode, fixture);
  step(`${built.college.shortName}: ${news.length} updates posted, ${filed.length} timelines put on the record`);
  return ctx;
}

// ---- credentials -------------------------------------------------------------------

const rule = (label) => `\n${label}\n${"-".repeat(Math.max(label.length, 60))}`;

function credentials(colleges) {
  const lines = [rule("Platform office — approves colleges, reads no report body")];
  lines.push(`  ${config.platformOwner.email}   ${config.platformOwner.password}   /ops`);
  for (const { college, spec } of colleges) {
    lines.push(rule(`${college.name} — /c/${college.slug}`));
    lines.push(`  ${spec.registration.adminEmail}   ${spec.registration.password}   admin`);
    for (const officer of spec.officers ?? []) {
      const desks = officer.desks.join(", ");
      lines.push(`  ${officer.email}   ${officer.password}   ${desks}${officer.pending ? "   [pending]" : ""}`);
    }
  }
  return lines.join("\n");
}

/** Trace codes worth having in hand, since a demo cannot guess one. */
function traceCodes(db, ctx) {
  const mine = db.complaints.all().filter((r) => r.collegeId === ctx.college.id);
  const locked = mine.find((r) => r.hasPassphrase && r.isOpen) ?? mine.find((r) => r.hasPassphrase);
  const open = mine.find((r) => r.isOpen && !r.hasPassphrase && r.isPublic);
  const late = mine.find((r) => r.isOverdue);
  const rows = [["an open report, no passphrase", open], ["overdue right now", late]];
  if (locked) rows.push(["locked — needs the passphrase from the fixture", locked]);
  return rows.filter(([, r]) => r).map(([label, r]) => `  ${r.traceCode}   ${label}`);
}

// ---- the run -----------------------------------------------------------------------

async function main() {
  const started = Date.now();
  const dir = config.paths.data;
  process.stdout.write(`\nTrustLine seed\n  data directory: ${dir}\n\n`);
  await wipe(dir);

  // The clock stays off. A live SLA sweep firing mid-seed would nudge reports whose
  // timelines have not been written yet, so it runs once at the end instead.
  const container = new Container();
  const { owner } = await container.boot({ startClock: false });
  const { services, db } = container;
  step("Data directory emptied, platform office account in place");

  const cep = await seedCollege(services, db, owner, CEP, CEP_REPORTS, CEP_NEWS);
  const gecb = await seedCollege(services, db, owner, GECB, GECB_REPORTS, GECB_NEWS);

  const extras = [];
  for (const cfg of KTU_COLLEGES) {
    const spec = makeKtuSpec(cfg);
    const built = await seedCollege(services, db, owner, spec, makeKtuReports(cfg), makeKtuNews(cfg));
    extras.push({ college: built.college, spec });
  }
  step(`KTU roster: ${extras.length} generated colleges approved and populated`);

  // Registered and left alone. These are the rows the platform review queue opens
  // on, and their admins cannot sign in until the platform office says so.
  const pendingColleges = [];
  for (const { registration } of [SNIT, ...KTU_PENDING]) {
    const { college } = await services.auth.registerCollege(registration);
    pendingColleges.push({ college, registration });
  }
  step(`${pendingColleges.length} colleges registered and left pending — the platform review queue has rows`);

  // Each of these comes back as the list of trace codes it touched, not a count.
  const swept = await services.sla.sweep();
  const n = (list) => (Array.isArray(list) ? list.length : list ?? 0);
  step(`SLA sweep: ${n(swept.escalated)} escalated, ${n(swept.nudged)} nudged, ${n(swept.closed)} auto-closed`);

  await container.shutdown();

  const counts = db.counts();
  process.stdout.write(`\n${steps.length} steps, ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  process.stdout.write(`${rule("On the record")}\n`);
  for (const [label, n] of Object.entries(counts)) {
    process.stdout.write(`  ${String(n).padStart(5)}  ${label}\n`);
  }
  process.stdout.write(`${credentials([
    { college: cep.college, spec: CEP },
    { college: gecb.college, spec: GECB },
    ...extras,
    ...pendingColleges.map(({ college, registration }) => ({ college, spec: { registration } })),
  ])}\n`);
  process.stdout.write(`${rule("Trace codes to try at /#/trace")}\n`);
  process.stdout.write(`${[...traceCodes(db, cep), ...traceCodes(db, gecb), ...traceCodes(db, extras[0])].join("\n")}\n`);
  process.stdout.write(`${rule("Next")}\n  npm start   then open http://localhost:${config.port}\n\n`);
}

main().catch((error) => {
  process.stderr.write(`\nSeed failed after ${steps.length} steps.\n${error.stack}\n\n`);
  process.exitCode = 1;
});
