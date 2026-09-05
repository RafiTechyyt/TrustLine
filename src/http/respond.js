// respond.js — the four lines every route handler would otherwise repeat.
//
// `route()` is the important one. Express 4 does not catch a rejected promise, so
// an `await` that throws inside a handler becomes an unhandled rejection and the
// request hangs forever. Wrapping every async handler once here means the whole
// error hierarchy in lib/errors.js reaches the error middleware, and no handler
// ever needs a try/catch.

/** @param {(req, res, next) => any} handler */
export const route = (handler) => function handle(req, res, next) {
  try {
    const result = handler(req, res, next);
    if (result && typeof result.then === "function") result.catch(next);
  } catch (error) {
    next(error);
  }
};

export const ok = (res, body) => res.json(body ?? { ok: true });
export const created = (res, body) => res.status(201).json(body);
export const gone = (res) => res.status(204).end();

/** Query strings arrive as strings; the services want real types. */
export const qs = {
  str(value, fallback = "") {
    const s = String(value ?? "").trim();
    return s || fallback;
  },
  int(value, fallback, { min = 0, max = 1000 } = {}) {
    const n = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  },
  bool(value, fallback = false) {
    if (value === undefined || value === "") return fallback;
    return value === "true" || value === "1" || value === true;
  },
  list(value) {
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    return String(value ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  },
};
