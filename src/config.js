// config.js — single source of truth for runtime knobs.
// Everything reads from here so nothing else in the codebase touches process.env.

import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function int(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = Object.freeze({
  env: process.env.NODE_ENV || "development",
  port: int(process.env.PORT, 3000),

  paths: Object.freeze({
    root,
    data: process.env.TRUSTLINE_DATA_DIR || path.join(root, "data"),
    uploads: process.env.TRUSTLINE_UPLOAD_DIR || path.join(root, "data", "evidence"),
    publicDir: path.join(root, "public"),
  }),

  // Session cookies are signed with this. A random secret means every restart
  // invalidates old sessions, which is the safe default for local dev.
  session: Object.freeze({
    secret: process.env.TRUSTLINE_SECRET || null, // null => generated at boot
    cookieName: "tl_session",
    ttlMs: int(process.env.TRUSTLINE_SESSION_HOURS, 12) * 60 * 60 * 1000,
  }),

  // The very first super-admin. Created on boot if no super-admin exists yet.
  platformOwner: Object.freeze({
    email: process.env.TRUSTLINE_OWNER_EMAIL || "owner@trustline.app",
    password: process.env.TRUSTLINE_OWNER_PASSWORD || "trustline-owner",
    name: process.env.TRUSTLINE_OWNER_NAME || "Platform Office",
  }),

  limits: Object.freeze({
    descriptionMax: 4000,
    titleMax: 140,
    messageMax: 2000,
    evidenceMaxBytes: int(process.env.TRUSTLINE_EVIDENCE_MAX_KB, 2048) * 1024,
    evidencePerReport: 3,
    bodyLimit: "8mb",
    // A reporter may insist a report is not fixed a few times. Past that the
    // thread is the right place to argue, not the status field.
    maxReopens: 3,
  }),

  // Requests per window, keyed by route family. Reporter routes are keyed by a
  // rotating salt rather than raw IP so we never persist an identifiable key.
  rateLimits: Object.freeze({
    report: { windowMs: 10 * 60 * 1000, max: 6 },
    login: { windowMs: 10 * 60 * 1000, max: 12 },
    support: { windowMs: 60 * 1000, max: 40 },
    thread: { windowMs: 60 * 1000, max: 30 },
  }),

  sla: Object.freeze({
    defaultHours: 72,
    urgentHours: 12,
    sweepIntervalMs: 60 * 1000,
    // A reopened report gets a fresh, shorter window: the desk already has the
    // context, so it should not get another three days.
    reopenHours: 48,
    // Resolved reports close themselves after this, leaving a window for the
    // reporter to say "no, it is still happening".
    autoCloseHours: 168,
  }),
});
