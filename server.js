// server.js — start the thing.
//
// Boot order: the store loads, the platform owner is guaranteed to exist, the SLA
// clock starts, and only then does the port open. A request that arrived before
// the store had loaded would see an empty database, so the listen call waits.
//
//   npm start          → http://localhost:3000
//   npm run seed       → fills a demo college with a month of history
//   npm run smoke      → walks one report through every service, no HTTP

import { boot } from "./src/services/index.js";
import { createApp } from "./src/http/app.js";
import { config } from "./src/config.js";

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
