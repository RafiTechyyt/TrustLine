// CatalogService.js — the college admin's routing table.
//
// This is the feature the whole product hangs on: an admin defines the desks at
// their college, then defines the complaint categories and points each one at a
// desk. Everything downstream — auto-routing, SLA windows, whether a category
// may appear on the public feed — is read off these two objects.
//
// Deleting is deliberately hard. A desk with reports on it can be deactivated
// but not removed, because a closed report must still be able to say where it
// went a year later.

import { Department } from "../core/Department.js";
import { Category } from "../core/Category.js";
import { P } from "../core/accounts/permissions.js";
import { EV } from "../core/events/EventBus.js";
import { ConflictError, ForbiddenError, ValidationError } from "../lib/errors.js";

export class CatalogService {
  #db;
  #bus;

  constructor({ db, bus }) {
    this.#db = db;
    this.#bus = bus;
  }

  // ---- departments --------------------------------------------------------

  async createDepartment(admin, { name, code, description = "", headName = "", slaHours = null }) {
    this.#requireCatalog(admin);
    if (!String(name || "").trim()) throw new ValidationError("A desk needs a name", { name: "required" });
    const existing = this.#db.departments.byCode(admin.collegeId, code);
    if (existing) throw new ConflictError(`A desk with the code ${existing.code} already exists`);

    const desk = new Department({
      collegeId: admin.collegeId, name, code, description, headName, slaHours,
      order: this.#db.departments.nextOrder(admin.collegeId),
    });
    this.#db.departments.insert(desk);
    await this.#db.departments.flush();
    this.#announce(admin, "department.created", desk.name);
    return desk;
  }

  async updateDepartment(admin, departmentId, patch) {
    this.#requireCatalog(admin);
    const desk = this.#owned(this.#db.departments, departmentId, admin, "Department");
    if (patch.code) {
      const clash = this.#db.departments.byCode(admin.collegeId, patch.code);
      if (clash && clash.id !== desk.id) throw new ConflictError("Another desk already uses that code");
    }
    if (patch.active === false) {
      const orphaned = this.#db.categories.usingDepartment(desk.id).filter((c) => c.active);
      if (orphaned.length > 0) {
        throw new ConflictError(
          `${orphaned.length} active categor${orphaned.length === 1 ? "y" : "ies"} still route here. Point them elsewhere first.`,
        );
      }
    }
    desk.update(patch);
    this.#db.departments.save(desk);
    await this.#db.departments.flush();
    this.#announce(admin, "department.updated", desk.name);
    return desk;
  }

