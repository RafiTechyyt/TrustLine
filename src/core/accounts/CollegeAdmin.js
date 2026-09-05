// CollegeAdmin.js — runs one college's desk.
//
// Creates the categories, decides which department each category routes to,
// adds officers, and can see every report filed at that college — and nothing
// from any other college.

import { Account } from "./Account.js";
import { P, ROLES } from "./permissions.js";

export class CollegeAdmin extends Account {
  static #PERMISSIONS = new Set([
    P.COLLEGE_SETTINGS_WRITE,
    P.COLLEGE_CATALOG_WRITE,
    P.COLLEGE_TEAM_MANAGE,
    P.COLLEGE_ANNOUNCE,
    P.COLLEGE_ANALYTICS_READ,
    P.REPORTS_READ_ALL,
    P.REPORTS_ASSIGN,
    P.REPORTS_STATUS_WRITE,
    P.REPORTS_REPLY,
    P.REPORTS_NOTE,
    P.REPORTS_MERGE,
    P.REPORTS_ESCALATE,
    P.REPORTS_EXPORT,
    P.REPORTS_CONTACT_VIEW,
  ]);

  get role() { return ROLES.COLLEGE_ADMIN; }
  static get permissions() { return CollegeAdmin.#PERMISSIONS; }
  get scopeLabel() { return "every desk at your college"; }

  canRead(report) {
    return Boolean(report) && report.collegeId === this.collegeId;
  }
}
