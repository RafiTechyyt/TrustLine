// cookies.js — a five-line cookie reader.
//
// Express ships res.cookie() but not req.cookies, and pulling in cookie-parser
// for one header would break the "works with no npm install" promise.

export function cookies() {
  return function readCookies(req, _res, next) {
    const header = req.headers.cookie;
    if (!header) { req.cookies = {}; return next(); }
    const jar = {};
    for (const part of header.split(";")) {
      const eq = part.indexOf("=");
      if (eq < 1) continue;
      const key = part.slice(0, eq).trim();
      try {
        jar[key] = decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        jar[key] = part.slice(eq + 1).trim();
      }
    }
    req.cookies = jar;
    return next();
  };
}
