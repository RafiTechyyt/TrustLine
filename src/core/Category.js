// Category.js — what a reporter picks, and the rule that decides where it goes.
//
// This is the object the college admin spends most of their time on: a category
// carries the department it routes to, the words that should auto-select it, who
// is allowed to use it, how urgent it starts, and how long the desk has.

import { Entity } from "./Entity.js";
import { PRIORITY, PRIORITY_RANK } from "./enums.js";
import { slugify } from "../lib/ids.js";

export class Category extends Entity {
  #collegeId; #name; #code; #description; #departmentId;
  #keywords; #audiences; #defaultPriority; #slaHours;
  #requireEvidence; #allowPublic; #confidential; #active; #order; #glyph;

  constructor({
    collegeId, name, code, description = "", departmentId = null,
    keywords = [], audiences = [], defaultPriority = PRIORITY.NORMAL, slaHours = null,
    requireEvidence = false, allowPublic = true, confidential = false,
    active = true, order = 0, glyph = "dot", ...base
  } = {}) {
    super(base);
    this.#collegeId = collegeId;
    this.#name = String(name || "").trim();
    this.#code = code || slugify(this.#name, "category");
    this.#description = String(description || "").trim();
    this.#departmentId = departmentId;
    this.#keywords = [...new Set((keywords || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean))];
    this.#audiences = [...new Set(audiences || [])];
    this.#defaultPriority = PRIORITY_RANK[defaultPriority] ? defaultPriority : PRIORITY.NORMAL;
    this.#slaHours = slaHours === null || slaHours === "" ? null : Number(slaHours);
    this.#requireEvidence = Boolean(requireEvidence);
    this.#allowPublic = Boolean(allowPublic);
    this.#confidential = Boolean(confidential);
    this.#active = Boolean(active);
    this.#order = Number(order) || 0;
    this.#glyph = glyph || "dot";
  }

  static get idPrefix() { return "cat"; }

  get collegeId() { return this.#collegeId; }
  get name() { return this.#name; }
  get code() { return this.#code; }
  get description() { return this.#description; }
  get departmentId() { return this.#departmentId; }
  get keywords() { return [...this.#keywords]; }
  get audiences() { return [...this.#audiences]; }
  get defaultPriority() { return this.#defaultPriority; }
  get slaHours() { return this.#slaHours; }
  get requireEvidence() { return this.#requireEvidence; }
  get allowPublic() { return this.#allowPublic; }
  /** Confidential categories never appear on the feed, whatever the reporter picks. */
  get confidential() { return this.#confidential; }
  get active() { return this.#active; }
  get order() { return this.#order; }
  get glyph() { return this.#glyph; }
  get isRouted() { return Boolean(this.#departmentId); }

  /** How strongly this category's words match some text. Used by auto-routing. */
  matchScore(text) {
    const haystack = String(text || "").toLowerCase();
    if (!haystack) return 0;
    let score = 0;
    if (this.#name && haystack.includes(this.#name.toLowerCase())) score += 3;
    for (const word of this.#keywords) {
      if (!word) continue;
      if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(haystack)) score += 2;
    }
    return score;
  }

  routeTo(departmentId) { this.#departmentId = departmentId || null; return this.touch(); }

  update(patch = {}) {
    const {
      name, code, description, departmentId, keywords, audiences, defaultPriority,
      slaHours, requireEvidence, allowPublic, confidential, active, order, glyph,
    } = patch;
    if (name) this.#name = String(name).trim();
    if (code !== undefined) this.#code = slugify(code, this.#code);
    if (description !== undefined) this.#description = String(description).trim();
    if (departmentId !== undefined) this.#departmentId = departmentId || null;
    if (keywords !== undefined) {
      this.#keywords = [...new Set((keywords || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean))].slice(0, 30);
    }
    if (audiences !== undefined) this.#audiences = [...new Set(audiences || [])];
    if (defaultPriority !== undefined && PRIORITY_RANK[defaultPriority]) this.#defaultPriority = defaultPriority;
    if (slaHours !== undefined) {
      this.#slaHours = slaHours === null || slaHours === "" ? null : Math.min(720, Math.max(1, Number(slaHours)));
    }
    if (requireEvidence !== undefined) this.#requireEvidence = Boolean(requireEvidence);
    if (allowPublic !== undefined) this.#allowPublic = Boolean(allowPublic);
    if (confidential !== undefined) this.#confidential = Boolean(confidential);
    if (active !== undefined) this.#active = Boolean(active);
    if (order !== undefined) this.#order = Number(order) || 0;
    if (glyph !== undefined) this.#glyph = glyph || "dot";
    return this.touch();
  }

  serialise() {
    return {
      collegeId: this.#collegeId, name: this.#name, code: this.#code,
      description: this.#description, departmentId: this.#departmentId,
      keywords: [...this.#keywords], audiences: [...this.#audiences],
      defaultPriority: this.#defaultPriority, slaHours: this.#slaHours,
      requireEvidence: this.#requireEvidence, allowPublic: this.#allowPublic,
      confidential: this.#confidential, active: this.#active,
      order: this.#order, glyph: this.#glyph,
    };
  }

  /** Shown on the report form. Routing target is deliberately not exposed. */
  publicView() {
    return {
      id: this.id, name: this.#name, code: this.#code, description: this.#description,
      audiences: [...this.#audiences], allowPublic: this.#allowPublic && !this.#confidential,
      confidential: this.#confidential, requireEvidence: this.#requireEvidence,
      glyph: this.#glyph, keywords: [...this.#keywords],
    };
  }
}
