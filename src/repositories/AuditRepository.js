import { Repository } from "./Repository.js";
import { AuditEvent } from "../core/AuditEvent.js";

export class AuditRepository extends Repository {
  static get filename() { return "audit.json"; }
  static get entity() { return AuditEvent; }

  ofCollege(collegeId, limit = 200) {
    return this.where((e) => e.collegeId === collegeId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  ofComplaint(complaintId) {
    return this.where((e) => e.complaintId === complaintId).sort((a, b) => a.createdAt - b.createdAt);
  }

  platform(limit = 200) {
    return this.all().sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  /** Keeps the log from growing without bound on a long-lived install. */
  trimTo(max = 5000) {
    const rows = this.all().sort((a, b) => b.createdAt - a.createdAt);
    for (const stale of rows.slice(max)) this.remove(stale.id);
    return this;
  }
}
