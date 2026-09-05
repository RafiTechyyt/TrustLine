// errors.js — an error hierarchy, so route handlers never guess a status code.
//
// Inheritance doing real work: the HTTP layer catches AppError and reads
// .status / .code off whichever subclass was thrown, without knowing which one.

export class AppError extends Error {
  #status;
  #code;
  #details;

  constructor(message, { status = 500, code = "internal_error", details = null } = {}) {
    super(message);
    this.name = new.target.name;
    this.#status = status;
    this.#code = code;
    this.#details = details;
    Error.captureStackTrace?.(this, new.target);
  }

  get status() { return this.#status; }
  get code() { return this.#code; }
  get details() { return this.#details; }

  toJSON() {
    const body = { error: this.message, code: this.#code };
    if (this.#details) body.details = this.#details;
    return body;
  }
}

export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, { status: 422, code: "validation_failed", details });
  }
}

export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(`${what} not found`, { status: 404, code: "not_found" });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Sign in to continue") {
    super(message, { status: 401, code: "unauthorized" });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this") {
    super(message, { status: 403, code: "forbidden" });
  }
}

export class ConflictError extends AppError {
  constructor(message) {
    super(message, { status: 409, code: "conflict" });
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds) {
    super("Too many attempts. Try again shortly.", {
      status: 429,
      code: "rate_limited",
      details: { retryAfterSeconds },
    });
  }
}

export class IllegalTransitionError extends AppError {
  constructor(from, to) {
    super(`A report cannot move from ${from} to ${to}`, {
      status: 409,
      code: "illegal_transition",
      details: { from, to },
    });
  }
}
