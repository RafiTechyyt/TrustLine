import { Repository } from "./Repository.js";
import { AccountFactory } from "../core/accounts/AccountFactory.js";
import { ACCOUNT_STATUS, ROLES } from "../core/accounts/permissions.js";

/**
 * The one repository whose rows are polymorphic: the same file holds super
 * admins, college admins and department officers. `hydrate` is overridden to
 * delegate to the factory, so `all()` returns a mix of three classes and every
 * caller just uses the shared Account interface.
 */
export class AccountRepository extends Repository {
  static get filename() { return "accounts.json"; }
  static get entity() { return AccountFactory; }

  hydrate(row) { return AccountFactory.hydrate(row); }

  byEmail(email) {
    const wanted = String(email || "").trim().toLowerCase();
    return this.first((a) => a.email === wanted);
  }

  superAdmins() { return this.where((a) => a.role === ROLES.SUPER_ADMIN); }

  ofCollege(collegeId) {
    return this.where((a) => a.collegeId === collegeId).sort((a, b) => a.createdAt - b.createdAt);
  }

  admins(collegeId) {
    return this.where((a) => a.collegeId === collegeId && a.role === ROLES.COLLEGE_ADMIN);
  }

  officersOfDepartment(departmentId) {
    return this.where((a) => a.departmentIds.includes(departmentId) && a.isActive);
  }

  pendingReview() {
    return this.where((a) => a.status === ACCOUNT_STATUS.PENDING).sort((a, b) => a.createdAt - b.createdAt);
  }

  pendingForCollege(collegeId) {
    return this.where((a) => a.collegeId === collegeId && a.status === ACCOUNT_STATUS.PENDING);
  }
}
