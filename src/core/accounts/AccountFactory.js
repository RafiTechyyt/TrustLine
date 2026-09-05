// AccountFactory.js — FACTORY PATTERN.
//
// One place that turns a role string into the right subclass. Repositories call
// `AccountFactory.hydrate(row)` and get back a real SuperAdmin / CollegeAdmin /
// DepartmentOfficer object with its own behaviour, not a plain data bag.

import { ROLES } from "./permissions.js";
import { SuperAdmin } from "./SuperAdmin.js";
import { CollegeAdmin } from "./CollegeAdmin.js";
import { DepartmentOfficer } from "./DepartmentOfficer.js";

const REGISTRY = new Map([
  [ROLES.SUPER_ADMIN, SuperAdmin],
  [ROLES.COLLEGE_ADMIN, CollegeAdmin],
  [ROLES.DEPARTMENT_OFFICER, DepartmentOfficer],
]);

export class AccountFactory {
  static classFor(role) {
    const Ctor = REGISTRY.get(role);
    if (!Ctor) throw new TypeError(`Unknown account role: ${role}`);
    return Ctor;
  }

  static create(role, attributes) {
    return new (AccountFactory.classFor(role))(attributes);
  }

  static hydrate(row) {
    return AccountFactory.create(row.role, row);
  }

  static get roles() { return [...REGISTRY.keys()]; }
}

export { SuperAdmin, CollegeAdmin, DepartmentOfficer };
