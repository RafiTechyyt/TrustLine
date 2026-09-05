// failures.js — the two middlewares that end every request that went wrong.
//
// This is where the error hierarchy pays off: the handler never asks *which*
// error this is. It reads `.status` and `.toJSON()` off whatever was thrown, and
// AppError's subclasses have already decided what those mean. A ValidationError
// arrives as 422 with per-field details, an IllegalTransitionError as 409 with
// the two state labels, and anything that is not an AppError as a flat 500 with
// its message swallowed — because an unexpected message is as likely to contain
// a file path as anything useful to the caller.

import { AppError } from "../lib/errors.js";

/** Any /api path that matched no route. Static files are handled before this. */
export function notFound() {
  return function missing(req, res, next) {
    if (!req.path.startsWith("/api/")) return next();
    return res.status(404).json({ error: `No API route for ${req.method} ${req.path}`, code: "no_route" });
  };
}

export function failures({ log = console.error } = {}) {
  return function onError(error, req, res, _next) {
    if (res.headersSent) return res.end();

    if (error instanceof AppError) {
      // Expected refusals are not incidents. Only log the surprising half.
      if (error.status >= 500) log(`[${error.name}] ${req.method} ${req.path}`, error);
      return res.status(error.status).json(error.toJSON());
    }

    // Express's own body-parser errors arrive with a status already attached.
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ error: "That upload is too large", code: "payload_too_large" });
    }
    if (error instanceof SyntaxError && error.status === 400) {
      return res.status(400).json({ error: "That request body was not valid JSON", code: "bad_json" });
    }

    log(`[unhandled] ${req.method} ${req.path}`, error);
    return res.status(500).json({ error: "Something went wrong at our end", code: "internal_error" });
  };
}
