// SuperAdmin.js — the platform office.
//
// Deliberately blind to report content. It decides which colleges and which
// college admins are allowed on the platform, and it can see counts, but
// `canRead()` returns false for every report in the system. Nobody at the
// platform level can read what a student wrote at some college.

import { Account } from "./Account.js";
import { P, ROLES } from "./permissions.js";

export class SuperAdmin extends Account {
  static #PERMISSIONS = new Set([
    P.PLATFORM_COLLEGES_REVIEW,
    P.PLATFORM_ADMINS_REVIEW,
    P.PLATFORM_METRICS_READ,
  ]);

  get role() { return ROLES.SUPER_ADMIN; }
  static get permissions() { return SuperAdmin.#PERMISSIONS; }
  get scopeLabel() { return "the whole platform, counts only"; }

  /** Always false. The platform office reviews accounts, not complaints. */
  canRead(_report) { return false; }
}
