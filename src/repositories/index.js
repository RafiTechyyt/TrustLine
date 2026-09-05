// index.js — the repository container.
//
// One object holds every collection, and it is the single place that knows where
// the data lives. Moving TrustLine onto a real database means writing new
// Repository subclasses and changing the six `new` calls below — nothing in
// services, routes or views refers to a file path.

import { config } from "../config.js";
import { CollegeRepository } from "./CollegeRepository.js";
import { AccountRepository } from "./AccountRepository.js";
import { DepartmentRepository } from "./DepartmentRepository.js";
import { CategoryRepository } from "./CategoryRepository.js";
import { ComplaintRepository } from "./ComplaintRepository.js";
import { MessageRepository } from "./MessageRepository.js";
import { AuditRepository } from "./AuditRepository.js";
import { AnnouncementRepository } from "./AnnouncementRepository.js";

export class DataStore {
  #directory;
  #repos;

  constructor(directory = config.paths.data) {
    this.#directory = directory;
    this.#repos = Object.freeze({
      colleges: new CollegeRepository(directory),
      accounts: new AccountRepository(directory),
      departments: new DepartmentRepository(directory),
      categories: new CategoryRepository(directory),
      complaints: new ComplaintRepository(directory),
      messages: new MessageRepository(directory),
      audit: new AuditRepository(directory),
      announcements: new AnnouncementRepository(directory),
    });
  }

  get directory() { return this.#directory; }
  get colleges() { return this.#repos.colleges; }
  get accounts() { return this.#repos.accounts; }
  get departments() { return this.#repos.departments; }
  get categories() { return this.#repos.categories; }
  get complaints() { return this.#repos.complaints; }
  get messages() { return this.#repos.messages; }
  get audit() { return this.#repos.audit; }
  get announcements() { return this.#repos.announcements; }

  list() { return Object.values(this.#repos); }

  /** Loads every collection in parallel. Called once at boot. */
  async ready() {
    await Promise.all(this.list().map((repo) => repo.ready()));
    return this;
  }

  async flush() {
    await Promise.all(this.list().map((repo) => repo.flush()));
    return this;
  }

  /** Seed script only — never reachable from an HTTP route. */
  async truncateAll() {
    for (const repo of this.list()) await repo.truncate();
    return this;
  }

  counts() {
    return Object.fromEntries(this.list().map((repo) => [repo.label, repo.size()]));
  }
}

export {
  CollegeRepository, AccountRepository, DepartmentRepository, CategoryRepository,
  ComplaintRepository, MessageRepository, AuditRepository, AnnouncementRepository,
};
