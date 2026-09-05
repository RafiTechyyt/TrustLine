import { Repository } from "./Repository.js";
import { Department } from "../core/Department.js";

export class DepartmentRepository extends Repository {
  static get filename() { return "departments.json"; }
  static get entity() { return Department; }

  ofCollege(collegeId, { includeInactive = false } = {}) {
    return this.where((d) => d.collegeId === collegeId && (includeInactive || d.active))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  byCode(collegeId, code) {
    return this.first((d) => d.collegeId === collegeId && d.code === code);
  }

  nextOrder(collegeId) {
    const rows = this.ofCollege(collegeId, { includeInactive: true });
    return rows.length === 0 ? 0 : Math.max(...rows.map((d) => d.order)) + 1;
  }
}
