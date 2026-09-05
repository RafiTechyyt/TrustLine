import { Repository } from "./Repository.js";
import { Complaint } from "../core/Complaint.js";
import { PRIORITY_RANK } from "../core/enums.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;

export class ComplaintRepository extends Repository {
  static get filename() { return "complaints.json"; }
  static get entity() { return Complaint; }

  byTraceCode(code) { return this.find(code); }

  ofCollege(collegeId) { return this.where((c) => c.collegeId === collegeId); }

  openOfCollege(collegeId) { return this.ofCollege(collegeId).filter((c) => c.isOpen); }

  ofDepartment(departmentId) { return this.where((c) => c.departmentId === departmentId); }

  ofDepartments(ids) {
    const set = new Set(ids);
    return this.where((c) => set.has(c.departmentId));
  }

  /** Open queue depth per desk — feeds the LightestDeskStrategy. */
  openCountByDepartment(collegeId) {
    const counts = new Map();
    for (const report of this.openOfCollege(collegeId)) {
      counts.set(report.departmentId, (counts.get(report.departmentId) ?? 0) + 1);
    }
    return counts;
  }

  recentInCategory(collegeId, categoryId, since = Date.now() - WEEK) {
    return this.ofCollege(collegeId)
      .filter((c) => c.categoryId === categoryId && c.createdAt >= since).length;
  }

  /** The public feed: opted-in reports only, never a confidential category. */
  feed(collegeId, { confidentialCategoryIds = new Set(), sort = "hot", categoryId = null, status = null, query = "" } = {}) {
    let rows = this.ofCollege(collegeId).filter((c) => (
      c.isPublic && !c.mergedInto && !confidentialCategoryIds.has(c.categoryId)
    ));
    if (categoryId) rows = rows.filter((c) => c.categoryId === categoryId);
    if (status === "open") rows = rows.filter((c) => c.isOpen);
    if (status === "resolved") rows = rows.filter((c) => !c.isOpen);
    if (query) {
      const needle = query.toLowerCase();
      rows = rows.filter((c) => `${c.title} ${c.body} ${c.tags.join(" ")}`.toLowerCase().includes(needle));
    }
    return rows.sort(ComplaintRepository.sorter(sort));
  }

  static sorter(sort) {
    switch (sort) {
      case "new": return (a, b) => b.createdAt - a.createdAt;
      case "backed": return (a, b) => b.supportCount - a.supportCount || b.createdAt - a.createdAt;
      case "resolved": return (a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0);
      case "urgent": return (a, b) => b.priorityRank - a.priorityRank || b.createdAt - a.createdAt;
      case "hot":
      default:
        // Backing decays over a week, so a busy feed still shows new things.
        return (a, b) => ComplaintRepository.heat(b) - ComplaintRepository.heat(a);
    }
  }

  static heat(report) {
    const ageHours = (Date.now() - report.createdAt) / 3600000;
    return (report.supportCount + 1) / Math.pow(ageHours + 6, 0.7) + report.priorityRank * 0.08;
  }

  /** Ops queue with the filters the desk actually uses. */
  queue(scope, { status = null, priority = null, departmentId = null, categoryId = null,
    overdue = false, unassigned = false, query = "", sort = "urgent" } = {}) {
    let rows = scope;
    if (status === "open") rows = rows.filter((c) => c.isOpen);
    else if (status === "closed") rows = rows.filter((c) => !c.isOpen);
    else if (status) rows = rows.filter((c) => c.status === status);
    if (priority) rows = rows.filter((c) => c.priority === priority);
    if (departmentId) rows = rows.filter((c) => c.departmentId === departmentId);
    if (categoryId) rows = rows.filter((c) => c.categoryId === categoryId);
    if (overdue) rows = rows.filter((c) => c.isOverdue);
    if (unassigned) rows = rows.filter((c) => !c.assignedTo);
    if (query) {
      const needle = query.toLowerCase();
      rows = rows.filter((c) => `${c.traceCode} ${c.title} ${c.body} ${c.handle}`.toLowerCase().includes(needle));
    }
    return rows.sort(sort === "urgent"
      ? (a, b) => Number(b.isOverdue) - Number(a.isOverdue)
        || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
        || a.createdAt - b.createdAt
      : ComplaintRepository.sorter(sort));
  }

  /** Open reports whose response window has run out and that are not escalated yet. */
  breaching() {
    return this.where((c) => c.isOpen && !c.escalated && c.isOverdue);
  }

  /** Resolved reports old enough to close themselves. */
  closable(afterMs) {
    return this.where((c) => c.status === "resolved" && c.resolvedAt && Date.now() - c.resolvedAt > afterMs);
  }
}
