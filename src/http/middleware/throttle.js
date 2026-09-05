// throttle.js — rate limiting middleware.
//
// The bucket key never contains a raw address. It is ephemeralKey(ip, scope),
// hashed with a salt that only exists in memory, so the limiter can recognise a
// repeat caller within the window and nothing after that.

import { limiter } from "../../security/RateLimiter.js";
import { ephemeralKey } from "../../lib/crypto.js";

function callerKey(req, scope) {
  const raw = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "local";
  return ephemeralKey(scope, raw);
}

/** @param {{windowMs:number,max:number}} rule */
export function throttle(rule, scope) {
  return function limit(req, res, next) {
    try {
      const { remaining, resetAt } = limiter.check(rule, callerKey(req, scope));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
      return next();
    } catch (error) {
      if (error.status === 429) res.setHeader("Retry-After", String(error.details.retryAfterSeconds));
      return next(error);
    }
  };
}

/** Lets the login route forgive a caller who eventually got it right. */
export function forgive(rule, scope, req) {
  limiter.clear(rule, callerKey(req, scope));
}
