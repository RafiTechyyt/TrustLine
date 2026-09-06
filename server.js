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

// Demo bootstrap: with TRUSTLINE_SEED_ON_BOOT=1 the Kerala demo is rebuilt when the
// data directory holds either nothing or only the seed's own incomplete earlier
// demo. The guard has two rules and both are what protects a live deployment:
//   - any college the seed does not own -> never touch it, the demo was already
//     extended or replaced by real use;
//   - otherwise seed only until the full roster (marker slug "gect") is present,
//     so a deploying instance that survived with just the first two-college demo
//     grows into the full KTU roster instead of staying half-built.
const SEED_ON_BOOT = {
  colleges: "colleges.json",
  // The slugs the seed owns: the fourteen populated colleges and the three it
  // registers as pending applicants. Anything else in the store is someone's work.
  owned: new Set([
    "cep", "cet", "gcek", "gecb", "gect", "cek", "rit", "mec", "tkm", "mace",
    "sahrdaya", "vidya", "fisat", "asiet",
    "sree-narayana-institute-of-technology", "government-engineering-college-wayanad",
    "nehru-college-of-engineering-and-research-centre",
  ]),
  marker: "gect",
};
if (process.env.TRUSTLINE_SEED_ON_BOOT === "1") {
  const { existsSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const collegesFile = join(config.paths.data, SEED_ON_BOOT.colleges);
  let shouldSeed = !existsSync(collegesFile);
  if (!shouldSeed) {
    const present = JSON.parse(readFileSync(collegesFile, "utf8")).map((c) => c.slug);
    const hasUnknown = present.some((slug) => !SEED_ON_BOOT.owned.has(slug));
    shouldSeed = !hasUnknown && !present.includes(SEED_ON_BOOT.marker);
  }
  if (!shouldSeed) {
    console.log("[seed-on-boot] data directory already holds the demo roster — skipping the seed");
  } else {
    console.log("[seed-on-boot] demo roster incomplete — rebuilding the KTU demo data…");
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
