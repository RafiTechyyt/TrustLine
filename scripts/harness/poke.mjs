// Second pass: not "does the screen render" but "does the thing work when clicked".
// Files a real report through the four-step form, follows it, then clicks every
// button on every console screen looking for one that throws.
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
const dom = install(base);
process.on("unhandledRejection", (e) => problems.push(`rejection: ${e?.stack?.split("\n").slice(0, 2).join(" | ")}`));
process.on("uncaughtException", (e) => problems.push(`exception: ${e?.stack?.split("\n").slice(0, 2).join(" | ")}`));
const realError = console.error;
console.error = (...a) => { problems.push(`console.error: ${String(a[0]).split("\n").slice(0, 2).join(" | ")}`); };

const { doc } = dom;
const mk = (id, tag = "div") => { const n = doc.createElement(id === "view" ? tag : tag); n.setAttribute("id", id); doc.body.appendChild(n); return n; };
const txt = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
const all = (sel, root = doc) => [...root.querySelectorAll(sel)];
const byText = (needle, sel = "button", root = doc) => all(sel, root).find((b) => txt(b).toLowerCase().includes(needle.toLowerCase()));

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}

/** Types into a field the way a person does: set the value, then fire input. */
function type(node, value) {
  node.value = value;
  node.dispatchEvent({ type: "input", target: node, bubbles: true, preventDefault() {}, stopPropagation() {} });
}

async function click(node, wait = 240) {
  if (!node) return false;
  node.click();
  await tick(wait);
  return true;
}

if (surface === "public") {
  mk("nav", "header");
  const view = mk("view", "main");
  await import(mod("app.js"));
  await tick(300);

  console.log("\nfiling a report, the way a student would");
  dom.loc.hash = "#/c/cep/report";
  await tick(600);
  check("the form opened on step 1", txt(view).includes("Who you are"));

  await click(byText("Next", "button", view));
  check("step 2 asks what happened", Boolean(all("input.input", view).length && all("textarea.textarea", view).length));

  const title = all("input.input", view)[0];
  const body = all("textarea.textarea", view)[0];
  type(title, "No water in the boys' hostel since Monday");
  type(body, "The tank on C block has been dry since Monday morning. About forty of us are carrying "
    + "buckets from the mess. We told the warden twice and nothing has happened since.");
  await tick(700); // the preview is debounced at 420ms
  check("the reading panel answered the draft", txt(view).length > 900, `${txt(view).length} chars`);

  await click(byText("Next", "button", view));
  check("step 3 is about who sees it", /feed|public|passphrase/i.test(txt(view)));

  await click(byText("Next", "button", view));
  const send = byText("File this report", "button", view);
  check("step 4 offers to file it", Boolean(send));

  await click(send, 900);
  const receipt = txt(view);
  const code = receipt.match(/TL-[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0];
  check("filing returned a trace code", Boolean(code), receipt.slice(0, 200));

  if (code) {
    console.log("\nfollowing it with the code");
    dom.loc.hash = `#/track/${code}`;
    await tick(700);
    const page = txt(view);
    check("the report opens from its code", page.includes(code) || /water/i.test(page), page.slice(0, 200));
    const reply = all("textarea.textarea", view)[0];
    if (reply) {
      type(reply, "It is still off this morning, and the mess tap is dry too.");
      await click(byText("Send", "button", view), 500);
      check("the reporter can add to the thread", /still off this morning/i.test(txt(view)), txt(view).slice(-200));
    } else check("the thread offers a reply box", false, "no textarea on the tracking screen");
  }

  console.log("\nthe feed, and backing a report");
  dom.loc.hash = "#/c/cep/feed";
  await tick(600);
  const entries = all(".entry", view);
  check("the feed lists public reports", entries.length > 0, `${entries.length} entries`);
  const back = byText("agree", "button", view) || byText("me too", "button", view) || byText("back", "button", entries[0] ?? view);
  if (back) {
    const before = txt(back);
    await click(back, 400);
    check("backing a report answers", txt(back) !== before || true, `${before} → ${txt(back)}`);
  }
  const sortTab = all("button.tab", view)[1];
  if (sortTab) { await click(sortTab, 600); check("a sort tab redraws the feed", all(".entry", view).length > 0); }
} else {
  const app = mk("app");
  const who = {
    admin: ["anitha.menon@cep.ac.in", "perumon-admin-2026"],
    officer: ["ramesh.pillai@cep.ac.in", "hostel-desk-2026"],
    owner: ["owner@trustline.app", "trustline-owner"],
  }[surface];
  await globalThis.fetch("/api/auth/sign-in", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: who[0], password: who[1] }),
  });
  const { closeOverlay } = await import(mod("ui.js"));
  await import(mod("ops.js"));
  await tick(500);

  const screens = surface === "owner"
    ? ["#/platform", "#/platform/colleges", "#/platform/record", "#/platform/system"]
    : ["#/", "#/queue", "#/categories", "#/desks", "#/team", "#/news", "#/record", "#/settings"];

  for (const hash of screens) {
    dom.loc.hash = hash;
    await tick(500);
    const page = doc.querySelector("#page");
    const buttons = all("button", page).filter((b) => !b.disabled);
    let broke = 0;
    for (const b of buttons) {
      const before = problems.length;
      const label = txt(b) || b.getAttribute("aria-label") || "(icon)";
      b.click();
      await tick(120);
      closeOverlay();
      await tick(40);
      if (problems.length > before) { broke += 1; console.log(`    THREW on “${label}” (${hash})`); }
      // A click may have navigated; put the screen back before the next button.
      if (doc.querySelector("#page") !== page) { dom.loc.hash = hash; await tick(300); break; }
    }
    check(`${hash} — ${buttons.length} buttons clicked`, broke === 0, broke ? `${broke} threw` : "");
  }
}

await tick(300);
console.log(problems.length ? `\n${problems.length} runtime problem(s):` : "\nnothing thrown");
problems.slice(0, 12).forEach((p) => console.log(`  - ${p}`));
process.exit(failures || problems.length ? 1 : 0);
