// anon.js — the closest thing TrustLine has to identifying a reporter.
//
// Two things need to tell one anonymous caller from another: "you have already
// backed this report" and "you filed this, so it is already backed once". Both
// need a key that is stable for a few minutes and useless forever after.
//
// So the key is a hash of the address under a salt that is generated at boot,
// lives only in memory, and is never written anywhere. It goes into the report's
// supporter list, which means the stored list cannot be turned back into a list
// of addresses even by someone holding the data directory — and after a restart,
// not even by us.

import { ephemeralKey } from "../../lib/crypto.js";

function callerAddress(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.socket?.remoteAddress
    || "local";
}

export function anonKey(scope = "reporter") {
  return function attachKey(req, _res, next) {
    req.anonKey = ephemeralKey(scope, callerAddress(req));
    return next();
  };
}
