// reporters.js — the concrete reporter kinds, plus a factory.
//
// Six subclasses, each overriding only what differs. `priorityFloor()` is the
// interesting one: same call site, six different answers.

import { Reporter } from "./Reporter.js";
import { PRIORITY } from "../enums.js";

const SAFETY = ["ragging", "harassment", "safety", "discrimination"];

export class StudentReporter extends Reporter {
  constructor() { super("student"); }
  get label() { return "Student"; }
  get blurb() { return "Currently studying here"; }
  get categoryHints() { return ["exam", "hostel", "mess", "lab", "wifi", "fee", "ragging"]; }
}

export class FacultyReporter extends Reporter {
  constructor() { super("faculty"); }
  get label() { return "Faculty"; }
  get blurb() { return "Teaching staff"; }
  get categoryHints() { return ["lab", "classroom", "administration", "workload", "equipment"]; }
}

export class StaffReporter extends Reporter {
  constructor() { super("staff"); }
  get label() { return "Non-teaching staff"; }
  get blurb() { return "Office, library, lab, maintenance, security"; }
  get categoryHints() { return ["administration", "salary", "maintenance", "safety"]; }
}

export class ResearchScholarReporter extends Reporter {
  constructor() { super("scholar"); }
  get label() { return "Research scholar"; }
  get blurb() { return "PhD or project staff"; }
  get categoryHints() { return ["lab", "stipend", "guide", "equipment", "library"]; }
}

export class ParentReporter extends Reporter {
  constructor() { super("parent"); }
  get label() { return "Parent or guardian"; }
  get blurb() { return "Raising something on behalf of a student"; }
  get categoryHints() { return ["safety", "ragging", "hostel", "fee", "transport"]; }

  /** A guardian rarely files about something small. Safety never sits in "low". */
  priorityFloor(category) {
    const text = `${category?.name ?? ""} ${(category?.keywords ?? []).join(" ")}`.toLowerCase();
    return SAFETY.some((word) => text.includes(word)) ? PRIORITY.HIGH : PRIORITY.NORMAL;
  }
}

export class VisitorReporter extends Reporter {
  constructor() { super("visitor"); }
  get label() { return "Visitor"; }
  get blurb() { return "Applicant, alumnus, vendor or guest"; }
  get categoryHints() { return ["administration", "admission", "campus", "transport"]; }
}

const REGISTRY = new Map([
  ["student", StudentReporter],
  ["faculty", FacultyReporter],
  ["staff", StaffReporter],
  ["scholar", ResearchScholarReporter],
  ["parent", ParentReporter],
  ["visitor", VisitorReporter],
]);

export class ReporterFactory {
  static create(key) {
    const Ctor = REGISTRY.get(String(key || "").toLowerCase()) || VisitorReporter;
    return new Ctor();
  }

  static get keys() { return [...REGISTRY.keys()]; }

  /** Everything the role picker needs, generated from the classes themselves. */
  static catalogue() {
    return ReporterFactory.keys.map((key) => {
      const reporter = ReporterFactory.create(key);
      return { key, label: reporter.label, blurb: reporter.blurb };
    });
  }
}
