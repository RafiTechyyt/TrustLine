// Department.js — a desk that receives reports. Created by the college admin.

import { Entity } from "./Entity.js";
import { slugify } from "../lib/ids.js";

export class Department extends Entity {
  #collegeId; #name; #code; #description; #headName; #slaHours; #active; #order;

  constructor({
    collegeId, name, code, description = "", headName = "",
    slaHours = null, active = true, order = 0, ...base
  } = {}) {
    super(base);
    this.#collegeId = collegeId;
    this.#name = String(name || "").trim();
    this.#code = code || slugify(this.#name, "desk");
    this.#description = String(description || "").trim();
    this.#headName = String(headName || "").trim();
    this.#slaHours = slaHours === null || slaHours === "" ? null : Number(slaHours);
    this.#active = Boolean(active);
    this.#order = Number(order) || 0;
  }

  static get idPrefix() { return "dep"; }

  get collegeId() { return this.#collegeId; }
  get name() { return this.#name; }
  get code() { return this.#code; }
  get description() { return this.#description; }
  get headName() { return this.#headName; }
  get slaHours() { return this.#slaHours; }
  get active() { return this.#active; }
  get order() { return this.#order; }

  update({ name, code, description, headName, slaHours, active, order }) {
    if (name) { this.#name = String(name).trim(); }
    if (code !== undefined) this.#code = slugify(code, this.#code);
    if (description !== undefined) this.#description = String(description).trim();
    if (headName !== undefined) this.#headName = String(headName).trim();
    if (slaHours !== undefined) {
      this.#slaHours = slaHours === null || slaHours === "" ? null : Math.min(720, Math.max(1, Number(slaHours)));
    }
    if (active !== undefined) this.#active = Boolean(active);
    if (order !== undefined) this.#order = Number(order) || 0;
    return this.touch();
  }

  serialise() {
    return {
      collegeId: this.#collegeId, name: this.#name, code: this.#code,
      description: this.#description, headName: this.#headName,
      slaHours: this.#slaHours, active: this.#active, order: this.#order,
    };
  }
}
