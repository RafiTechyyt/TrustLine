// Entity.js — the abstract root of every domain object.
//
// OOP notes for the write-up:
//  * ENCAPSULATION — id / createdAt / updatedAt live in `#` private fields.
//    Nothing outside this file can reassign an id, not even a subclass.
//  * ABSTRACTION — `Entity` refuses to be instantiated, and declares
//    `serialise()` as a contract subclasses must fill in.
//  * TEMPLATE METHOD — `toJSON()` is written once here and calls the
//    subclass's `serialise()`, so persistence always includes the base fields
//    in the same shape no matter which entity is being saved.

import { newId } from "../lib/ids.js";

export class Entity {
  #id;
  #createdAt;
  #updatedAt;

  constructor({ id, createdAt, updatedAt } = {}) {
    if (new.target === Entity) {
      throw new TypeError("Entity is abstract — instantiate one of its subclasses");
    }
    this.#id = id || newId(new.target.idPrefix ?? "ent");
    this.#createdAt = Number(createdAt) || Date.now();
    this.#updatedAt = Number(updatedAt) || this.#createdAt;
  }

  /** Subclasses override to prefix their generated ids, e.g. "cmp". */
  static get idPrefix() { return "ent"; }

  get id() { return this.#id; }
  get createdAt() { return this.#createdAt; }
  get updatedAt() { return this.#updatedAt; }
  get ageMs() { return Date.now() - this.#createdAt; }

  /** Marks the record as changed. Every mutator on every subclass ends here. */
  touch(at = Date.now()) {
    this.#updatedAt = at;
    return this;
  }

  /** @abstract Subclass-specific fields, without the base three. */
  serialise() {
    throw new Error(`${this.constructor.name} must implement serialise()`);
  }

  /** Template method — base shape + subclass shape, always in that order. */
  toJSON() {
    return {
      id: this.#id,
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
      ...this.serialise(),
    };
  }

  /**
   * Rebuilds an entity from stored JSON. Called as `Complaint.hydrate(row)`,
   * where `this` is the subclass, so one line here serves every repository.
   */
  static hydrate(raw) {
    return new this(raw);
  }

  equals(other) {
    return other instanceof Entity && other.id === this.#id;
  }
}
