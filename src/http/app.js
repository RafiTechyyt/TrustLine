// app.js — builds the Express app around an already-booted container.
//
// The factory takes the container rather than creating one, which is what lets a
// test start an app over a throwaway data directory, and lets server.js decide
// whether the SLA clock should be ticking. Nothing in this file knows what a
// complaint is; it wires plumbing and hands off to the routers.

import express from "express";
import path from "node:path";
import { apiRoutes } from "./routes/index.js";
import { cookies } from "./middleware/cookies.js";
import { attachSession } from "./middleware/auth.js";
import { notFound, failures } from "./failures.js";
import { config } from "../config.js";

/**
 * Headers, hand-rolled because a helmet dependency would break the "clone and
 * run" promise. Two of these are load-bearing for anonymity rather than for
 * security in the usual sense:
 *
 *   Referrer-Policy: no-referrer — a reporter's page URL contains their trace
 *   code. Without this, clicking any outbound link hands that code to whoever
 *   they clicked through to.
 *
 *   no-store on /api — a trace response held in a shared cache is a report
 *   readable by the next person on that machine.
 */
function securityHeaders() {
  const csp = [
    "default-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "script-src 'self'",
    // Inline *attributes* only, for things like a bar's computed width. No CDN
    // stylesheet is ever loaded, so nothing external can arrive this way.
    "style-src 'self' 'unsafe-inline'",
  ].join("; ");

  return function headers(req, res, next) {
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    return next();
  };
}

export function createApp({ container }) {
  const app = express();
  app.disable("x-powered-by");
  // Hardens ETag away from the API: a 304 on /api/trace/... would be answered
  // from a cache that this app never got to see.
  app.set("etag", false);

  app.use(securityHeaders());
  app.use(express.json({ limit: config.limits.bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.limits.bodyLimit }));
  app.use(cookies());
  app.use(attachSession({ sessions: container.services.sessions }));

  app.use("/api", apiRoutes({
    container,
    services: container.services,
    db: container.db,
    bus: container.bus,
  }));

  // ---- the two browser surfaces -------------------------------------------

  app.use(express.static(config.paths.publicDir, {
    extensions: ["html"],
    setHeaders(res, filePath) {
      // The shells change on every deploy of a project like this; the assets
      // they pull in are versioned by name.
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    },
  }));

  /**
   * Client-side routing fallback. `/ops/...` is the staff console and `/...`
   * everything else is the public app — two separate documents rather than one
   * shell with a role check, so a reporter never downloads the desk UI and the
   * two surfaces can look nothing alike.
   */
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    if (!req.accepts("html")) return next();
    // A missing file under /assets/ is a missing file, not a route. Without this
    // a mistyped import answers 200 with the HTML shell, and the browser's
    // complaint is "unexpected token '<'" — which points nowhere near the typo.
    if (req.path.startsWith("/assets/")) return next();
    const shell = req.path === "/ops" || req.path.startsWith("/ops/") ? "ops.html" : "index.html";
    return res.sendFile(path.join(config.paths.publicDir, shell), (error) => {
      if (error) next();
    });
  });

  app.use(notFound());
  app.use(failures());

  return app;
}
