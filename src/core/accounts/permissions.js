// permissions.js — every capability in the product, named once.
//
// Route handlers ask `account.can(P.REPORTS_STATUS_WRITE)` and never test the
// role directly. Adding a fourth kind of account later means writing one new
// subclass, not hunting for `role === "admin"` checks.

export const P = Object.freeze({
  // Platform office — approves who gets to run a college desk.
  PLATFORM_COLLEGES_REVIEW: "platform.colleges.review",
  PLATFORM_ADMINS_REVIEW: "platform.admins.review",
  PLATFORM_METRICS_READ: "platform.metrics.read",

  // College desk.
  COLLEGE_SETTINGS_WRITE: "college.settings.write",
  COLLEGE_CATALOG_WRITE: "college.catalog.write",
  COLLEGE_TEAM_MANAGE: "college.team.manage",
  COLLEGE_ANNOUNCE: "college.announce",
  COLLEGE_ANALYTICS_READ: "college.analytics.read",

  // Reports.
  REPORTS_READ_ALL: "reports.read.all",
  REPORTS_READ_ASSIGNED: "reports.read.assigned",
  REPORTS_ASSIGN: "reports.assign",
  REPORTS_STATUS_WRITE: "reports.status.write",
  REPORTS_REPLY: "reports.reply",
  REPORTS_NOTE: "reports.note",
  REPORTS_MERGE: "reports.merge",
  REPORTS_ESCALATE: "reports.escalate",
  REPORTS_EXPORT: "reports.export",

  // Seeing a contact detail a reporter chose to hand over. Held separately
  // from ordinary read access on purpose — it is the one thing in the system
  // that can point at a person.
  REPORTS_CONTACT_VIEW: "reports.contact.view",
});

export const ROLES = Object.freeze({
  SUPER_ADMIN: "SUPER_ADMIN",
  COLLEGE_ADMIN: "COLLEGE_ADMIN",
  DEPARTMENT_OFFICER: "DEPARTMENT_OFFICER",
});

export const ACCOUNT_STATUS = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  REJECTED: "rejected",
  SUSPENDED: "suspended",
});
