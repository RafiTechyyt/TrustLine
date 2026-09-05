// SessionService.js — signed cookie sessions, no library.
//
// The cookie holds a signed payload, not a database key, so there is no session
// table to grow. A revocation set covers the one case a stateless token cannot:
// signing out before the token expires.

import { config } from "../config.js";
import { signToken, readToken, randomSecret } from "../lib/crypto.js";
import { UnauthorizedError } from "../lib/errors.js";

export class SessionService {
  #accounts;
  #secret;
  #revoked = new Set();
  #ttlMs;
  #cookieName;

  constructor({ accounts, secret = config.session.secret, ttlMs = config.session.ttlMs } = {}) {
    this.#accounts = accounts;
    // No secret configured means a fresh one per boot: old cookies stop working,
    // which is the safe default rather than a hardcoded key in the repo.
    this.#secret = secret || randomSecret(48);
    this.#ttlMs = ttlMs;
    this.#cookieName = config.session.cookieName;
  }

  get cookieName() { return this.#cookieName; }
  get ttlMs() { return this.#ttlMs; }

  issue(account) {
    const now = Date.now();
    const payload = {
      sub: account.id,
      role: account.role,
      col: account.collegeId,
      jti: randomSecret(9),
      iat: now,
      exp: now + this.#ttlMs,
    };
    return { token: signToken(payload, this.#secret), expiresAt: payload.exp };
  }

  /** @returns {import("../core/accounts/Account.js").Account|null} */
  resolve(token) {
    const payload = readToken(token, this.#secret);
    if (!payload || this.#revoked.has(payload.jti)) return null;
    const account = this.#accounts.find(payload.sub);
    if (!account || !account.isActive) return null;
    // A role change or a transfer invalidates the cookie rather than silently
    // widening what it can reach.
    if (account.role !== payload.role || account.collegeId !== payload.col) return null;
    return account;
  }

  require(token) {
    const account = this.resolve(token);
    if (!account) throw new UnauthorizedError();
    return account;
  }

  revoke(token) {
    const payload = readToken(token, this.#secret);
    if (payload?.jti) this.#revoked.add(payload.jti);
    if (this.#revoked.size > 5000) this.#revoked.clear();
    return this;
  }

  cookieOptions({ clear = false } = {}) {
    return {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: config.env === "production",
      maxAge: clear ? 0 : this.#ttlMs,
    };
  }

  attach(res, account) {
    const { token, expiresAt } = this.issue(account);
    res.cookie(this.#cookieName, token, this.cookieOptions());
    return { expiresAt };
  }

  detach(res, token) {
    if (token) this.revoke(token);
    res.clearCookie(this.#cookieName, this.cookieOptions({ clear: true }));
    return this;
  }
}
