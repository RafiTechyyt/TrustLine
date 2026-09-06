// server.js — start the thing.
//
// Boot order: the store loads, the platform owner is guaranteed to exist, the SLA
// clock starts, and only then does the port open. A request that arrived before
// the store had loaded would see an empty database, so the listen call waits.
//
//   npm start          → http://localhost:3000
//   npm run seed       → fills a demo college with a month of history
//   npm run smoke      → walks one report through every service, no HTTP

import { spawn } from "node:child_process";
import { boot } from "./src/services/index.js";
import { createApp } from "./src/http/app.js";
import { config } from "./src/config.js";

// Demo bootstrap: with TRUSTLINE_SEED_ON_BOOT=1 and an empty data directory the
// Kerala demo is rebuilt before the app starts. The store-only-seeds-when-empty
// guard is what keeps a deployed demo from wiping someone's additions on every
// redeploy — a redeploy resets an ephemeral disk but not the work that was filed
// against the last build if the directory survives.
if (process.env.TRUSTLINE_SEED_ON_BOOT === "1") {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  if (existsSync(join(config.paths.data, "colleges.json"))) {
    console.log("[seed-on-boot] data directory already has colleges — skipping the seed");
  } else {
    console.log("[seed-on-boot] empty data directory — rebuilding the KTU demo data…");
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["scripts/seed.js"], { stdio: "inherit" });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed on boot failed (exit ${code})`))));
    });
  }
}

const { container, owner } = await boot();
const app = createApp({ container });

const server = app.listen(config.port, () => {
  const url = `http://localhost:${config.port}`;
  const counts = container.db.counts();
  console.log([
    ``,
    `  TrustLine is up`,
    `    public site   ${url}`,
    `    staff console ${url}/ops`,
    `    api           ${url}/api/health`,
    ``,
    `    data          ${config.paths.data}`,
    `    colleges ${counts.colleges ?? 0} · accounts ${counts.accounts ?? 0} · reports ${counts.complaints ?? 0}`,
    `    platform office ${owner.email}`,
    ``,
  ].join("\n"));
});

/**
 * Flushing on the way out is what makes the JSON store safe to use like this.
 * Writes are coalesced, so up to a few hundred milliseconds of changes can be
 * sitting in memory when the signal arrives; shutdown() drains them before the
 * process is allowed to end.
 */
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n  ${signal} — flushing to disk…`);
  server.close();
  await container.shutdown();
  console.log(`  saved. bye.\n`);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (error) => {
  console.error("[unhandledRejection]", error);
});
