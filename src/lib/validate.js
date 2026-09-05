// validate.js — a tiny chainable validator.
//
// Collects every problem before throwing so a form can highlight all of its
// bad fields at once instead of one per round trip.

import { ValidationError } from "./errors.js";

export class Check {
  #values = {};
  #problems = {};

  constructor(source = {}) {
    this.source = source && typeof source === "object" ? source : {};
  }

  #fail(field, message) {
    if (!this.#problems[field]) this.#problems[field] = message;
    return this;
  }

  text(field, { required = true, min = 1, max = 500, label = field, trim = true } = {}) {
    let raw = this.source[field];
    if (raw === undefined || raw === null) raw = "";
    if (typeof raw !== "string") raw = String(raw);
    const value = trim ? raw.trim() : raw;
    if (!value) {
      if (required) return this.#fail(field, `${label} is required`);
      this.#values[field] = "";
      return this;
    }
    if (value.length < min) return this.#fail(field, `${label} needs at least ${min} characters`);
    if (value.length > max) return this.#fail(field, `${label} must be under ${max} characters`);
    this.#values[field] = value;
    return this;
  }

  email(field = "email", { required = true } = {}) {
    const raw = String(this.source[field] ?? "").trim().toLowerCase();
    if (!raw) return required ? this.#fail(field, "Email is required") : this;
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(raw)) return this.#fail(field, "That email does not look right");
    this.#values[field] = raw;
    return this;
  }

  password(field = "password", { min = 8 } = {}) {
    const raw = String(this.source[field] ?? "");
    if (raw.length < min) return this.#fail(field, `Password needs at least ${min} characters`);
    if (!/[a-zA-Z]/.test(raw) || !/[0-9]/.test(raw)) {
      return this.#fail(field, "Password needs at least one letter and one number");
    }
    this.#values[field] = raw;
    return this;
  }

  oneOf(field, allowed, { required = true, label = field } = {}) {
    const raw = this.source[field];
    if (raw === undefined || raw === null || raw === "") {
      return required ? this.#fail(field, `${label} is required`) : this;
    }
    if (!allowed.includes(raw)) return this.#fail(field, `${label} must be one of: ${allowed.join(", ")}`);
    this.#values[field] = raw;
    return this;
  }

  bool(field, { fallback = false } = {}) {
    const raw = this.source[field];
    this.#values[field] = raw === true || raw === "true" || raw === 1 || raw === "1"
      ? true
      : raw === false || raw === "false" || raw === 0 || raw === "0" ? false : fallback;
    return this;
  }

  int(field, { min = 0, max = 100000, required = false, fallback = null, label = field } = {}) {
    const raw = this.source[field];
    if (raw === undefined || raw === null || raw === "") {
      if (required) return this.#fail(field, `${label} is required`);
      this.#values[field] = fallback;
      return this;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return this.#fail(field, `${label} must be a number`);
    if (n < min || n > max) return this.#fail(field, `${label} must be between ${min} and ${max}`);
    this.#values[field] = Math.round(n);
    return this;
  }

  list(field, { max = 40, itemMax = 40 } = {}) {
    const raw = this.source[field];
    const arr = Array.isArray(raw)
      ? raw
      : String(raw ?? "").split(",");
    this.#values[field] = arr
      .map((v) => String(v).trim().toLowerCase())
      .filter(Boolean)
      .map((v) => v.slice(0, itemMax))
      .slice(0, max);
    return this;
  }

  get problems() { return this.#problems; }
  get ok() { return Object.keys(this.#problems).length === 0; }

  /** @throws {ValidationError} */
  done() {
    if (!this.ok) {
      const first = Object.values(this.#problems)[0];
      throw new ValidationError(first, this.#problems);
    }
    return this.#values;
  }
}

export const check = (source) => new Check(source);
