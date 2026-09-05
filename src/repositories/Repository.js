// Repository.js — abstract data access.
//
// Services only ever talk to repositories, and repositories only ever talk to a
// JsonStore. Swapping the whole product onto MongoDB or Postgres means writing
// one new subclass of this file and changing the container in index.js. No
// service, route or view would need to be touched — which is the entire point
// of putting an abstract class here instead of calling fs.readFile in a handler.

import { JsonStore } from "./JsonStore.js";
import { NotFoundError } from "../lib/errors.js";

export class Repository {
  #store;
  #entities = new Map();
  #ready = null;

  constructor(directory) {
    if (new.target === Repository) throw new TypeError("Repository is abstract");
    this.#store = new JsonStore(directory, new.target.filename);
  }

  /** @abstract File this collection lives in. */
  static get filename() { throw new Error("repository must define static filename"); }

  /** @abstract Class used to rebuild rows. Override `hydrate` for polymorphic rows. */
  static get entity() { throw new Error("repository must define static entity"); }

  /** Overridden by AccountRepository, which needs a factory instead of one class. */
  hydrate(row) { return this.constructor.entity.hydrate(row); }

  get store() { return this.#store; }
  get label() { return this.constructor.filename.replace(".json", ""); }

  async ready() {
    if (!this.#ready) {
      this.#ready = this.#store.load().then((rows) => {
        for (const row of rows) {
          try {
            const entity = this.hydrate(row);
            this.#entities.set(entity.id, entity);
          } catch (error) {
            console.warn(`[${this.label}] skipped an unreadable row: ${error.message}`);
          }
        }
      });
    }
    await this.#ready;
    return this;
  }

  #persist() {
    this.#store.replace([...this.#entities.values()].map((e) => e.toJSON()));
    return this;
  }

  // ---- reads --------------------------------------------------------------

  all() { return [...this.#entities.values()]; }
  size() { return this.#entities.size; }
  has(id) { return this.#entities.has(id); }
  find(id) { return this.#entities.get(id) ?? null; }

  require(id, label = this.label) {
    const found = this.find(id);
    if (!found) throw new NotFoundError(label);
    return found;
  }

  where(predicate) { return this.all().filter(predicate); }
  first(predicate) { return this.all().find(predicate) ?? null; }
  count(predicate) { return predicate ? this.where(predicate).length : this.#entities.size; }

  /** Groups by a key function — used all over the analytics service. */
  groupBy(keyFn, predicate = null) {
    const out = new Map();
    for (const entity of this.all()) {
      if (predicate && !predicate(entity)) continue;
      const key = keyFn(entity);
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(entity);
    }
    return out;
  }

  // ---- writes -------------------------------------------------------------

  insert(entity) {
    this.#entities.set(entity.id, entity);
    this.#persist();
    return entity;
  }

  insertMany(entities) {
    for (const entity of entities) this.#entities.set(entity.id, entity);
    this.#persist();
    return entities;
  }

  /** Entities are mutated in place, so saving is really just "persist now". */
  save(entity) {
    this.#entities.set(entity.id, entity);
    this.#persist();
    return entity;
  }

  remove(id) {
    const existed = this.#entities.delete(id);
    if (existed) this.#persist();
    return existed;
  }

  async flush() { await this.#store.flush(); return this; }

  /** Wipes the collection. Only the seed script uses this. */
  async truncate() {
    this.#entities.clear();
    this.#persist();
    await this.flush();
    return this;
  }
}
