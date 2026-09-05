import { Repository } from "./Repository.js";
import { College } from "../core/College.js";
import { COLLEGE_STATUS } from "../core/enums.js";

export class CollegeRepository extends Repository {
  static get filename() { return "colleges.json"; }
  static get entity() { return College; }

  bySlug(slug) { return this.first((c) => c.slug === slug); }
  byName(name) {
    const wanted = String(name || "").trim().toLowerCase();
    return this.first((c) => c.name.toLowerCase() === wanted);
  }

  live() { return this.where((c) => c.isLive).sort((a, b) => a.name.localeCompare(b.name)); }
  pending() { return this.where((c) => c.status === COLLEGE_STATUS.PENDING).sort((a, b) => a.createdAt - b.createdAt); }
}
