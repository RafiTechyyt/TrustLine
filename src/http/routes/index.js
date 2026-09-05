// routes/index.js — the API's table of contents.
//
// Mount order encodes the access model, top to bottom: anonymous, then anonymous
// with a trace code, then a session, then a session with platform permissions.
// Reading this list should tell you who can reach what without opening a single
// route file.

import { Router } from "express";
import { publicRoutes } from "./publicRoutes.js";
import { reportRoutes } from "./reportRoutes.js";
import { traceRoutes } from "./traceRoutes.js";
import { authRoutes } from "./authRoutes.js";
import { deskRoutes } from "./deskRoutes.js";
import { adminRoutes } from "./adminRoutes.js";
import { platformRoutes } from "./platformRoutes.js";
import { liveRoutes } from "./liveRoutes.js";

export function apiRoutes(deps) {
  const api = Router();

  api.use("/", publicRoutes(deps));        // no account: colleges, feed, transparency
  api.use("/reports", reportRoutes(deps)); // no account: preview, file, back a report
  api.use("/trace", traceRoutes(deps));    // trace code + passphrase, no account
  api.use("/auth", authRoutes(deps));      // registration and sign-in
  api.use("/desk", deskRoutes(deps));      // session + report access
  api.use("/admin", adminRoutes(deps));    // session + college admin permissions
  api.use("/platform", platformRoutes(deps)); // session + platform permissions
  api.use("/live", liveRoutes(deps));      // session; SSE stream

  return api;
}
