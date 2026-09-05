// DepartmentOfficer.js — works one or more department queues.
//
// Sees only what has been routed to a department they hold. Cannot edit the
// category list, cannot add teammates, cannot read another department's queue
// even within the same college.

import { Account } from "./Account.js";
import { P, ROLES } from "./permissions.js";

export class DepartmentOfficer extends Account {
  static #PERMISSIONS = new Set([
    P.REPORTS_READ_ASSIGNED,
    P.REPORTS_STATUS_WRITE,
    P.REPORTS_REPLY,
    P.REPORTS_NOTE,
    P.REPORTS_ESCALATE,
    P.COLLEGE_ANALYTICS_READ,
    // Held so that a reporter who chose "share with the handling department" is
    // actually reachable. Sharing set to admin-only still stops here, because
    // contactFor() additionally requires REPORTS_READ_ALL for that level.
    P.REPORTS_CONTACT_VIEW,
  ]);

  get role() { return ROLES.DEPARTMENT_OFFICER; }
  static get permissions() { return DepartmentOfficer.#PERMISSIONS; }

  get scopeLabel() {
    const n = this.departmentIds.length;
    return n === 1 ? "one department queue" : `${n} department queues`;
  }

  canRead(report) {
    if (!report || report.collegeId !== this.collegeId) return false;
    return this.departmentIds.includes(report.departmentId);
  }
}
