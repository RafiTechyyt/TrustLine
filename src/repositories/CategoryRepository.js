import { Repository } from "./Repository.js";
import { Category } from "../core/Category.js";

export class CategoryRepository extends Repository {
  static get filename() { return "categories.json"; }
  static get entity() { return Category; }

  ofCollege(collegeId, { includeInactive = false } = {}) {
    return this.where((c) => c.collegeId === collegeId && (includeInactive || c.active))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  byCode(collegeId, code) {
    return this.first((c) => c.collegeId === collegeId && c.code === code);
  }

  /** Categories with no desk behind them — the admin's to-do list. */
  unrouted(collegeId) {
    return this.ofCollege(collegeId).filter((c) => !c.isRouted);
  }

  usingDepartment(departmentId) {
    return this.where((c) => c.departmentId === departmentId);
  }

  nextOrder(collegeId) {
    const rows = this.ofCollege(collegeId, { includeInactive: true });
    return rows.length === 0 ? 0 : Math.max(...rows.map((c) => c.order)) + 1;
  }
}
