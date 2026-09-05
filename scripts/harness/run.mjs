// Boots the real front end in Node against a real server and walks every route,
// so a render that throws is caught here rather than shown to rafik as a blank page.
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { install, tick } from "./dom.mjs";

const base = process.env.BASE || "http://localhost:3333";
const surface = process.argv[2] || "public";
const here = dirname(fileURLToPath(import.meta.url));
const assets = process.env.ASSETS || resolve(here, "..", "..", "public", "assets");
/** Windows cannot `import("C:\\...")`; a module has to be addressed as a file URL. */
const mod = (file) => pathToFileURL(resolve(assets, file)).href;

const problems = [];
const note = (where, err) => problems.push(`${where}: ${err?.stack?.split("\n").slice(0, 3).join(" | ") ?? err}`);

const dom = install(base);
process.on("unhandledRejection", (e) => note("unhandled rejection", e));
process.on("uncaughtException", (e) => note("uncaught exception", e));

// console.error is how a real browser surfaces a swallowed render error.
const realError = console.error;
console.error = (...a) => { problems.push(`console.error: ${a.map(String).join(" ")}`); realError("      (console.error)", ...a); };

const { doc } = dom;
const mk = (id, tag = "div") => { const n = doc.createElement(tag); n.setAttribute("id", id); doc.body.appendChild(n); return n; };

async function signIn(email, password) {
  const res = await globalThis.fetch("/api/auth/sign-in", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
}

/** Sets the hash, lets the render settle, and reports what landed on screen. */
async function visit(label, hash, hostOf) {
  const before = problems.length;
  dom.loc.hash = hash;
  await tick(400);
  const host = typeof hostOf === "function" ? hostOf() : hostOf;
  const text = (host?.textContent ?? "").replace(/\s+/g, " ").trim();
  const bad = /That did not load|cannot reach the server|undefined|\bNaN\b|Invalid Date|\[object Object\]/.exec(text);
  const broke = problems.length > before;
  const flag = broke ? "THREW" : bad ? `BAD(${bad[0]})` : text.length < 60 ? "THIN" : "ok";
  console.log(`  ${flag.padEnd(22)} ${hash.padEnd(28)} ${String(text.length).padStart(6)}  ${label}`);
  if (flag !== "ok") console.log(`      → ${text.slice(0, 240)}`);
  return flag === "ok";
}

if (surface === "public") {
  const nav = mk("nav", "header");
  const view = mk("view", "main");
  console.log("\npublic surface");
  await import(mod("app.js"));
  await tick(400);
  console.log(`  boot                   ${view.textContent.trim().length} chars in #view, ${nav.textContent.trim().length} in #nav`);
  const routes = [
    ["home", "#/"], ["trace entry", "#/trace"], ["join", "#/join"], ["privacy", "#/privacy"],
    ["college page", "#/c/cep"], ["report form", "#/c/cep/report"], ["public feed", "#/c/cep/feed"],
    ["transparency", "#/c/cep/record"], ["second college", "#/c/gecb"], ["bad slug", "#/c/nope"],
    ["unknown route", "#/nowhere"], ["home again", "#/"],
  ];
  for (const [label, hash] of routes) await visit(label, hash, view);
} else {
  const app = mk("app");
  const pageOf = () => doc.querySelector("#page") ?? app;
  const who = {
    admin: ["anitha.menon@cep.ac.in", "perumon-admin-2026"],
    officer: ["ramesh.pillai@cep.ac.in", "hostel-desk-2026"],
    owner: ["owner@trustline.app", "trustline-owner"],
  }[surface];
  if (!who) throw new Error(`unknown surface ${surface}`);
  console.log(`\nops console as ${surface}`);
  await signIn(...who);
  await import(mod("ops.js"));
  await tick(500);
  console.log(`  boot                   ${app.textContent.trim().length} chars in #app`);
  const common = [
    ["dashboard", "#/"], ["queue", "#/queue"], ["categories", "#/categories"], ["desks", "#/desks"],
    ["team", "#/team"], ["news", "#/news"], ["record", "#/record"], ["log", "#/log"], ["settings", "#/settings"],
  ];
  const platform = [
    ["platform", "#/platform"], ["colleges", "#/platform/colleges"], ["record", "#/platform/record"],
    ["log", "#/platform/log"], ["system", "#/platform/system"],
  ];
  for (const [label, hash] of surface === "owner" ? platform : common) await visit(label, hash, pageOf);
  // A report drawer is the busiest render in the product, so it gets walked too.
  if (surface !== "owner") {
    const res = await globalThis.fetch("/api/desk/reports?limit=5");
    const code = (await res.json())?.reports?.[0]?.traceCode;
    if (code) await visit("report drawer", `#/report/${code}`, () => doc.querySelector(".sheet-panel"));
    else console.log("  NO REPORT              queue was empty for this account");
  }
}

await tick(200);
console.log(problems.length ? `\n${problems.length} runtime problem(s):` : "\nno runtime errors thrown");
problems.forEach((p) => console.log(`  - ${p}`));
process.exit(problems.length ? 1 : 0);