  async deleteDepartment(admin, departmentId) {
    this.#requireCatalog(admin);
    const desk = this.#owned(this.#db.departments, departmentId, admin, "Department");
    const reports = this.#db.complaints.ofDepartment(desk.id).length;
    if (reports > 0) {
      throw new ConflictError(`${reports} report(s) went to this desk. Deactivate it instead so its history stays readable.`);
    }
    if (this.#db.categories.usingDepartment(desk.id).length > 0) {
      throw new ConflictError("Categories still route here. Point them elsewhere first.");
    }
    for (const officer of this.#db.accounts.officersOfDepartment(desk.id)) {
      officer.assignDepartments(officer.departmentIds.filter((id) => id !== desk.id));
      this.#db.accounts.save(officer);
    }
    this.#db.departments.remove(desk.id);
    await Promise.all([this.#db.departments.flush(), this.#db.accounts.flush()]);
    this.#announce(admin, "department.deleted", desk.name);
    return { removed: desk.id };
  }

  // ---- categories (the routing rules) -------------------------------------

  async createCategory(admin, attrs) {
    this.#requireCatalog(admin);
    if (!String(attrs?.name || "").trim()) throw new ValidationError("A category needs a name", { name: "required" });
    const clash = this.#db.categories.byCode(admin.collegeId, attrs.code);
    if (clash) throw new ConflictError(`A category with the code ${clash.code} already exists`);

    const category = new Category({
      ...attrs,
      collegeId: admin.collegeId,
      departmentId: attrs.departmentId ? this.#owned(this.#db.departments, attrs.departmentId, admin, "Department").id : null,
      order: attrs.order ?? this.#db.categories.nextOrder(admin.collegeId),
    });
    this.#db.categories.insert(category);
    await this.#db.categories.flush();
    this.#announce(admin, "category.created", category.name);
    return category;
  }

  async updateCategory(admin, categoryId, patch) {
    this.#requireCatalog(admin);
    const category = this.#owned(this.#db.categories, categoryId, admin, "Category");
    if (patch.code) {
      const clash = this.#db.categories.byCode(admin.collegeId, patch.code);
      if (clash && clash.id !== category.id) throw new ConflictError("Another category already uses that code");
    }
    if (patch.departmentId) this.#owned(this.#db.departments, patch.departmentId, admin, "Department");
    category.update(patch);
    this.#db.categories.save(category);
    await this.#db.categories.flush();
    this.#announce(admin, "category.updated", category.name);
    return category;
  }

  /** The one-click action on the categories board: point this category at a desk. */
  async routeCategory(admin, categoryId, departmentId) {
    this.#requireCatalog(admin);
    const category = this.#owned(this.#db.categories, categoryId, admin, "Category");
    const desk = departmentId ? this.#owned(this.#db.departments, departmentId, admin, "Department") : null;
    if (desk && !desk.active) throw new ValidationError("That desk is switched off", { departmentId: "inactive" });
    category.routeTo(desk?.id ?? null);
    this.#db.categories.save(category);
    await this.#db.categories.flush();
    this.#announce(admin, "category.routed", `${category.name} → ${desk?.name ?? "unrouted"}`);
    return category;
  }

  async reorderCategories(admin, orderedIds) {
    this.#requireCatalog(admin);
    orderedIds.forEach((id, index) => {
      const category = this.#db.categories.find(id);
      if (category && category.collegeId === admin.collegeId) {
        category.update({ order: index });
        this.#db.categories.save(category);
      }
    });
    await this.#db.categories.flush();
    return this.forAdmin(admin);
  }

  async deleteCategory(admin, categoryId) {
    this.#requireCatalog(admin);
    const category = this.#owned(this.#db.categories, categoryId, admin, "Category");
    const used = this.#db.complaints.ofCollege(admin.collegeId).filter((c) => c.categoryId === category.id).length;
    if (used > 0) throw new ConflictError(`${used} report(s) used this category. Switch it off instead.`);
    this.#db.categories.remove(category.id);
    await this.#db.categories.flush();
    this.#announce(admin, "category.deleted", category.name);
    return { removed: category.id };
  }

  // ---- projections --------------------------------------------------------

  /** What the report form sees: no routing targets, no unrouted categories. */
  forReporters(collegeId) {
    return this.#db.categories.ofCollege(collegeId)
      .filter((category) => category.isRouted)
      .map((category) => category.publicView());
  }

  /** The admin board: every category with its desk, its load and its warnings. */
  forAdmin(admin) {
    this.#requireCatalog(admin);
    const desks = this.#db.departments.ofCollege(admin.collegeId, { includeInactive: true });
    const deskById = new Map(desks.map((d) => [d.id, d]));
    const reports = this.#db.complaints.ofCollege(admin.collegeId);
    const countBy = (predicate) => reports.filter(predicate).length;

    return {
      departments: desks.map((desk) => ({
        ...desk.toJSON(),
        categoryCount: this.#db.categories.usingDepartment(desk.id).length,
        openCount: countBy((r) => r.departmentId === desk.id && r.isOpen),
        totalCount: countBy((r) => r.departmentId === desk.id),
        officers: this.#db.accounts.officersOfDepartment(desk.id).map((o) => ({ id: o.id, name: o.name })),
      })),
      categories: this.#db.categories.ofCollege(admin.collegeId, { includeInactive: true }).map((category) => ({
        ...category.toJSON(),
        departmentName: deskById.get(category.departmentId)?.name ?? null,
        deskInactive: Boolean(category.departmentId) && deskById.get(category.departmentId)?.active === false,
        unrouted: !category.isRouted,
        totalCount: countBy((r) => r.categoryId === category.id),
        openCount: countBy((r) => r.categoryId === category.id && r.isOpen),
      })),
      warnings: [
        ...this.#db.categories.unrouted(admin.collegeId).map((c) => ({
          kind: "unrouted", subject: c.name,
          message: `“${c.name}” has no desk behind it, so reporters cannot pick it yet.`,
        })),
        ...desks.filter((d) => d.active && this.#db.categories.usingDepartment(d.id).length === 0).map((d) => ({
          kind: "idle_desk", subject: d.name,
          message: `“${d.name}” is not the target of any category, so nothing will ever reach it.`,
        })),
      ],
    };
  }

  // ---- shared helpers -----------------------------------------------------

  #requireCatalog(admin) {
    if (!admin?.can(P.COLLEGE_CATALOG_WRITE)) throw new ForbiddenError("Only a college admin can edit the catalog");
  }

  #owned(repo, id, admin, label) {
    const row = repo.require(id, label);
    if (row.collegeId !== admin.collegeId) throw new ForbiddenError(`That ${label.toLowerCase()} belongs to another college`);
    return row;
  }

  #announce(admin, action, subject) {
    this.#bus.emit(EV.CATALOG_CHANGED, {
      collegeId: admin.collegeId, action, subject,
      actorId: admin.id, actorLabel: admin.name, actorRole: admin.role,
    });
  }
}
