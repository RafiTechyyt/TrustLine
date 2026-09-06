// ops.js — the staff console: one desk queue, one admin office, one platform office.
//
// The public site and this share ui.js and base.css entirely; what differs is the
// palette (ops.css) and the fact that everything here needs a session. So this file
// is only three things: a sign-in gate, a frame, and a page per job.
//
// Two rules run through all of it.
//
// A reply and an internal note are never the same control. They are different
// widths, different colours, in different sections, and the note carries a warning
// strip. Getting those two confused is the one mistake in this product that cannot
// be taken back, so the interface is built to make it hard rather than to make it
// compact.
//
// Nothing is enforced here. Every guard below — which links appear, which buttons a
// drawer offers, which statuses are in a dropdown — is a mirror of a decision the
// server already made and will make again on the request. The console hides what an
// account cannot do because showing it would be a lie; it is not what stops it.

import {
  api, ApiError, el, fill, $, $$, icon, fmt, pill, prio, clock, count, tally, fact,
  toast, failed, drawer, confirmAction, closeOverlay, blank, loading, debounce,
  copy, Router, markNav,
} from "./ui.js";
import { columns, bars, stack } from "./charts.js";

/* ---- state ---------------------------------------------------------------- */

// Who is signed in, and their college. Replaced wholesale on sign-in and sign-out
// rather than mutated, so no view can be holding half of a stale account.
let me = null;
let college = null;
let stream = null;

const router = new Router();
const app = () => $("#app");
const page = () => $("#page");

const can = (permission) => Boolean(me?.permissions?.includes(permission));
const P = {
  reviewColleges: "platform.colleges.review",
  metrics: "platform.metrics.read",
  settings: "college.settings.write",
  catalog: "college.catalog.write",
  team: "college.team.manage",
  announce: "college.announce",
  analytics: "college.analytics.read",
  readAll: "reports.read.all",
  readAssigned: "reports.read.assigned",
  assign: "reports.assign",
  status: "reports.status.write",
  reply: "reports.reply",
  note: "reports.note",
  merge: "reports.merge",
  escalate: "reports.escalate",
  contact: "reports.contact.view",
};

const isPlatform = () => can(P.reviewColleges) || (can(P.metrics) && !me?.collegeId);

/* ---- boot ----------------------------------------------------------------- */

/**
 * Asks who we are, then draws either the gate or the console. A 401 here is the
 * normal first visit, not an error, so it is not reported as one.
 */
async function boot() {
  try {
    const who = await api.get("/api/auth/me");
    signedIn(who);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { gate(); return; }
    fill(app(), el("div.shell.shell-narrow", { style: { paddingBlock: "72px" } },
      blank("The console cannot reach the server",
        "Nothing was signed out — the request itself did not complete. Reload once the server is back.",
        el("button.btn.btn-line", { type: "button", on: { click: () => location.reload() } }, "Reload"))));
  }
}

function signedIn(who) {
  me = who.account;
  college = who.college;
  frame(who.warnings ?? []);
  if (!location.hash) Router.go(isPlatform() ? "/platform" : "/", { replace: true });
  router.start();
  openStream();
}

/* ---- the gate ------------------------------------------------------------- */

/**
 * Sign-in, and deliberately nothing else. There is no "forgot password" because
 * there is no email service behind this and a link that goes nowhere is worse than
 * no link; a college admin resets an officer from the team screen, and the platform
 * office resets an admin. That is said on the screen rather than left to be guessed.
 */
function gate() {
  document.body.classList.remove("platform");
  const form = el("form.stack", { novalidate: true });
  const email = el("input.input", { type: "email", name: "email", autocomplete: "username", required: true, autofocus: true });
  const password = el("input.input", { type: "password", name: "password", autocomplete: "current-password", required: true });
  const submit = el("button.btn.btn-lg.btn-block", { type: "submit" }, "Sign in");

  form.append(
    el("label.field", {}, el("span.label", { text: "Work email" }), email),
    el("label.field", {}, el("span.label", { text: "Password" }), password),
    submit,
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.replaceChildren(document.createTextNode("Signing in…"));
    try {
      await api.post("/api/auth/sign-in", { email: email.value.trim(), password: password.value });
      const who = await api.get("/api/auth/me");
      toast(`Signed in as ${who.account.name}.`, "good");
      signedIn(who);
    } catch (err) {
      failed(err, "That sign-in did not go through.");
      submit.disabled = false;
      submit.replaceChildren(document.createTextNode("Sign in"));
      password.value = "";
      password.focus();
    }
  });

  fill(app(), el("div.shell.shell-narrow", { style: { paddingBlock: "clamp(48px, 9vh, 96px)" } },
    el("a.wordmark", { href: "/" },
      el("span.wordmark-marks", { "aria-hidden": "true" }, el("i"), el("i"), el("i"), el("i")),
      el("span.wordmark-name", { text: "TrustLine" })),
    el("div.gutter-top-lg.stack", {},
      el("h1", { text: "Staff console" }),
      el("p.lead-sm.measure", { text: "The desk side of the register. Sign in to see the reports routed to you, answer them, and change where new ones land." }),
      el("div.panel", {},
        el("div.panel-head", {}, el("span.panel-title", { text: "Sign in" })),
        el("div.panel-body", {}, form)),
      el("div.notice", {},
        el("div.notice-title", { text: "No account yet?" }),
        el("p.t-sm", { text: "A college registers once, and the platform office approves it. After that the college's own admin creates the desk officers — officers never sign themselves up, which is what keeps a stranger from reading a queue." }),
        el("p.t-sm.gutter-top", {}, el("a", { href: "/#/join", text: "Register a college" }), " · ",
          el("a", { href: "/", text: "Back to the public site" }))),
      el("p.t-xs.quiet", { text: "Lost a password: a college admin resets an officer from the team screen, and the platform office resets a college admin. Nothing is emailed, because nothing here has an email service behind it." }),
    )));
}

/* ---- the frame ------------------------------------------------------------ */

/**
 * The rail, the top bar and the one scrolling column the pages draw into.
 *
 * Built once per sign-in. Views replace `#page` and nothing else, so the ticker keeps
 * its stream and the rail keeps its counts while someone moves around.
 */
function frame(warnings) {
  document.body.classList.toggle("platform", isPlatform());
  const nav = el("nav.rail", { "aria-label": "Console" });
  fill(app(), el("div.console", {}, nav, el("div.work", {}, topbar(), el("main.page#page", { tabindex: "-1" }))));
  fill(nav, ...railGroups(), railFoot());
  if (warnings.length) queueMicrotask(() => warnings.forEach((w) => toast(w.message, "bad")));
}

const railLink = (href, glyph, label, badge = null) => el("a.rail-link", { href: `#${href}` },
  icon(glyph), el("span", { text: label }), badge);

function railGroups() {
  const brand = el("a.rail-brand", { href: isPlatform() ? "#/platform" : "#/" },
    el("span.wordmark-marks", { "aria-hidden": "true" }, el("i"), el("i"), el("i"), el("i")),
    el("span", {}, el("span.wordmark-name", { text: "TrustLine" }),
      el("span.rail-brand-sub", { text: isPlatform() ? "Platform office" : college?.shortName ?? "Console" })));

  if (isPlatform()) {
    return [brand, el("div.rail-group", {},
      el("div.rail-label", { text: "Platform office" }),
      railLink("/platform", "shield", "Review queue", el("span.rail-n#nav-review")),
      railLink("/platform/colleges", "layers", "Colleges"),
      railLink("/platform/record", "chart", "Across the network"),
      railLink("/platform/log", "note", "Audit log"),
      railLink("/platform/system", "spark", "System"))];
  }

  const desk = el("div.rail-group", {},
    el("div.rail-label", { text: "The desk" }),
    railLink("/", "chart", "Dashboard"),
    railLink("/queue", "inbox", "Queue", el("span.rail-n#nav-queue")),
    railLink("/queue?overdue=true", "clock", "Overdue", el("span.rail-n#nav-late")));

  const office = can(P.catalog) || can(P.team) || can(P.announce) || can(P.settings)
    ? el("div.rail-group", {},
      el("div.rail-label", { text: "Running the college" }),
      can(P.catalog) ? railLink("/categories", "route", "Categories & routing", el("span.rail-n#nav-unrouted")) : null,
      can(P.catalog) ? railLink("/desks", "desk", "Desks") : null,
      can(P.team) ? railLink("/team", "people", "Team", el("span.rail-n#nav-team")) : null,
      can(P.announce) ? railLink("/news", "megaphone", "Updates") : null,
      can(P.analytics) ? railLink("/record", "chart", "The record") : null,
      can(P.analytics) ? railLink("/log", "note", "Audit log") : null,
      can(P.settings) ? railLink("/settings", "shield", "Settings") : null)
    : null;

  return [brand, desk, office];
}

function railFoot() {
  return el("div.rail-foot.stack-tight", {},
    el("div", { text: me.scopeLabel ? `You see ${me.scopeLabel}.` : "" }),
    el("a", { href: "/", text: "Public site" }),
    el("button.btn.btn-quiet.btn-sm", { type: "button", on: { click: signOut } }, icon("out", "icon-sm"), "Sign out"));
}

async function signOut() {
  try { await api.post("/api/auth/sign-out"); } catch { /* the cookie is going either way */ }
  stream?.close();
  stream = null;
  me = null;
  college = null;
  roster.forget();
  location.hash = "";
  gate();
  toast("Signed out.", "good");
}

/* ---- top bar and ticker --------------------------------------------------- */

function topbar() {
  const initials = me.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return el("header.topbar", {},
    el("div", {}, el("h1#page-title", { text: "Dashboard" }), el("div.topbar-where#page-where")),
    el("div.ticker.push#ticker", { "aria-live": "off" },
      el("span.ticker-dot", { "aria-hidden": "true" }),
      el("span.ticker-text", { text: "Connecting to the live feed…" }),
      el("span.ticker-when")),
    el("div.who", {},
      el("span.who-mark", { text: initials || "?", "aria-hidden": "true" }),
      el("span", {}, el("span.who-name", { text: me.name }),
        el("span.who-role", { text: [me.title, college?.shortName].filter(Boolean).join(" · ") || roleLabel(me.role) }))));
}

const ROLE_LABEL = {
  SUPER_ADMIN: "Platform office", COLLEGE_ADMIN: "College admin", DEPARTMENT_OFFICER: "Desk officer",
};
const roleLabel = (role) => ROLE_LABEL[role] ?? role;

function head(title, where) {
  const t = $("#page-title");
  const w = $("#page-where");
  if (t) fill(t, title);
  if (w) fill(w, where ?? "");
  markNav($(".rail"), Router.path());
}

/**
 * The SSE stream. One line that replaces itself, plus a rolling history the
 * dashboard reads.
 *
 * A live event never redraws the page on its own. An officer mid-sentence in a reply
 * box does not want the report under them replaced because somebody else backed a
 * different one — so the ticker moves, the counts refresh, and the page is left alone.
 */
const history = [];
const listeners = new Set();
export const onLive = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function openStream() {
  stream?.close();
  stream = new EventSource("/api/live");
  const node = () => $("#ticker");

  stream.addEventListener("hello", () => node()?.classList.add("ticker-live"));
  stream.addEventListener("activity", (event) => {
    let item = null;
    try { item = JSON.parse(event.data); } catch { return; }
    history.unshift(item);
    if (history.length > 60) history.pop();
    paintTicker(item);
    refreshCounts();
    for (const fn of listeners) { try { fn(item); } catch (err) { console.error(err); } }
  });
  stream.addEventListener("error", () => {
    const n = node();
    if (!n) return;
    n.classList.remove("ticker-live");
    n.classList.add("ticker-down");
    fill($(".ticker-text", n), "Live feed dropped. Reconnecting…");
  });
}

function paintTicker(item) {
  const n = $("#ticker");
  if (!n) return;
  n.classList.remove("ticker-down");
  n.classList.add("ticker-live");
  fill($(".ticker-text", n), item.summary || item.event);
  fill($(".ticker-when", n), fmt.when(item.at));
}

/* ---- rail badges ---------------------------------------------------------- */

function badge(id, n, { alert = false } = {}) {
  const node = $(`#${id}`);
  if (!node) return;
  const total = Number(n) || 0;
  fill(node, total ? String(total) : "");
  node.closest(".rail-link")?.setAttribute("data-alert", String(alert && total > 0));
}

/**
 * Refreshes the numbers on the rail. Debounced because a burst of live events would
 * otherwise mean a request per event, and these are counts — a second late is fine.
 */
const refreshCounts = debounce(async () => {
  if (!me) return;
  try {
    if (isPlatform()) {
      const review = await api.get("/api/platform/review");
      badge("nav-review", review.colleges.length + review.accounts.length, { alert: true });
      return;
    }
    const { counts } = await api.get("/api/desk/reports?limit=1");
    badge("nav-queue", counts.open);
    badge("nav-late", counts.overdue, { alert: true });
    if (can(P.catalog)) {
      const catalog = await api.get("/api/admin/catalog");
      badge("nav-unrouted", catalog.warnings.length, { alert: true });
    }
    if (can(P.team)) {
      const { team } = await api.get("/api/admin/team");
      badge("nav-team", team.filter((m) => m.status === "pending").length, { alert: true });
    }
  } catch { /* a stale badge is not worth a toast */ }
}, 900);

/* ---- small shared pieces -------------------------------------------------- */

const panel = (title, body, foot = null, extra = null) => el("section.panel", {},
  el("div.panel-head", {}, el("span.panel-title", { text: title }), extra),
  body, foot);

const hours = (h) => (h === null || h === undefined ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h * 10) / 10} h` : `${Math.round(h / 24)} days`);
const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`);

/** A canvas chart with its caption, sized by class so the CSS owns the height. */
const chartBox = (height = "chart-h") => el(`div.chart.${height}`);

function legend(keys) {
  return el("div.chart-legend", {}, ...keys.map(({ name, tone }) => el(`span.chart-key${tone ? ".chart-key-" + tone : ""}`, {},
    el("i", { "aria-hidden": "true" }), el("span", { text: name }))));
}

/**
 * A table on the carbon surface. `.sheet` is the same component the public record
 * uses. A header written as "#Open" is a number column and gets right-aligned, which
 * saves every caller from spelling that out on both the th and the td.
 */
function sheet(headers, rows) {
  return el("table.sheet", {},
    el("thead", {}, el("tr", {}, ...headers.map((h) => {
      const num = String(h).startsWith("#");
      return el(`th${num ? ".sheet-num" : ""}`, { text: num ? String(h).slice(1) : h });
    }))),
    el("tbody", {}, ...rows));
}

const numCell = (v) => el("td.sheet-num", { text: v === null || v === undefined ? "—" : String(v) });

/* ---- the dashboard -------------------------------------------------------- */

/**
 * What an officer looks at first thing: how much is open, how much is late, and
 * whether the desk is closing reports faster than they arrive.
 *
 * The four figures across the top are the same `count()` component as the public
 * register, tally marks included. That is deliberate — a student and an officer are
 * looking at the same quantity and it should look the same in both places.
 */
async function viewDashboard() {
  head("Dashboard", college ? `${college.name} · ${college.place}` : "");
  fill(page(), loading(4));

  const [health, stats] = await Promise.all([
    api.get("/api/desk/health"),
    can(P.analytics) ? api.get("/api/admin/analytics?days=30").catch(() => null) : Promise.resolve(null),
  ]);

  const view = el("div.stack-loose");
  view.append(
    el("div.kpis", {},
      el("div.kpi", {}, count(health.open, "open right now"),
        el("div.kpi-delta", { text: `${health.dueSoon} due inside a day` })),
      el(`div.kpi${health.overdue ? ".kpi-late" : ""}`, {}, count(health.overdue, "past their window", { tone: "seal" }),
        el(`div.kpi-delta${health.overdue ? ".kpi-delta-up" : ""}`, { text: health.overdue ? "Late is late. These are the ones to open." : "Nothing is late." })),
      el("div.kpi", {}, count(health.escalated, "escalated", { tone: "seal" }),
        el("div.kpi-delta", { text: "Sent above the desk that had it" })),
      el("div.kpi", {}, count(health.onTimeRate ?? 0, "answered on time", { marks: false }),
        el("div.kpi-delta", { text: health.medianResolutionHours === null ? "Nothing closed yet" : `Median ${hours(health.medianResolutionHours)} to close` })),
    ),
    worstList(health.worst ?? []),
  );

  if (stats) view.append(dailyChart(stats), mixRow(stats), deskTable(stats.byDepartment));
  view.append(activityPanel());
  fill(page(), view);
  loadActivity();
}

/** The five latest reports past their window, straight to the drawer. */
function worstList(worst) {
  if (!worst.length) return null;
  return panel("Late, worst first",
    el("div.panel-body-tight", {}, el("div.queue-rows", {}, ...worst.map((row) => el("button.qrow.qrow-urgent", {
      type: "button", on: { click: () => openReport(row.traceCode) },
    },
      el("span.qrow-mark", { "aria-hidden": "true" }),
      el("span.qrow-code", { text: row.traceCode }),
      el("span.qrow-main", {}, el("span.qrow-title", { text: row.title }),
        el("span.qrow-meta", {}, el("span", { text: row.departmentName }))),
      el("span.qrow-who", { text: "" }),
      el("span", {}, el("span.pill.pill-overdue", { text: `${row.overdueHours} h late` })),
      el("span.qrow-unread", { text: "open it" }))))));
}

/** Filed against resolved, by day. The one chart that says whether the desk is winning. */
function dailyChart(stats) {
  const box = chartBox("chart-h");
  const body = el("div.panel-body", {}, box,
    legend([{ name: "Filed", tone: "" }, { name: "Closed", tone: "green" }]));
  queueMicrotask(() => columns(box, {
    rows: stats.daily.map((d) => ({ label: d.label, values: [d.filed, d.resolved] })),
    keys: [{ color: getComputedStyle(document.body).getPropertyValue("--ink").trim() },
      { color: getComputedStyle(document.body).getPropertyValue("--green").trim() }],
    empty: "Nothing filed in this window.",
  }));
  const headline = stats.headline;
  return panel(`Filed and closed, last ${stats.window.days} days`, body, null,
    el("span.t-xs.quiet", { text: headline.trend === null ? "" : `${headline.trend > 0 ? "+" : ""}${headline.trend}% against the window before` }));
}

/** Where the open pile sits, and how long closing takes when it happens. */
function mixRow(stats) {
  const openBox = chartBox("chart-h");
  const bandBox = chartBox("chart-h");
  queueMicrotask(() => {
    stack(openBox, {
      rows: stats.byStatus.filter((s) => s.count > 0).map((s) => ({
        label: s.label, value: s.count, tone: STATUS_TONE[s.tone] ?? "ink",
      })),
      empty: "Nothing on the books.",
    });
    bars(bandBox, {
      rows: stats.resolution.bands.map((b) => ({ label: b.label, value: b.count, tone: "green" })),
      empty: "Nothing closed yet, so there is no distribution to show.",
    });
  });
  return el("div.grid.grid-2", {},
    panel("Every report by status", el("div.panel-body", {}, openBox)),
    panel("How long closing took", el("div.panel-body", {}, bandBox,
      el("div.facts.gutter-top", {},
        fact("Median", hours(stats.resolution.median)),
        fact("Fastest", hours(stats.resolution.fastest)),
        fact("Slowest", hours(stats.resolution.slowest))))));
}

// The state machine's tone names, mapped onto the four colours the charts have.
const STATUS_TONE = { open: "indigo", warn: "amber", bad: "seal", good: "green", done: "ink", rest: "ink" };

/** Which desk is drowning. Sorted by open count by the server, and left that way. */
function deskTable(desks) {
  const rows = desks.filter((d) => d.total > 0).map((d) => el("tr", {},
    el("td", {}, el("div", { text: d.name }),
      el("div.t-xs.quiet", { text: `${d.officers} ${d.officers === 1 ? "officer" : "officers"}${d.active ? "" : " · desk switched off"}` })),
    numCell(d.open), numCell(d.overdue || null), numCell(d.total),
    el("td.sheet-num", { text: hours(d.medianHours) }),
    el("td.sheet-num", { text: pct(d.onTimeRate) })));
  return panel("By desk", el("div.panel-body-tight", {},
    rows.length ? sheet(["Desk", "#Open", "#Late", "#All time", "#Median", "#On time"], rows)
      : blank("No desk has had a report yet", "Once reports start arriving this is where the load shows up.")));
}

/* ---- the live activity list ------------------------------------------------ */

/**
 * The stream's history, for when the one-line ticker is not enough.
 *
 * It shows what happened, never what was said: LiveFeed builds these summaries from
 * event payloads and no complaint body is ever in one. Worth knowing before anyone
 * puts this screen on a projector during a demo.
 */
function activityPanel() {
  return panel("As it happens", el("div.panel-body-tight", {},
    el("div.feed-live#activity", {}, loading(3))), null,
    el("span.t-xs.quiet", { text: "What happened, not what was said" }));
}

function activityRows(items) {
  if (!items.length) return blank("Nothing yet", "Activity appears here the moment anything moves.");
  return items.map((item) => el("div.feed-live-item", {},
    el("span.feed-live-t", { text: shortTime(item.at) }),
    el("span", {}, el("span", { text: item.summary }),
      item.actorLabel ? el("span.t-xs.quiet", { text: ` — ${item.actorLabel}` }) : null)));
}

const shortTime = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Seeds the list from the server, then keeps it current from the stream. */
async function loadActivity() {
  const host = $("#activity");
  if (!host) return;
  try {
    const path = isPlatform() ? "/api/platform/activity?limit=40" : "/api/admin/activity?limit=30";
    const { activity } = await api.get(path);
    if (!history.length) history.push(...activity);
    fill(host, ...[activityRows(activity)].flat());
  } catch {
    fill(host, blank("Activity is not readable from this account", "The stream still runs; only the history needs the analytics permission."));
  }
  // Prepending keeps whatever the reader was looking at where it was.
  const stop = onLive((item) => {
    const live = $("#activity");
    if (!live) { stop(); return; }
    live.querySelector(".blank")?.remove();
    live.prepend(...[activityRows([item])].flat());
    while (live.children.length > 40) live.lastChild.remove();
  });
}

/* ---- the queue ------------------------------------------------------------- */

/* Filters live in the hash, so a desk can send another officer the exact screen
   they are looking at, and the back button behaves. Router.start() skips a re-run
   when only the query changed, so every filter change calls the view directly. */
const QUEUE_SORTS = [
  ["urgent", "Most urgent first"],
  ["new", "Newest first"],
  ["backed", "Most backed"],
];

const query = () => new URLSearchParams((location.hash.split("?")[1] || ""));

function setQuery(patch) {
  const q = query();
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "" || v === false) q.delete(k); else q.set(k, String(v));
  }
  const text = q.toString();
  Router.go(Router.path() + (text ? `?${text}` : ""), { replace: true });
  return q;
}

async function viewQueue({ title = "The queue", where = "Everything you can act on", preset = {} } = {}) {
  head(title, where);
  fill(page(), loading(4));
  const q = query();
  for (const [k, v] of Object.entries(preset)) if (!q.has(k)) q.set(k, v);

  let catalog = null;
  if (can(P.catalog)) catalog = await api.get("/api/admin/catalog").catch(() => null);

  const load = async () => {
    const rows = $("#queue-rows");
    if (rows) fill(rows, loading(3));
    try {
      const data = await api.get(`/api/desk/reports?${q.toString()}`);
      paintQueue(data, q, catalog, load);
    } catch (err) {
      failed(err, "The queue did not load.");
      fill(page(), blank("The queue did not load", err.message,
        el("button.btn.btn-sm", { type: "button", on: { click: load } }, "Try again")));
    }
  };
  await load();
}

/**
 * Counts, filters, rows. The tab counts come from `counts`, which the service
 * computes over the whole scope rather than the filtered page, so "6 overdue" keeps
 * meaning six overdue after you filter to one desk.
 */
function paintQueue(data, q, catalog, load) {
  const tabs = [
    ["Everything", {}, data.counts.total],
    ["Open", { status: "open" }, data.counts.open],
    ["Past the window", { overdue: "1", status: "open" }, data.counts.overdue],
    ["Nobody's yet", { unassigned: "1", status: "open" }, data.counts.unassigned],
    ["Waiting on the reporter", { status: "awaiting_reporter" }, data.counts.awaitingReporter],
    ["Escalated", { status: "escalated" }, data.counts.escalated],
  ];
  const active = (patch) => Object.entries(patch).every(([k, v]) => q.get(k) === v)
    && (Object.keys(patch).length > 0 || !q.get("status") && !q.get("overdue") && !q.get("unassigned"));

  fill(page(),
    el("div.tabs", { role: "tablist" }, ...tabs.map(([label, patch, n]) => el("button.tab", {
      type: "button", role: "tab", "aria-selected": String(active(patch)),
      on: { click: () => { setQuery({ status: null, overdue: null, unassigned: null, ...patch, offset: null }); viewQueue({ title: $("#page-title").textContent }); } },
    }, el("span", { text: label }), el("span.tab-n", { text: fmt.n(n) })))),
    queueFilters(q, catalog),
    el("div.queue", {},
      el("div.queue-head", {},
        el("span", { text: `${fmt.n(data.total)} matching` }),
        el("span.push.t-xs.quiet", { text: "Open a report to act on it" })),
      el("div.queue-rows#queue-rows", {}, ...queueRows(data.reports, load))),
    pager(data, q));
  loadUnread();
}

function queueRows(reports, load) {
  if (!reports.length) {
    return [el("div.qrow-empty", {}, blank("Nothing here",
      "Either this desk is clear or the filters are narrower than you meant."))];
  }
  return reports.map((report) => queueRow(report, load));
}

/**
 * One report. A whole button, because the only thing a row does is open the report —
 * every action that changes anything lives in the drawer, next to the words the
 * reporter wrote. Nobody should be able to resolve something from a list.
 */
function queueRow(report, load) {
  const urgency = report.isOverdue || report.priority === "urgent" ? "qrow-urgent"
    : report.priority === "high" ? "qrow-high" : "";
  return el(`button.qrow${urgency ? "." + urgency : ""}`, {
    type: "button", on: { click: () => openReport(report.traceCode, load) },
  },
    el("span.qrow-mark", { "aria-hidden": "true" }),
    el("span.qrow-code", { text: fmt.code(report.traceCode) }),
    el("span.qrow-main", {},
      el("span.qrow-title", { text: report.title }),
      el("span.qrow-meta", {},
        el("span", { text: report.categoryName }),
        el("span", { text: report.departmentName }),
        report.supportCount ? el("span", { text: `${report.supportCount} backing` }) : null,
        report.unreadFromReporter
          ? el("span.qrow-unread", { text: `${report.unreadFromReporter} new from reporter` })
          : null)),
    el("span.qrow-who", { text: report.assignedName || "Unclaimed" }),
    el("span.qrow-clock-cell", {}, report.isOpen
      ? clock({ remainingMs: report.remainingMs, windowMs: windowOf(report), overdue: report.isOverdue, paused: report.remainingMs === null })
      : el("span.t-xs.quiet", { text: fmt.when(report.resolvedAt || report.lastActivityAt) })),
    el("span", {}, pill(report.status, { label: report.statusLabel, tone: report.tone, flat: true })),
  );
}

/* The clock needs the length of the window to draw a bar, and the queue row only
   carries what is left of it. Derived from the due date and when it was filed, which
   is the same arithmetic the server did to set the due date in the first place. */
const windowOf = (report) => (report.dueAt ? Math.max(1, report.dueAt - report.createdAt) : 0);

/** Desk, category, priority and a search box. Every one of them writes to the hash. */
function queueFilters(q, catalog) {
  const rerun = () => viewQueue({ title: $("#page-title").textContent, where: $("#page-where").textContent });
  const pick = (name, label, options) => el("label.field", {},
    el("span.label", { text: label }),
    el("select.select", {
      value: q.get(name) || "",
      on: { change: (e) => { setQuery({ [name]: e.target.value, offset: null }); rerun(); } },
    }, ...[el("option", { value: "", text: label }), ...options.map((o) => el("option", { value: o.id, text: o.name }))]));

  const search = el("input.input", {
    type: "search", value: q.get("q") || "", placeholder: "Trace code, title or words in the report",
    on: { input: debounce((e) => { setQuery({ q: e.target.value, offset: null }); rerun(); }, 420) },
  });

  return el("div.filters", {},
    el("label.field", {}, el("span.label", { text: "Search" }), search),
    catalog ? pick("department", "Any desk", catalog.departments.map((d) => ({ id: d.id, name: d.name }))) : null,
    catalog ? pick("category", "Any category", catalog.categories.map((c) => ({ id: c.id, name: c.name }))) : null,
    pick("priority", "Any priority", [
      { id: "urgent", name: "Urgent" }, { id: "high", name: "High" },
      { id: "normal", name: "Normal" }, { id: "low", name: "Low" }]),
    el("label.field", {},
      el("span.label", { text: "Order" }),
      el("select.select", {
        value: q.get("sort") || "urgent",
        on: { change: (e) => { setQuery({ sort: e.target.value }); rerun(); } },
      }, ...QUEUE_SORTS.map(([id, name]) => el("option", { value: id, text: name })))),
    [...q.keys()].some((k) => k !== "sort")
      ? el("button.btn.btn-quiet.btn-sm", {
        type: "button",
        on: { click: () => { Router.go(Router.path(), { replace: true }); rerun(); } },
      }, icon("x"), "Clear filters")
      : null);
}

/** Paging, not infinite scroll: an officer who is working a list needs to keep their place. */
function pager({ total, reports }, q) {
  const limit = Number(q.get("limit")) || 40;
  const offset = Number(q.get("offset")) || 0;
  if (total <= limit) return null;
  const step = (to) => () => { setQuery({ offset: to || null }); viewQueue({ title: $("#page-title").textContent }); };
  return el("div.row.gutter-top", {},
    el("button.btn.btn-line.btn-sm", { type: "button", disabled: offset === 0, on: { click: step(Math.max(0, offset - limit)) } }, "Previous"),
    el("span.t-sm.quiet", { text: `${offset + 1}–${offset + reports.length} of ${fmt.n(total)}` }),
    el("button.btn.btn-line.btn-sm.push", { type: "button", disabled: offset + limit >= total, on: { click: step(offset + limit) } }, "Next"));
}

/** How many reporter replies are sitting unread across this desk's whole scope. */
async function loadUnread() {
  try {
    const { count: n } = await api.get("/api/desk/unread");
    if (!n) return;
    const host = $("#queue-rows")?.closest(".queue");
    host?.before(el("div.notice.notice-warn", {},
      el("span.notice-title", { text: `${n} reporter ${n === 1 ? "reply is" : "replies are"} unread` }),
      el("span", { text: "They are marked on the rows below. Opening a report marks its replies read." })));
  } catch { /* the badge is a nicety */ }
}

/* ---- the report drawer ----------------------------------------------------- */

/*
 * Everything a desk can do to a report happens in here, beside the words the person
 * wrote. Two rules hold the whole thing together:
 *
 *   · a reply and an internal note are different controls, in different sections,
 *     in different colours, and the note wears a warning strip. They are different
 *     acts and the interface must never let them be confused.
 *   · nothing here decides anything. The buttons offered are the transitions the
 *     server's state machine said were legal; a 409 is still possible and still
 *     handled, because the client's copy of the rules is only ever a mirror.
 */
async function openReport(code, after) {
  const body = el("div", {}, loading(5));
  const panel = drawer({
    title: `Report ${code}`,
    head: [el("span.drawer-code", { text: fmt.code(code) })],
    body: [body],
    onClose: () => { refreshCounts(); after?.(); },
  });

  const paint = async () => {
    try {
      const report = await api.get(`/api/desk/reports/${encodeURIComponent(code)}`);
      fill(panel.querySelector(".sheet-head .row"),
        el("span.drawer-code", { text: fmt.code(report.traceCode) }),
        pill(report.status, { label: report.statusLabel, tone: report.tone }),
        report.escalated ? pill("escalated", { label: "Escalated", tone: "bad", flat: true }) : null);
      fill(body, ...reportSections(report, paint));
    } catch (err) {
      fill(body, blank("That report did not open", failed(err, "It may have been merged away.")));
    }
  };
  await paint();
}

/** The drawer's contents, top to bottom in the order an officer reads them. */
function reportSections(report, reload) {
  return [
    actionBar(report, reload),
    mergedBanner(report),
    privacyBanner(report),
    el("div.drawer-sec", {},
      el("h2.t-md", { text: report.title }),
      el("div.qrow-meta.gutter-top", {},
        el("span", { text: report.categoryName }),
        el("span", { text: report.departmentName }),
        el("span", { text: `Filed ${fmt.date(report.createdAt)}` }),
        el("span", { text: report.reporter?.label || "Anonymous" })),
      el("p.entry-body.gutter-top", { text: report.body }),
      report.tags.length || can(P.note) ? tagRow(report, reload) : null),
    clockSection(report),
    factsSection(report),
    evidenceSection(report),
    threadSection(report),
    can(P.reply) ? replyBox(report, reload) : null,
    can(P.note) ? noteBox(report, reload) : null,
    routingSection(report, reload),
    duplicatesSection(report, reload),
    trailSection(report),
  ];
}

/** The moves the state machine allows, plus claim, escalate and priority. */
function actionBar(report, reload) {
  const act = (label, glyph, run, cls = "btn-line") => el(`button.btn.btn-sm.${cls}`, {
    type: "button",
    on: { click: async (e) => {
      e.target.disabled = true;
      try { await run(); await reload(); } catch (err) { if (!err?.skip) failed(err); e.target.disabled = false; }
    } },
  }, icon(glyph), label);

  const post = (path, payload) => api.post(`/api/desk/reports/${encodeURIComponent(report.traceCode)}${path}`, payload);
  const patch = (path, payload) => api.patch(`/api/desk/reports/${encodeURIComponent(report.traceCode)}${path}`, payload);

  return el("div.drawer-acts", {},
    can(P.status) && !report.assignedTo ? act("Claim it", "check", async () => {
      await post("/claim"); toast("Yours now.", "good");
    }, "btn-seal") : null,
    ...(can(P.status) ? report.transitions.map((t) => act(t.label, t.key === "resolved" ? "check" : "arrow", () => moveTo(report, t))) : []),
    can(P.escalate) && report.isOpen && !report.escalated ? act("Escalate", "flag", async () => {
      const reason = await confirmAction({
        title: "Escalate this report", danger: true, confirmLabel: "Escalate",
        note: "Escalation is visible to the reporter and to your admin. Say why.",
        needs: { label: "Reason", placeholder: "Needs the principal's office" },
      });
      if (reason === null) throw new SkipError();
      await post("/escalate", { reason });
      toast("Escalated.", "good");
    }) : null,
    can(P.status) ? priorityPicker(report, reload) : null,
    can(P.assign) && report.isOpen ? act("Move desk…", "route", () => moveDesk(report)) : null,
    can(P.assign) && report.isOpen ? act("Hand over…", "people", () => assignTo(report)) : null,
    can(P.merge) && report.isOpen && !report.mergedInto ? act("Merge into…", "merge", () => mergeInto(report)) : null,
    el("button.btn.btn-quiet.btn-sm.push", {
      type: "button", on: { click: () => copy(report.traceCode, "Trace code copied.") },
    }, icon("copy"), "Copy code"));
}

/** Thrown when a confirm was dismissed, so the caller stops without a toast. */
class SkipError extends Error { constructor() { super("cancelled"); this.skip = true; } }

/**
 * The desks, fetched once and kept.
 *
 * Only a college admin holds `reports.assign`, and an admin also holds catalog
 * permission, so this read is safe behind the same gate. It is cached because
 * moving three misrouted reports in a row should not fetch the same desk list
 * three times — and every desk arrives with its own active officers, which is
 * exactly the in-scope list the assign route will accept.
 */
const roster = {
  board: null,
  async desks() {
    if (!this.board) this.board = (await api.get("/api/admin/catalog")).departments ?? [];
    return this.board.filter((d) => d.active);
  },
  forget() { this.board = null; },
};

/** Manual override of the router. The receiving desk gets a fresh response window. */
async function moveDesk(report) {
  const desks = (await roster.desks()).filter((d) => d.id !== report.departmentId);
  if (!desks.length) {
    toast("There is no other desk switched on to move this to.", "bad");
    throw new SkipError();
  }
  const departmentId = await confirmAction({
    title: "Move this to another desk",
    confirmLabel: "Move it",
    note: "The new desk starts its response clock from now — it has not had its chance yet, so it does not inherit one that already ran out. Whoever holds the report is released if the move takes it out of their scope.",
    needs: { label: "Desk", options: desks.map((d) => [d.id, d.name]) },
  });
  if (!departmentId) throw new SkipError();
  await api.post(`/api/desk/reports/${encodeURIComponent(report.traceCode)}/route`, {
    departmentId, reason: "Moved by hand from the console",
  });
  toast(`Moved to ${desks.find((d) => d.id === departmentId)?.name ?? "the new desk"}.`, "good");
}

/** Handing a report to a named person, or taking it back off them. */
async function assignTo(report) {
  const desk = (await roster.desks()).find((d) => d.id === report.departmentId);
  const officers = (desk?.officers ?? []).filter((o) => o.id !== report.assignedTo);
  if (!officers.length) {
    toast(`Nobody else active holds ${desk?.name ?? "this desk"}. Add an officer to it under Team.`, "bad");
    throw new SkipError();
  }
  const officerId = await confirmAction({
    title: "Hand this to someone",
    confirmLabel: "Hand it over",
    note: "Only people whose desks include this report can be given it. It shows up in their queue as theirs, and the response clock keeps running.",
    needs: {
      label: "Who takes it",
      options: [
        ...officers.map((o) => [o.id, o.name]),
        ...(report.assignedTo ? [["", "Nobody — put it back in the queue"]] : []),
      ],
    },
  });
  if (officerId === null) throw new SkipError();
  await api.post(`/api/desk/reports/${encodeURIComponent(report.traceCode)}/assign`, { officerId });
  toast(officerId ? `Now ${officers.find((o) => o.id === officerId)?.name}'s.` : "Back in the queue.", "good");
}

/**
 * A status move, with the note that goes with it.
 *
 * "Waiting for you" and "Not taken forward" both change what the reporter sees, so
 * both ask for words first. Resolving asks too, because a report that closes with
 * nothing written is the single most common way a reporter loses faith in the system.
 */
async function moveTo(report, transition) {
  const talky = ["awaiting_reporter", "declined", "resolved", "closed"].includes(transition.key);
  const note = talky
    ? await confirmAction({
      title: transition.label,
      note: transition.key === "awaiting_reporter"
        ? "This stops the response clock and asks the reporter for something. Say what you need."
        : "The reporter reads this. One or two sentences is plenty.",
      confirmLabel: transition.label,
      needs: { label: "What the reporter will read", placeholder: "We replaced the fitting this morning." },
    })
    : "";
  if (note === null) throw new SkipError();
  await api.patch(`/api/desk/reports/${encodeURIComponent(report.traceCode)}/status`, { status: transition.key, note });
  toast(`Now ${transition.label.toLowerCase()}.`, "good");
}

/** Raising priority is free; the server refuses to go under the floor a reporter's situation sets. */
function priorityPicker(report, reload) {
  return el("label.field", {},
    el("span.sr", { text: "Priority" }),
    el("select.select", {
      value: report.priority,
      on: { change: async (e) => {
        const priority = e.target.value;
        try {
          await api.patch(`/api/desk/reports/${encodeURIComponent(report.traceCode)}/priority`, { priority, reason: "Set from the desk" });
          toast(`Priority is ${priority}.`, "good");
          await reload();
        } catch (err) { failed(err); e.target.value = report.priority; }
      } },
    }, ...["low", "normal", "high", "urgent"].map((key) => el("option", { value: key, text: `Priority: ${key}` }))));
}

/** Folding one report into another. Irreversible, so it asks for the code by hand. */
async function mergeInto(report) {
  const into = await confirmAction({
    title: "Merge this into another report", danger: true, confirmLabel: "Merge",
    note: "The duplicate closes and its backing moves across. Its trace code keeps working and shows the reporter the report it joined. This cannot be undone.",
    needs: { label: "Trace code of the report to keep", placeholder: "TL-XXXX-XXXX" },
  });
  if (!into) throw new SkipError();
  await api.post(`/api/desk/reports/${encodeURIComponent(report.traceCode)}/merge`, { into: into.trim().toUpperCase() });
  toast("Merged.", "good");
}

/** Where a merged report says so, in both directions. */
function mergedBanner(report) {
  if (report.mergedInto) {
    return el("div.drawer-sec", {}, el("div.notice", {},
      el("span.notice-title", { text: "This one was folded into another report" }),
      el("span", { text: `${fmt.code(report.mergedInto)} — ${report.mergedIntoTitle ?? "the report it joined"}` })));
  }
  if (!report.absorbed?.length) return null;
  return el("div.drawer-sec", {}, el("div.notice", {},
    el("span.notice-title", { text: `${report.absorbed.length} duplicate${report.absorbed.length === 1 ? "" : "s"} folded in here` }),
    ...report.absorbed.map((d) => el("div", { text: `${fmt.code(d.traceCode)} — ${d.title}` }))));
}

/**
 * What the scanner found in the reporter's own words: a phone number, an email, a
 * name-shaped string. Shown to the desk masked, and only as advice — the report was
 * accepted, and it is the desk's job to be careful with it, not to edit it.
 */
function privacyBanner(report) {
  if (!report.privacy?.length) return null;
  return el("div.drawer-sec", {}, el("div.warn", {},
    el("span.warn-title", {}, icon("eyeOff", "icon-sm"), el("span", { text: "The reporter may have identified themselves" })),
    el("div.warn-body", {}, ...report.privacy.map((f) => el("div", {},
      el("span", { text: `${f.label}: ` }), el("span.warn-sample", { text: f.sample }),
      f.advice ? el("span.quiet", { text: ` — ${f.advice}` }) : null)))));
}

/** Tags, which are how a desk finds the third report about the same tap. */
function tagRow(report, reload) {
  const send = async (patch) => {
    try {
      await api.patch(`/api/desk/reports/${encodeURIComponent(report.traceCode)}/tags`, patch);
      await reload();
    } catch (err) { failed(err); }
  };
  const input = el("input.input", {
    type: "text", placeholder: "Add a tag", "aria-label": "Add a tag",
    on: { keydown: (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const value = e.target.value.trim();
      if (value) send({ add: [value], remove: [] });
    } },
  });
  return el("div.row.row-wrap.gutter-top", {},
    ...report.tags.map((tag) => el("span.chip", {}, el("span", { text: tag }),
      can(P.note) ? el("button.chip-x", { type: "button", "aria-label": `Remove ${tag}`, on: { click: () => send({ add: [], remove: [tag] }) } }, icon("x", "icon-sm")) : null)),
    can(P.note) ? input : null);
}

/**
 * The response clock, and the honest version of it.
 *
 * A paused clock is not a met deadline. When the report is waiting on the reporter
 * `remainingMs` comes back null, the bar stops, and the section says who is holding
 * things up — because a desk that can pause its own clock will pause its own clock.
 */
function clockSection(report) {
  if (!report.isOpen) return null;
  return el("div.drawer-sec", {},
    el("div.drawer-sec-title", { text: "Response window" }),
    clock({
      remainingMs: report.remainingMs, windowMs: windowOf(report),
      overdue: report.isOverdue, paused: report.remainingMs === null, dueAt: report.dueAt,
    }),
    report.remainingMs === null
      ? el("p.t-xs.quiet.gutter-top", { text: "Stopped, because the report is waiting on the reporter. It restarts when they answer." })
      : null);
}

const SHARING_WORDS = {
  none: "Nothing shared — the trace code is the only link to this person",
  department: "Shared with the handling desk",
  admin_only: "Shared with the college admin only",
};

/** The measured facts. Everything here is a number the server worked out, not a guess. */
function factsSection(report) {
  return el("div.drawer-sec", {},
    el("div.facts", {},
      fact("Filed", fmt.date(report.createdAt)),
      fact("Last moved", fmt.when(report.lastActivityAt)),
      fact("Who filed", report.reporter?.label ?? "Anonymous"),
      fact("Visibility", report.visibility === "public" ? "On the public register" : "Private to the desk"),
      fact("Backing", fmt.n(report.supportCount)),
      fact("Where", report.location || "—"),
      fact("Happened", report.occurredAt ? fmt.day(report.occurredAt) : "—"),
      fact("Time on the desk", fmt.dur(report.elapsedMs)),
      report.pausedMs ? fact("Waiting on the reporter", fmt.dur(report.pausedMs)) : null,
      report.resolutionMs ? fact("Took", fmt.dur(report.resolutionMs)) : null,
      report.reopenCount ? fact("Reopened", `${report.reopenCount}×`) : null,
      report.satisfaction ? fact("Reporter rated it", `${report.satisfaction}/5`) : null),
    contactRow(report));
}

/**
 * Contact detail, and the reason it is usually absent.
 *
 * The reporter chooses whether to leave a way of reaching them and who may see it.
 * When they said "admin only" and an officer opens the report, this says so rather
 * than showing nothing — an officer who does not know a detail exists will ask the
 * reporter for it in the thread, which is exactly the leak the setting prevents.
 */
function contactRow(report) {
  if (report.contact) {
    return el("div.notice.notice-good.gutter-top", {},
      el("span.notice-title", { text: "The reporter left a way to reach them" }),
      el("span", { text: `${report.contact.channel === "phone" ? "Phone" : "Email"}: ${report.contact.value}. ` }),
      el("span.quiet", { text: "Use it for this report and nothing else." }));
  }
  if (report.contactWithheld) {
    return el("div.notice.gutter-top", {},
      el("span.notice-title", { text: "A contact detail exists and you are not one of the people it was shared with" }),
      el("span", { text: SHARING_WORDS[report.contactSharing] ?? "Shared narrowly." }),
      el("span", { text: " Ask your admin rather than asking the reporter again." }));
  }
  return el("p.t-xs.quiet.gutter-top", { text: SHARING_WORDS.none + ". Reply in the thread." });
}

/**
 * What the reporter says they can show.
 *
 * Nothing is uploaded — `storedAs: null` on every item, because a photo of a hostel
 * room with a face in it is the last thing an anonymous system should be holding. So
 * this is a list of things to ask for, and the section says so.
 */
function evidenceSection(report) {
  if (!report.evidence?.length) return null;
  return el("div.drawer-sec", {},
    el("div.drawer-sec-title", { text: `What they can show (${report.evidence.length})` }),
    el("div.reading", {}, ...report.evidence.map((item) => el("div.reading-item", {},
      el("span.reading-k", { text: item.name || "Described" }),
      el("span.reading-v", { text: item.storedAs ? "Held" : "Not uploaded" })))),
    el("p.t-xs.quiet.gutter-top", { text: "Descriptions only. TrustLine keeps no files; ask for anything you need through the thread." }));
}

/** The correspondence, internal notes included, in one file rather than two. */
function threadSection(report) {
  const AUTHOR = { reporter: "msg-reporter", desk: "msg-desk", system: "msg-system" };
  return el("div.drawer-sec", {},
    el("div.drawer-sec-title", { text: `Thread (${report.thread.length})` }),
    el("div.thread", {}, ...report.thread.map((m) => el(`div.msg.${AUTHOR[m.authorType] ?? "msg-system"}${m.internal ? ".msg-note" : ""}`, {},
      el("div.msg-by", {},
        el("span.msg-who", { text: m.internal ? `${m.authorLabel} · internal` : m.authorLabel }),
        el("span.msg-when", { text: fmt.date(m.at) })),
      el("p.msg-text", { text: m.body })))));
}

/**
 * The reply box. Plain, wide, and the only control here the reporter will ever read.
 *
 * "Ask them something" is a checkbox rather than a second button because it changes
 * one thing: the report moves to waiting-on-them and the response clock stops. That
 * is a fact about the reply, not a different kind of reply.
 */
function replyBox(report, reload) {
  let ask = false;
  const box = el("textarea.textarea", { rows: 4, placeholder: "What the reporter will read.", "aria-label": "Reply to the reporter" });
  const send = el("button.btn.btn-sm", { type: "button" }, icon("send"), "Send to the reporter");
  send.addEventListener("click", async () => {
    const body = box.value.trim();
    if (body.length < 2) { toast("Write something first.", "bad"); box.focus(); return; }
    send.disabled = true;
    try {
      await api.post(`/api/desk/reports/${encodeURIComponent(report.traceCode)}/replies`, { body, askReporter: ask });
      toast(ask ? "Sent. The clock is stopped until they answer." : "Sent.", "good");
      await reload();
    } catch (err) { failed(err); send.disabled = false; }
  });

  return el("div.drawer-sec", {},
    el("div.drawer-sec-title", { text: "Reply" }),
    el("div.compose", {}, box,
      el("div.compose-row", {},
        el("label.switch", {},
          el("input", { type: "checkbox", on: { change: (e) => { ask = e.target.checked; } } }),
          el("span.switch-track", { "aria-hidden": "true" }),
          el("span.switch-text", { text: "I need something from them — stop the clock" })),
        el("span.push", {}, send))));
}

/**
 * The internal note. Deliberately not the same control as the reply.
 *
 * Different section, amber field, a warning strip above the button, and a verb that
 * cannot be misread. The repository filters internal messages out of the reporter's
 * thread, so this is safe — but "safe because a filter works" is not enough, and an
 * officer at the end of a long shift should be able to see which box they are in.
 */
function noteBox(report, reload) {
  const box = el("textarea.textarea", { rows: 3, placeholder: "For the desk. The reporter never sees this.", "aria-label": "Internal note" });
  const save = el("button.btn.btn-line.btn-sm", { type: "button" }, icon("note"), "File an internal note");
  save.addEventListener("click", async () => {
    const body = box.value.trim();
    if (body.length < 2) { toast("Write the note first.", "bad"); box.focus(); return; }
    save.disabled = true;
    try {
      await api.post(`/api/desk/reports/${encodeURIComponent(report.traceCode)}/notes`, { body });
      toast("Noted, internally.", "good");
      await reload();
    } catch (err) { failed(err); save.disabled = false; }
  });

  return el("div.drawer-sec", {},
    el("div.drawer-sec-title", { text: "Internal note" }),
    el("div.compose.compose-note", {}, box,
      el("div.compose-row", {},
        el("span.compose-flag", {}, icon("eyeOff"), el("span", { text: "Desk only. Never shown to the reporter." })),
        el("span.push", {}, save))));
}

/** Assigning, and re-routing to another desk. Two different acts, so two controls. */
function routingSection(report, reload) {
  if (!can(P.assign)) return null;
  const codePath = `/api/desk/reports/${encodeURIComponent(report.traceCode)}`;

  const officer = el("select.select", { value: report.assignedTo || "" },
    el("option", { value: "", text: "Nobody — put it back in the pool" }),
    ...report.officers.map((o) => el("option", { value: o.id, text: o.title ? `${o.name} — ${o.title}` : o.name })));
  officer.addEventListener("change", async () => {
    try {
      await api.post(`${codePath}/assign`, { officerId: officer.value });
      toast(officer.value ? "Assigned." : "Back in the pool.", "good");
      await reload();
    } catch (err) { failed(err); officer.value = report.assignedTo || ""; }
  });

  return el("div.drawer-sec", {},
    el("div.drawer-sec-title", { text: "Who has it, and which desk" }),
    el("div.grid.grid-2", {},
      el("label.field", {}, el("span.label", { text: "Assigned to" }), officer),
      rerouteField(report, codePath, reload)));
}

/**
 * Moving a report to a different desk.
 *
 * Re-routing asks for a reason and gives the receiving desk a fresh response window
 * rather than the remains of one — a desk that has just been handed something should
 * not inherit a clock that is already red.
 */
function rerouteField(report, codePath, reload) {
  const desk = el("select.select", { value: report.departmentId || "" },
    ...report.desks.map((d) => el("option", { value: d.id, text: d.name })));
  desk.addEventListener("change", async () => {
    const departmentId = desk.value;
    const reason = await confirmAction({
      title: "Send this to another desk",
      note: "The receiving desk gets a fresh response window, and the reporter is told it moved. Say why, for the record.",
      confirmLabel: "Send it across",
      needs: { label: "Reason", placeholder: "Belongs with the hostel office, not maintenance" },
    });
    if (reason === null) { desk.value = report.departmentId; return; }
    try {
      await api.post(`${codePath}/route`, { departmentId, reason });
      toast("Sent across.", "good");
      await reload();
    } catch (err) { failed(err); desk.value = report.departmentId; }
  });
  return el("label.field", {}, el("span.label", { text: "Desk" }), desk,
    el("span.hint", { text: `Currently ${report.departmentName}` }));
}

/**
 * Reports that look like this one.
 *
 * Scored by the similarity service, offered rather than acted on. The confidence
 * figure is shown because an officer needs to know the difference between "almost
 * certainly the same tap" and "both mention the word water".
 */
function duplicatesSection(report, reload) {
  if (!can(P.merge) || !report.duplicates?.length) return null;
  return el("div.drawer-sec", {},
    el("div.drawer-sec-title", { text: "Possibly the same thing" }),
    el("div.entries", {}, ...report.duplicates.map((dup) => el("div.entry", {},
      el("div.entry-head", {},
        el("span.entry-title", { text: dup.title }),
        pill(dup.status, { label: dup.statusLabel, flat: true }),
        el("span.push.t-xs.quiet", { text: `${dup.confidence}% alike` })),
      el("div.entry-foot", {},
        el("span.mono.t-xs", { text: fmt.code(dup.traceCode) }),
        dup.shared?.length ? el("span.t-xs.quiet", { text: `shares: ${dup.shared.slice(0, 4).join(", ")}` }) : null,
        el("button.btn.btn-quiet.btn-sm.push", {
          type: "button",
          on: { click: async () => {
            try {
              await api.post(`/api/desk/reports/${encodeURIComponent(report.traceCode)}/merge`, { into: dup.traceCode });
              toast("Merged into that one.", "good");
              await reload();
            } catch (err) { failed(err); }
          } },
        }, icon("merge"), "Fold this into it"))))));
}

/**
 * How this report got to this desk.
 *
 * Routing is four strategies tried in order — a safety net for anything urgent, the
 * category the reporter chose, keywords in the words they wrote, then whichever desk
 * is carrying least. Showing which one fired is how an admin discovers that a keyword
 * rule is doing work a category should be doing.
 */
function trailSection(report) {
  if (!report.routingTrace?.length) return null;
  const deskName = (id) => report.desks.find((d) => d.id === id)?.name ?? "a desk since removed";
  return el("div.drawer-sec", {},
    el("div.drawer-sec-title", { text: "How it was routed" }),
    el("div.line", {}, ...report.routingTrace.map((step, i) => el(`div.line-item${i === report.routingTrace.length - 1 ? ".line-now" : ""}`, {},
      el("span.line-node", { "aria-hidden": "true" }),
      el("div", {},
        el("div.line-what", { text: deskName(step.departmentId) }),
        el("div.line-when", { text: `${fmt.date(step.at)} · ${step.strategy}` }),
        step.reason ? el("div.line-note", { text: step.reason }) : null)))));
}

/* ---- categories and routing rules ------------------------------------------ */

/**
 * The screen an admin actually needs on day one: every category, and the desk it
 * lands on. Written as one readable line — "Hostel food → Hostel office" — because
 * that is the sentence they will say out loud when checking it.
 *
 * An unrouted category is the only thing here wearing seal. It is also the only thing
 * on this screen that is wrong.
 */
async function viewCategories() {
  head("Categories & routing", "What people can report, and where it goes");
  fill(page(), loading(4));

  const paint = async () => {
    const board = await api.get("/api/admin/catalog");
    roster.board = board.departments;
    fill(page(),
      ...(board.warnings.length ? [warningsPanel(board.warnings)] : []),
      panel("Routing rules", el("div", {}, ...board.categories.map((c) => ruleRow(c, board, paint))),
        null, el("button.btn.btn-sm.push", { type: "button", on: { click: () => categoryForm(board, paint) } }, icon("plus"), "New category")),
      el("div.gutter-top", {}, panel("What each category has taken",
        el("div.panel-body-tight", {}, sheet(["Category", "Desk", "#Open", "#All time", "Starts at"],
          board.categories.map((c) => el("tr", {},
            el("td", { text: c.name }), el("td", { text: c.departmentName ?? "—" }),
            numCell(c.openCount), numCell(c.totalCount),
            el("td", { text: c.defaultPriority }))))))));
  };
  await paint().catch(showFailure);
}

/** The things wrong with the catalog, said plainly, at the top, before anything else. */
function warningsPanel(warnings) {
  return el("section.panel.panel-seal", {},
    el("div.panel-head", {}, el("span.panel-title", { text: `${warnings.length} thing${warnings.length === 1 ? "" : "s"} to fix` })),
    el("div.panel-body.stack-tight", {}, ...warnings.map((w) => el("div.row", {},
      icon(w.kind === "unrouted" ? "route" : "desk", "icon-sm"),
      el("span.t-sm", { text: w.message })))));
}

/** One routing rule, readable as a sentence. */
function ruleRow(category, board, reload) {
  const desk = el("select.select", { value: category.departmentId || "" },
    el("option", { value: "", text: "— nowhere yet —" }),
    ...board.departments.map((d) => el("option", { value: d.id, text: d.active ? d.name : `${d.name} (closed)` })));
  desk.addEventListener("change", async () => {
    try {
      await api.post(`/api/admin/categories/${category.id}/route`, { departmentId: desk.value });
      toast(desk.value ? "Routed." : "Unrouted.", "good");
      await reload();
    } catch (err) { failed(err); }
  });

  return el(`div.rule${category.unrouted ? ".rule-open" : ""}`, {},
    el("div", {},
      el("div.rule-from", {}, el("span", { text: category.name }),
        category.confidential ? el("span.chip", {}, icon("lock", "icon-sm"), el("span", { text: "never public" })) : null,
        category.active ? null : el("span.chip", {}, el("span", { text: "hidden" }))),
      el("div.rule-note", { text: category.keywords.length ? `words: ${category.keywords.join(", ")}` : "no keywords — only reachable by picking it" })),
    el("div.rule-arrow", {}, icon("arrow")),
    el("div.rule-to", {}, desk,
      category.deskInactive ? el("div.rule-note", { text: "that desk is closed" }) : null),
    el("div.row", {},
      el("span.t-xs.quiet", { text: `${category.openCount} open` }),
      el("button.btn.btn-quiet.btn-sm", { type: "button", on: { click: () => categoryForm(board, reload, category) } }, "Edit"),
      el("button.btn.btn-quiet.btn-sm", {
        type: "button",
        on: { click: async () => {
          const yes = await confirmAction({
            title: `Remove “${category.name}”?`, danger: true, confirmLabel: "Remove",
            note: "Reports already filed under it keep it. It just stops being offered. If any report uses it the server will refuse and it will be hidden instead.",
          });
          if (!yes) return;
          try { await api.del(`/api/admin/categories/${category.id}`); toast("Removed.", "good"); await reload(); }
          catch (err) { failed(err); }
        } },
      }, icon("x", "icon-sm"))));
}

const AUDIENCES = [
  ["student", "Students"], ["staff", "Staff"], ["faculty", "Faculty"],
  ["parent", "Parents"], ["alumnus", "Alumni"], ["visitor", "Anyone else"],
];

/**
 * The category editor.
 *
 * "Who may use this" and "never public" are the two fields with consequences: the
 * first decides who is offered the category at all, and the second overrides the
 * reporter's own choice to publish, which is the right way round for a harassment
 * category and would be wrong for a broken tap.
 */
function categoryForm(board, reload, existing = null) {
  const f = {};
  const text = (key, label, value = "", hint = null) => {
    f[key] = el("input.input", { type: "text", value });
    return el("label.field", {}, el("span.label", { text: label }), f[key], hint ? el("span.hint", { text: hint }) : null);
  };
  const checked = new Set(existing?.audiences ?? AUDIENCES.map(([k]) => k));

  const body = el("div.panel-body.stack", {},
    text("name", "Name", existing?.name ?? "", "What a reporter will read on the form"),
    text("description", "One line of help", existing?.description ?? ""),
    text("keywords", "Words that should pick this automatically", (existing?.keywords ?? []).join(", "),
      "Comma separated. Used only when the reporter did not choose a category themselves."),
    el("div.grid.grid-2", {},
      el("label.field", {}, el("span.label", { text: "Goes to" }),
        f.departmentId = el("select.select", { value: existing?.departmentId ?? "" },
          el("option", { value: "", text: "— nowhere yet —" }),
          ...board.departments.map((d) => el("option", { value: d.id, text: d.name })))),
      el("label.field", {}, el("span.label", { text: "Starts at priority" }),
        f.defaultPriority = el("select.select", { value: existing?.defaultPriority ?? "normal" },
          ...["low", "normal", "high", "urgent"].map((p) => el("option", { value: p, text: p })))),
      el("label.field", {}, el("span.label", { text: "Response window (hours)" }),
        f.slaHours = el("input.input", { type: "number", min: "1", max: "720", value: existing?.slaHours ?? "" }),
        el("span.hint", { text: "Blank means the desk's own window" }))),
    el("fieldset.field", {}, el("legend.label", { text: "Who may use it" }),
      el("div.row.row-wrap", {}, ...AUDIENCES.map(([key, label]) => el("label.chip", {},
        el("input", { type: "checkbox", checked: checked.has(key), on: { change: (e) => (e.target.checked ? checked.add(key) : checked.delete(key)) } }),
        el("span", { text: label }))))),
    switchRow("confidential", "Never goes on the public register", existing?.confidential ?? false, f,
      "Overrides the reporter's own choice. For anything where being named is the danger."),
    switchRow("requireEvidence", "Must say what they can show", existing?.requireEvidence ?? false, f),
    switchRow("active", "Offered on the form", existing?.active ?? true, f));

  catalogModal(existing ? "Edit category" : "New category", body, async () => {
    const payload = {
      name: f.name.value.trim(),
      description: f.description.value.trim(),
      keywords: f.keywords.value,
      audiences: [...checked].join(","),
      departmentId: f.departmentId.value || null,
      defaultPriority: f.defaultPriority.value,
      slaHours: f.slaHours.value === "" ? null : Number(f.slaHours.value),
      confidential: f.confidential,
      requireEvidence: f.requireEvidence,
      active: f.active,
    };
    if (existing) await api.patch(`/api/admin/categories/${existing.id}`, payload);
    else await api.post("/api/admin/categories", payload);
    toast(existing ? "Saved." : "Added.", "good");
    await reload();
  });
}

/** A labelled switch bound into a form's field bag. */
/**
 *
 * The bag holds the boolean, not the checkbox. It used to hold the element and
 * leave every caller to remember `.checked`, which two of them did not — the
 * settings screen and the notice form both sent the bag straight to the server, so
 * `JSON.stringify` met a DOM node and threw "circular structure" before the request
 * was even made. Saving college settings and posting a notice were both dead. A
 * plain boolean cannot fail that way.
 */
function switchRow(key, label, value, bag, hint = null) {
  bag[key] = Boolean(value);
  const box = el("input", {
    type: "checkbox", checked: Boolean(value),
    on: { change: (e) => { bag[key] = Boolean(e.target.checked); } },
  });
  return el("div.field", {},
    el("label.switch", {}, box, el("span.switch-track", { "aria-hidden": "true" }), el("span.switch-text", { text: label })),
    hint ? el("span.hint", { text: hint }) : null);
}

/**
 * Every catalog form, in the same drawer, with the same footer.
 *
 * One function rather than five copies: a department form and a category form differ
 * only in their fields, and a save button that behaves differently on two screens is
 * a bug waiting for the week before a demo.
 */
function catalogModal(title, body, save) {
  const button = el("button.btn.btn-sm.push", { type: "button" }, icon("check"), "Save");
  button.addEventListener("click", async () => {
    button.disabled = true;
    try { await save(); closeOverlay(); }
    catch (err) { failed(err); button.disabled = false; }
  });
  drawer({
    title,
    head: [el("span.panel-title", { text: title })],
    body: [body, el("div.panel-foot.row", {},
      el("button.btn.btn-quiet.btn-sm", { type: "button", on: { click: () => closeOverlay() } }, "Cancel"), button)],
  });
}

/* ---- desks ----------------------------------------------------------------- */

/**
 * The desks, and how much each is carrying.
 *
 * Load is a bar rather than a number because the useful question is never "how many
 * does maintenance have", it is "is maintenance drowning compared to the hostel
 * office". A desk with no categories pointing at it is marked, because it will sit
 * there looking healthy forever while receiving nothing.
 */
async function viewDesks() {
  head("Desks", "Where reports land, and who is behind each one");
  fill(page(), loading(4));

  const paint = async () => {
    const board = await api.get("/api/admin/catalog");
    roster.board = board.departments;
    const busiest = Math.max(1, ...board.departments.map((d) => d.openCount));
    fill(page(),
      panel("Desks", el("div", {}, ...board.departments.map((d) => deskRow(d, busiest, board, paint))), null,
        el("button.btn.btn-sm.push", { type: "button", on: { click: () => deskForm(paint) } }, icon("plus"), "New desk")));
  };
  await paint().catch(showFailure);
}

function deskRow(desk, busiest, board, reload) {
  const share = Math.round((desk.openCount / busiest) * 100);
  const late = desk.openCount > 0 && share >= 80;
  return el("div.desk", {},
    el("div", {},
      el("div.desk-name", {}, el("span", { text: desk.name }),
        desk.active ? null : el("span.chip", {}, el("span", { text: "closed" }))),
      el("div.desk-sub", {
        text: [
          desk.headName || null,
          `${desk.categoryCount} categor${desk.categoryCount === 1 ? "y" : "ies"}`,
          desk.officers.length ? desk.officers.map((o) => o.name).join(", ") : "nobody assigned",
          desk.slaHours ? `${desk.slaHours}h window` : "college default window",
        ].filter(Boolean).join(" · "),
      }),
      desk.categoryCount === 0 && desk.active
        ? el("div.desk-sub.desk-idle", { text: "No category points here, so nothing will ever arrive." })
        : null),
    el("div.desk-load", {},
      el(`div.desk-bar${late ? ".desk-bar-late" : ""}`, {}, el("i", { style: { width: `${Math.max(2, share)}%` } })),
      el("div.desk-figure", { text: `${desk.openCount} open of ${desk.totalCount} all time` })),
    el("div.row", {},
      el("button.btn.btn-quiet.btn-sm", { type: "button", on: { click: () => deskForm(reload, desk) } }, "Edit"),
      el("button.btn.btn-quiet.btn-sm", {
        type: "button",
        on: { click: async () => {
          const yes = await confirmAction({
            title: `Remove “${desk.name}”?`, danger: true, confirmLabel: "Remove",
            note: "The server refuses while any report still points here, and closes the desk instead.",
          });
          if (!yes) return;
          try { await api.del(`/api/admin/departments/${desk.id}`); toast("Removed.", "good"); await reload(); }
          catch (err) { failed(err); }
        } },
      }, icon("x", "icon-sm"))));
}

function deskForm(reload, existing = null) {
  const f = {};
  const text = (key, label, value = "", hint = null) => {
    f[key] = el("input.input", { type: "text", value });
    return el("label.field", {}, el("span.label", { text: label }), f[key], hint ? el("span.hint", { text: hint }) : null);
  };
  const body = el("div.panel-body.stack", {},
    text("name", "Desk name", existing?.name ?? "", "The office as people in the college call it"),
    text("headName", "Who runs it", existing?.headName ?? ""),
    text("description", "What it handles", existing?.description ?? ""),
    el("label.field", {}, el("span.label", { text: "Response window (hours)" }),
      f.slaHours = el("input.input", { type: "number", min: "2", max: "720", value: existing?.slaHours ?? "" }),
      el("span.hint", { text: `Blank uses the college default of ${college?.settings?.defaultSlaHours ?? 72}h` })),
    existing ? switchRow("active", "Open for new reports", existing.active, f) : null);

  catalogModal(existing ? "Edit desk" : "New desk", body, async () => {
    const payload = {
      name: f.name.value.trim(), headName: f.headName.value.trim(),
      description: f.description.value.trim(),
      slaHours: f.slaHours.value === "" ? null : Number(f.slaHours.value),
      ...(existing ? { active: f.active } : {}),
    };
    if (existing) await api.patch(`/api/admin/departments/${existing.id}`, payload);
    else await api.post("/api/admin/departments", payload);
    toast(existing ? "Saved." : "Desk added.", "good");
    await reload();
  });
}

/* ---- the team --------------------------------------------------------------- */

/**
 * Officers and admins.
 *
 * Two different things happen on this screen and they are kept apart. An officer is
 * created here by an admin — officers never sign themselves up, because an account
 * that can read other people's reports should not be self-service. A second admin
 * does register themselves, and then waits here for approval.
 */
async function viewTeam() {
  head("Team", "Who can open reports, and which desks they see");
  fill(page(), loading(4));

  const paint = async () => {
    const [{ team }, board] = await Promise.all([
      api.get("/api/admin/team"),
      api.get("/api/admin/catalog").catch(() => ({ departments: [] })),
    ]);
    const waiting = team.filter((m) => m.status === "pending");
    const active = team.filter((m) => m.status !== "pending");
    roster.board = board.departments.length ? board.departments : roster.board;

    fill(page(),
      waiting.length
        ? panel(`${waiting.length} waiting for you`, el("div", {}, ...waiting.map((m) => applicantRow(m, paint))))
        : null,
      el(waiting.length ? "div.gutter-top" : "div", {},
        panel("Everyone with a login", el("div.panel-body-tight", {},
          sheet(["Name", "Role", "Desks", "Status", "Last seen", ""], active.map((m) => teamRow(m, board, paint)))),
        null, el("button.btn.btn-sm.push", { type: "button", on: { click: () => officerForm(board, paint) } }, icon("plus"), "Add a desk officer"))));
  };
  await paint().catch(showFailure);
}

function applicantRow(member, reload) {
  const decide = (decision, label, cls) => el(`button.btn.btn-sm.${cls}`, {
    type: "button",
    on: { click: async () => {
      const note = await confirmAction({
        title: `${label} ${member.name}?`, confirmLabel: label, danger: decision !== "approve",
        note: decision === "approve"
          ? "They will be able to sign in and read every report in this college."
          : "They will not be able to sign in. Say why, for the record.",
        needs: { label: "Note", placeholder: decision === "approve" ? "Verified with the office" : "Not a member of staff" },
      });
      if (note === null) return;
      try { await api.post(`/api/admin/team/${member.id}/review`, { decision, note }); toast(`${label}d.`, "good"); await reload(); refreshCounts(); }
      catch (err) { failed(err); }
    } },
  }, label);

  return el("div.applicant", {},
    el("div", {},
      el("div.applicant-name", { text: member.name }),
      el("div.applicant-where", { text: `${roleLabel(member.role)} · ${member.email}` }),
      el("div.t-xs.quiet.gutter-top", { text: `Registered ${fmt.date(member.createdAt)}` })),
    el("div.applicant-acts", {}, decide("approve", "Approve", "btn-seal"), decide("reject", "Reject", "btn-quiet")));
}

const TEAM_TONE = { active: "good", pending: "warn", suspended: "bad", rejected: "bad" };

function teamRow(member, board, reload) {
  const mine = member.id === me.id;
  const acts = [];
  if (!mine && member.status === "active") acts.push(["Suspend", "suspend", true]);
  if (!mine && member.status === "suspended") acts.push(["Reinstate", "reinstate", false]);

  return el("tr", {},
    el("td", {},
      el("div", {}, el("strong", { text: member.name }), mine ? el("span.faint", { text: "  · you" }) : null),
      el("div.t-xs.quiet", { text: member.email })),
    el("td", {}, el("span", { text: roleLabel(member.role) }),
      member.title ? el("div.t-xs.quiet", { text: member.title }) : null),
    el("td.t-sm", { text: member.desks?.length ? member.desks.join(", ") : member.role === "COLLEGE_ADMIN" ? "Every desk" : "None yet" }),
    el("td", {}, pill(member.status, { label: member.status, tone: TEAM_TONE[member.status], flat: true })),
    el("td.t-xs.quiet", { text: member.lastSeenAt ? fmt.when(member.lastSeenAt) : "never signed in" }),
    el("td", {}, el("div.row.push", {},
      member.role === "DEPARTMENT_OFFICER"
        ? el("button.btn.btn-sm.btn-line", { type: "button", on: { click: () => officerForm(board, reload, member) } }, "Edit")
        : null,
      ...acts.map(([label, decision, danger]) => el("button.btn.btn-sm.btn-quiet", {
        type: "button",
        on: { click: async () => {
          const note = await confirmAction({
            title: `${label} ${member.name}?`, confirmLabel: label, danger,
            note: danger ? "They stay in the record but cannot sign in until reinstated." : "They will be able to sign in again.",
            needs: { label: "Reason", placeholder: danger ? "Left the department" : "Back from leave" },
          });
          if (note === null) return;
          try { await api.post(`/api/admin/team/${member.id}/review`, { decision, note }); toast(`${label}d.`, "good"); await reload(); }
          catch (err) { failed(err); }
        } },
      }, label)))));
}

/**
 * Creating an officer, or changing which desks an existing one sees. The desk list is
 * the whole point of the form: an officer with no desk sees no reports at all, which
 * is safer than the reverse but confusing if nobody says so.
 */
function officerForm(board, reload, existing = null) {
  const bag = {
    name: existing?.name || "", email: existing?.email || "", title: existing?.title || "",
    password: "", departmentIds: [...(existing?.departmentIds || [])],
  };
  const field = (key, label, opts = {}) => el("label.field", {},
    el("span.label", { text: label }),
    el(`input.input`, { type: opts.type || "text", value: bag[key], placeholder: opts.placeholder || "",
      disabled: opts.disabled || false, on: { input: (e) => { bag[key] = e.target.value; } } }),
    opts.hint ? el("span.hint", { text: opts.hint }) : null);

  const deskPick = (desk) => el("label.switch", {},
    el("input", { type: "checkbox", checked: bag.departmentIds.includes(desk.id),
      on: { change: (e) => {
        bag.departmentIds = e.target.checked
          ? [...bag.departmentIds, desk.id]
          : bag.departmentIds.filter((id) => id !== desk.id);
      } } }),
    el("span.switch-track"),
    el("span.switch-text", { text: desk.name }));

  catalogModal(existing ? `Edit ${existing.name}` : "Add a desk officer",
    el("div.stack", {},
      field("name", "Name", { placeholder: "Anjana Pillai" }),
      existing ? null : field("email", "Work email", { type: "email", placeholder: "anjana@cep.ac.in" }),
      field("title", "Title", { placeholder: "Hostel warden", hint: "Shown in the console, never to a reporter." }),
      field("password", existing ? "New password" : "First password",
        { type: "password", hint: existing ? "Leave blank to keep the current one." : "They should change it after signing in." }),
      el("div.field", {},
        el("span.label", { text: "Desks they can open" }),
        el("div.stack-tight", {}, ...(board.departments || []).map(deskPick)),
        el("span.hint", { text: "An officer with no desk can sign in but will see an empty queue." }))),
    async () => {
      if (existing) {
        await api.patch(`/api/admin/team/officers/${existing.id}`, {
          name: bag.name, title: bag.title, departmentIds: bag.departmentIds,
          ...(bag.password ? { password: bag.password } : {}),
        });
      } else {
        await api.post("/api/admin/team/officers", bag);
      }
      toast(existing ? "Officer updated." : "Officer added.", "good");
      await reload();
    });
}

/* ---- the notice board ------------------------------------------------------- */

/**
 * A feed of complaints with no reply from the college is a wall of shouting, so this
 * screen exists to close the loop. The digest button is the important one: it writes
 * the post from the month's actual resolutions, because a blank textarea is where
 * "here is what we fixed" usually dies.
 */
async function viewNews() {
  head("Notices", "What the college says back");
  fill(page(), loading(3));

  const paint = async () => {
    const { announcements } = await api.get("/api/admin/announcements");
    const live = announcements.filter((a) => a.live);
    const done = announcements.filter((a) => !a.live);

    fill(page(),
      panel("Post an update", el("div.panel-body", {},
        el("p.t-sm.quiet.measure", { text: "Anything posted here appears on the college's public page, above the register. Cite trace codes and the page shows each one with its current status — proof rather than a claim." }),
        el("div.row.row-wrap.gutter-top", {},
          el("button.btn", { type: "button", on: { click: () => noticeForm(paint) } }, icon("plus"), "Write one"),
          el("button.btn.btn-line", { type: "button", on: { click: () => draftDigest(paint) } }, icon("spark"), "Draft this month's digest")))),
      el("div.gutter-top", {}, panel(`Live now (${live.length})`,
        live.length
          ? el("div", {}, ...live.map((a) => noticeRow(a, paint)))
          : el("div.panel-body", {}, blank("Nothing posted", "Reporters can see the register but not a word from the college.")))),
      done.length
        ? el("div.gutter-top", {}, panel("Expired", el("div", {}, ...done.map((a) => noticeRow(a, paint)))))
        : null);
  };
  await paint().catch(showFailure);
}

function noticeRow(notice, reload) {
  return el("article.entry", {},
    el("div.entry-head", {},
      el("h3.entry-title", { text: notice.title }),
      notice.pinned ? pill("pinned", { label: "pinned", tone: "working", flat: true }) : null),
    el("p.entry-body", { text: notice.body }),
    el("div.entry-foot", {},
      el("span", { text: `${notice.authorName} · ${fmt.date(notice.at)}` }),
      notice.linkedTraceCodes.length
        ? el("span.mono", { text: notice.linkedTraceCodes.map(fmt.code).join("  ") })
        : el("span.faint", { text: "no reports cited" }),
      notice.expiresAt ? el("span", { text: `${notice.live ? "expires" : "expired"} ${fmt.date(notice.expiresAt)}` }) : null,
      el("span.row.push", {},
        el("button.btn.btn-sm.btn-line", { type: "button", on: { click: () => noticeForm(reload, notice) } }, "Edit"),
        el("button.btn.btn-sm.btn-quiet", { type: "button", on: { click: async () => {
          if (!await confirmAction({ title: "Take this down?", note: "It disappears from the public page. The reports it cites are untouched.", confirmLabel: "Take down", danger: true })) return;
          try { await api.del(`/api/admin/announcements/${notice.id}`); toast("Taken down.", "good"); await reload(); }
          catch (err) { failed(err); }
        } } }, "Remove"))));
}

async function draftDigest(reload) {
  try {
    const draft = await api.get("/api/admin/announcements/digest?days=30");
    if (draft.resolvedCount === 0) { toast("Nothing has been resolved in the last 30 days yet.", "bad"); return; }
    noticeForm(reload, null, draft);
  } catch (err) { failed(err); }
}

function noticeForm(reload, existing = null, draft = null) {
  const seed = existing || draft || {};
  const bag = {
    title: seed.title || "", body: seed.body || "",
    codes: (seed.linkedTraceCodes || []).join(", "),
    pinned: Boolean(seed.pinned), expiresInDays: "",
  };

  catalogModal(existing ? "Edit the update" : draft ? "This month's digest" : "Write an update",
    el("div.stack", {},
      draft ? el("div.notice.notice-good", {}, el("strong.notice-title", { text: "Written from the record" }),
        el("span", { text: `${draft.resolvedCount} reports closed in the last 30 days. Edit it into your own words before posting.` })) : null,
      el("label.field", {},
        el("span.label", { text: "Headline" }),
        el("input.input", { value: bag.title, maxlength: "140", placeholder: "Hostel water supply restored",
          on: { input: (e) => { bag.title = e.target.value; } } })),
      el("label.field", {},
        el("span.label", { text: "Update" }),
        el("textarea.textarea", { rows: "9", maxlength: "2000", value: bag.body,
          on: { input: (e) => { bag.body = e.target.value; } } }),
        el("span.hint", { text: "Plain words. Say what changed and when." })),
      el("label.field", {},
        el("span.label", { text: "Reports this is about" }),
        el("input.input.mono", { value: bag.codes, placeholder: "TL-4KQ2-8MHR, TL-93XD-2PLW",
          on: { input: (e) => { bag.codes = e.target.value; } } }),
        el("span.hint", { text: "Up to eight trace codes, separated by commas. Private reports are ignored — citing one would reveal that it exists." })),
      switchRow("pinned", "Keep this at the top", bag.pinned, bag, "Pinned updates sit above the register."),
      el("label.field", {},
        el("span.label", { text: "Take it down after" }),
        el("input.input", { type: "number", min: "1", max: "365", value: bag.expiresInDays, placeholder: "30",
          on: { input: (e) => { bag.expiresInDays = e.target.value; } } }),
        el("span.hint", { text: "Leave blank to keep it up until you remove it." }))),
    async () => {
      const payload = {
        title: bag.title, body: bag.body, pinned: bag.pinned,
        linkedTraceCodes: bag.codes.split(",").map((s) => s.trim()).filter(Boolean),
        expiresInDays: bag.expiresInDays || null,
      };
      if (existing) await api.patch(`/api/admin/announcements/${existing.id}`, payload);
      else await api.post("/api/admin/announcements", payload);
      toast(existing ? "Updated." : "Posted.", "good");
      await reload();
    });
}

/* ---- the college's own settings --------------------------------------------- */

/**
 * Five switches and a number, and each one changes the product for this college
 * alone. They are written as consequences rather than as features — "turning this
 * off hides the register" tells an admin what they are about to do to their students,
 * which a label reading "Public feed" does not.
 */
async function viewSettings() {
  head("Settings", "How TrustLine behaves for this college");
  fill(page(), loading(4));

  const paint = async () => {
    const profile = await api.get("/api/admin/college");
    fill(page(),
      panel("The college", el("div.panel-body", {}, profileForm(profile, paint))),
      el("div.gutter-top", {}, panel("What reporters can do", el("div.panel-body", {}, settingsForm(profile, paint)))),
      el("div.gutter-top", {}, panel("Your public page", el("div.panel-body", {},
        el("div.facts", {},
          fact("Address", `/c/${profile.slug}`),
          fact("Status", profile.status),
          fact("Joined", fmt.date(profile.createdAt))),
        el("div.row.gutter-top", {},
          el("a.btn.btn-line", { href: `/c/${profile.slug}`, target: "_blank", rel: "noopener" }, icon("eye"), "See what a reporter sees"),
          el("button.btn.btn-quiet", { type: "button", on: { click: () => copy(`${location.origin}/c/${profile.slug}`, "Address copied.") } }, icon("copy"), "Copy the address"))))));
  };
  await paint().catch(showFailure);
}

function profileForm(profile, reload) {
  const bag = {
    name: profile.name || "", shortName: profile.shortName || "", city: profile.city || "",
    state: profile.state || "", university: profile.university || "",
    emailDomain: profile.emailDomain || "", contactEmail: profile.contactEmail || "",
  };
  const field = (key, label, hint = null, type = "text") => el("label.field", {},
    el("span.label", { text: label }),
    el("input.input", { type, value: bag[key], on: { input: (e) => { bag[key] = e.target.value; } } }),
    hint ? el("span.hint", { text: hint }) : null);

  const save = el("button.btn", { type: "button", on: { click: async () => {
    save.disabled = true;
    try { await api.patch("/api/admin/college", bag); toast("Saved.", "good"); await reload(); }
    catch (err) { failed(err); save.disabled = false; }
  } } }, "Save");

  return el("div", {},
    el("div.grid.grid-2", {},
      field("name", "Full name"),
      field("shortName", "Short name", "Used in tight spaces, like the rail."),
      field("city", "City"),
      field("state", "State"),
      field("university", "University"),
      field("emailDomain", "Email domain", "Only used to recognise staff addresses. Reporters are never asked for an email."),
      field("contactEmail", "Office contact", "Where the platform office writes if something needs a human.", "email")),
    el("div.row.gutter-top", {}, save));
}

function settingsForm(profile, reload) {
  const s = profile.settings;
  const bag = { ...s };
  const save = el("button.btn", { type: "button", on: { click: async () => {
    save.disabled = true;
    try { await api.patch("/api/admin/college/settings", bag); toast("Saved.", "good"); await reload(); }
    catch (err) { failed(err); save.disabled = false; }
  } } }, "Save");

  return el("div", {},
    el("div.stack", {},
      switchRow("publicFeed", "Publish the register", bag.publicFeed, bag,
        "Off, and nobody outside the console sees any report — not even the ones their author chose to make public. Reporters can still file and still track their own."),
      switchRow("allowVisitorReports", "Let anyone file, not just students and staff", bag.allowVisitorReports, bag,
        "Parents, visitors, contractors. Off, and a category marked for visitors quietly stops accepting them."),
      switchRow("requirePassphrase", "Insist on a passphrase with every report", bag.requirePassphrase, bag,
        "A trace code alone is a credential anyone who finds it can use. A passphrase is safer and one more thing to forget — on, the trace code becomes useless without it."),
      el("label.field", {},
        el("span.label", { text: "Answer within, by default" }),
        el("input.input", { type: "number", min: "2", max: "720", value: String(bag.defaultSlaHours),
          on: { input: (e) => { bag.defaultSlaHours = Number(e.target.value); } } }),
        el("span.hint", { text: "Hours. A category or a desk with its own window overrides this. The clock stops whenever the desk is waiting on the reporter." })),
      el("label.field", {},
        el("span.label", { text: "Close resolved reports after" }),
        el("input.input", { type: "number", min: "1", max: "90", value: String(bag.autoCloseAfterDays),
          on: { input: (e) => { bag.autoCloseAfterDays = Number(e.target.value); } } }),
        el("span.hint", { text: "Days. The reporter can still reopen one afterwards, so this is tidying, not a deadline." })),
      el("label.field", {},
        el("span.label", { text: "One line above the register" }),
        el("input.input", { value: bag.motto || "", maxlength: "160", placeholder: "Say it once. We will answer.",
          on: { input: (e) => { bag.motto = e.target.value; } } }))),
    el("div.row.gutter-top", {}, save));
}

/* ---- the record ------------------------------------------------------------- */

// What each router actually did, in words rather than in class names. `safety-net`
// deserves the plain reading: something in the wording said this could not wait.
const STRATEGY_WORDS = {
  "safety-net": "Wording said it was urgent",
  "category-rule": "The category's own rule",
  "wording-match": "Matched a desk's keywords",
  "lightest-desk": "Nothing matched, so the quietest desk",
  unknown: "Filed before routing was recorded",
};

const WINDOWS = [[7, "7 days"], [30, "30 days"], [90, "90 days"], [180, "6 months"]];

/**
 * The long view. Everything here is computed on read from the rows themselves, so it
 * is never stale and there is no job to fail.
 *
 * An officer opening this sees their own desks' numbers and an admin sees the
 * college's — same route, and the account decides. Nothing on this screen names a
 * reporter: `byReporter` counts the kind of person, not the person.
 */
async function viewRecord() {
  const days = Number(query().get("days")) || 30;
  head("The record", "Every number, computed from the reports themselves");
  fill(page(), loading(5));

  const stats = await api.get(`/api/admin/analytics?days=${days}`).catch((err) => {
    showFailure(err);
    return null;
  });
  if (!stats) return;

  const h = stats.headline;
  fill(page(), el("div.stack-loose", {},
    el("div.row.row-wrap", {},
      el("span.label", { text: "Window" }),
      ...WINDOWS.map(([n, label]) => el(`button.btn.btn-sm${n === days ? "" : ".btn-quiet"}`, {
        type: "button", on: { click: () => { setQuery({ days: n === 30 ? null : n }); viewRecord(); } },
      }, label)),
      el("span.push.t-xs.quiet", { text: `Since ${fmt.date(stats.window.since)}` })),

    el("div.kpis", {},
      el("div.kpi", {}, count(h.total, "reports, all time"),
        el("div.kpi-delta", { text: `${h.inWindow} in this window` })),
      el("div.kpi", {}, count(h.resolvedRate, "resolved", { marks: false }),
        el("div.kpi-delta", { text: h.medianHours === null ? "Nothing closed yet" : `Median ${hours(h.medianHours)}` })),
      el("div.kpi", {}, count(h.publicShare, "chose to publish", { marks: false }),
        el("div.kpi-delta", { text: `${fmt.n(h.backedTotal)} people backed a report` })),
      el(`div.kpi${h.overdue ? ".kpi-late" : ""}`, {}, count(h.overdue, "late", { tone: "seal" }),
        el("div.kpi-delta", { text: `${h.unassigned} unclaimed · ${h.escalated} escalated` }))),

    dailyChart(stats),
    el("div.grid.grid-2", {}, backlogPanel(stats.backlog), routingPanel(stats.routing)),
    el("div.grid.grid-2", {}, reporterPanel(stats.byReporter), satisfactionPanel(stats.satisfaction)),
    categoryPanel(stats.byCategory),
    deskTable(stats.byDepartment),
    el("div.grid.grid-2", {}, priorityPanel(stats.byPriority), tagPanel(stats.hotTags)),
    el("p.t-xs.quiet.measure", { text: "Every figure on this page is folded over the reports themselves at the moment you asked. There is no metrics table to drift out of step, and no number here can be edited." })));
}

/** How old the open pile is. A growing right-hand bar is the thing to worry about. */
function backlogPanel(backlog) {
  const box = chartBox("chart-h");
  queueMicrotask(() => bars(box, {
    rows: backlog.bands.map((b, i) => ({ label: b.label, value: b.count, tone: i >= 3 ? "seal" : i === 2 ? "amber" : "indigo" })),
    empty: "Nothing is open.",
  }));
  return panel("How old the open pile is", el("div.panel-body", {}, box,
    el("div.facts.gutter-top", {},
      fact("Open", fmt.n(backlog.open)),
      fact("Oldest", backlog.oldestDays === null ? "—" : `${backlog.oldestDays} days`))));
}

/** Which router placed each report — the honest test of the admin's category table. */
function routingPanel(routing) {
  const box = chartBox("chart-h");
  queueMicrotask(() => bars(box, {
    rows: routing.map((r) => ({
      label: STRATEGY_WORDS[r.strategy] ?? r.strategy, value: r.count, note: `${r.share}%`,
      tone: r.strategy === "lightest-desk" ? "amber" : r.strategy === "safety-net" ? "seal" : "indigo",
    })),
    empty: "Nothing filed in this window.",
  }));
  const fallback = routing.find((r) => r.strategy === "lightest-desk");
  return panel("How reports found their desk", el("div.panel-body", {}, box,
    fallback && fallback.share > 25
      ? el("div.notice.notice-warn.gutter-top", {},
        el("strong.notice-title", { text: `${fallback.share}% landed by fallback` }),
        el("span", { text: "That many reports matched no category rule and no keyword, so TrustLine guessed. Adding keywords to your categories will place them properly." }))
      : null));
}

/**
 * Who is using it — the kind of person, never the person. This is the number that
 * decides where the next poster goes: if staff have filed nothing in three months,
 * either they have no problems or they do not believe this is for them.
 */
function reporterPanel(rows) {
  const box = chartBox("chart-h");
  queueMicrotask(() => bars(box, {
    rows: rows.map((r) => ({ label: r.label, value: r.count, note: `${r.resolved} closed`, tone: "indigo" })),
    empty: "Nobody has filed yet.",
  }));
  return panel("Who files", el("div.panel-body", {}, box,
    el("p.t-xs.quiet.gutter-top", { text: "The kind of person, counted. TrustLine holds no name to count instead." })));
}

/** Only reporters rate a resolution, and only after it is closed. */
function satisfactionPanel(s) {
  const box = chartBox("chart-h");
  queueMicrotask(() => bars(box, {
    rows: s.spread.map((row) => ({
      label: `${row.score} out of 5`, value: row.count,
      tone: row.score >= 4 ? "green" : row.score === 3 ? "amber" : "seal",
    })),
    empty: "No reporter has rated a resolution yet.",
  }));
  return panel("What reporters thought", el("div.panel-body", {}, box,
    el("div.facts.gutter-top", {},
      fact("Average", s.mean === null ? "—" : `${s.mean} out of 5`),
      fact("Rated", `${fmt.n(s.count)} reports`),
      fact("Of those closed", pct(s.coverage)))));
}

/** Categories that actually get used, and how long each one takes to answer. */
function categoryPanel(rows) {
  if (!rows.length) {
    return panel("By category", el("div.panel-body", {},
      blank("Nothing filed yet", "Once reports arrive this shows which category carries the load.")));
  }
  return panel("By category", el("div.panel-body-tight", {},
    sheet(["Category", "#Filed", "#Open", "#Backed", "#Median"], rows.map((c) => el("tr", {},
      el("td", {}, el("span", { text: c.name }),
        c.confidential ? el("span.chip", {}, icon("lock", "icon-sm"), el("span", { text: "confidential" })) : null),
      numCell(c.total), numCell(c.open || null), numCell(c.backed || null),
      el("td.sheet-num", { text: hours(c.medianHours) }))))));
}

function priorityPanel(rows) {
  const box = chartBox("chart-h");
  const tone = { urgent: "seal", high: "amber", normal: "indigo", low: "green" };
  queueMicrotask(() => bars(box, {
    rows: rows.map((r) => ({ label: r.key, value: r.count, note: `${r.open} open`, tone: tone[r.key] || "indigo" })),
    empty: "Nothing filed yet.",
  }));
  return panel("By priority", el("div.panel-body", {}, box,
    el("p.t-xs.quiet.gutter-top", { text: "A desk can raise a priority freely. Lowering one below the floor the reporter's own situation set is refused." })));
}

function tagPanel(tags) {
  return panel("What keeps coming up", el("div.panel-body", {},
    tags.length
      ? el("div.row.row-wrap", {}, ...tags.map((t) => el("button.chip", {
        type: "button", title: `Show reports tagged ${t.tag}`,
        on: { click: () => Router.go(`/queue?q=${encodeURIComponent(t.tag)}`) },
      }, el("span", { text: t.tag }), el("span.faint", { text: String(t.count) }))))
      : blank("No tags yet", "Officers tag reports from the drawer. Tags are how a pattern becomes visible.")));
}

/* ---- the audit log ---------------------------------------------------------- */

/**
 * Everything that happened, in order.
 *
 * Reporter actions are recorded with no actor at all — the writer labels them
 * "TrustLine" — so reading this log freely can never become a way to work out who
 * filed what. That is why an officer can see it rather than only an admin.
 */
async function viewLog() {
  head("The log", "Every action, in order, with nothing about who reported");
  fill(page(), loading(6));
  try {
    const { events } = await api.get("/api/admin/audit?limit=300");
    fill(page(), logPanel(events, "Nothing has happened in this college yet."));
  } catch (err) { showFailure(err); }
}

function logPanel(events, empty) {
  if (!events.length) return panel("The log", el("div.panel-body", {}, blank("Empty", empty)));
  return el("div.stack", {},
    panel(`Last ${events.length} entries`, el("div.panel-body-tight", {},
      sheet(["When", "What", "Who", "Report"], events.map((e) => el("tr", {},
        el("td.t-xs.nowrap", { text: fmt.date(e.at) }),
        el("td", {}, el("div.t-sm", { text: e.summary || e.action }),
          el("div.t-xs.faint.mono", { text: e.action })),
        el("td.t-xs", { text: e.actorLabel || "TrustLine" }),
        el("td", {}, e.complaintId
          ? el("button.btn.btn-sm.btn-quiet.mono", { type: "button", on: { click: () => openReport(e.complaintId) } }, e.complaintId)
          : el("span.faint", { text: "—" }))))))),
    el("p.t-xs.quiet.measure", { text: "A reporter never appears as an actor here. When someone files, replies or reopens, the log records the act and no identity — there is none to record." }));
}

/* ---- the platform office ---------------------------------------------------- */

/**
 * The third tier, and the least powerful one.
 *
 * The platform office decides who gets to run a college on TrustLine, and that is
 * all it decides. `SuperAdmin.canRead()` returns false for every report, so there is
 * no request this console could make that would return a complaint — the highest tier
 * of the product has the least visibility into it. The note at the top of every
 * platform screen says so, because a visitor to this screen should not have to take
 * it on trust.
 */
const PLATFORM_NOTE = "This office approves colleges and admins. It cannot open a report, and no route exists that would serve one: the account type itself refuses every read. What follows is counts and health only.";

async function viewPlatform() {
  head("Approvals", "Colleges and admins waiting on the platform office");
  fill(page(), loading(4));

  const paint = async () => {
    const [review, stats] = await Promise.all([
      api.get("/api/platform/review"),
      api.get("/api/platform/analytics").catch(() => null),
    ]);
    const view = el("div.stack-loose", {}, el("p.platform-note", { text: PLATFORM_NOTE }));

    if (stats) view.append(el("div.kpis", {},
      el("div.kpi", {}, count(stats.colleges.active, "colleges live"),
        el("div.kpi-delta", { text: `${stats.colleges.pending} waiting · ${stats.colleges.suspended} suspended` })),
      el("div.kpi", {}, count(stats.accounts.active, "staff accounts"),
        el("div.kpi-delta", { text: `${stats.accounts.pending} waiting for review` })),
      el("div.kpi", {}, count(stats.reports.total, "reports filed"),
        el("div.kpi-delta", { text: `${stats.reports.last7Days} in the last week` })),
      el(`div.kpi${stats.reports.overdue ? ".kpi-late" : ""}`, {}, count(stats.reports.overdue, "late across the network", { tone: "seal" }),
        el("div.kpi-delta", { text: stats.reports.medianHours === null ? "Nothing closed yet" : `Median ${hours(stats.reports.medianHours)} to close` }))));

    view.append(panel(`Colleges waiting (${review.colleges.length})`,
      review.colleges.length
        ? el("div", {}, ...review.colleges.map((c) => collegeApplicant(c, paint)))
        : el("div.panel-body", {}, blank("Nothing to review", "Every college that has applied has an answer."))));

    view.append(panel(`Admins waiting (${review.accounts.length})`,
      review.accounts.length
        ? el("div", {}, ...review.accounts.map((a) => adminApplicant(a, paint)))
        : el("div.panel-body", {}, blank("Nothing to review",
          "A second admin at a live college appears here. The founding admin is approved with their college."))));

    fill(page(), view);
  };
  await paint().catch(showFailure);
}

/** Approving a college activates its founding admin in the same call. */
function collegeApplicant(college, reload) {
  const decide = (decision, label, danger) => el(`button.btn.btn-sm${danger ? ".btn-quiet" : ".btn-seal"}`, {
    type: "button",
    on: { click: async () => {
      const note = await confirmAction({
        title: `${label} ${college.shortName || college.name}?`, confirmLabel: label, danger,
        note: decision === "approve"
          ? "The college goes live, its founding admin can sign in, and its page starts accepting reports."
          : "Nobody at this college will be able to sign in. Say why — they are shown this note.",
        needs: { label: "Note", placeholder: decision === "approve" ? "Verified by phone with the principal's office" : "Could not verify this is a real institution" },
      });
      if (note === null) return;
      try {
        const res = await api.post(`/api/platform/colleges/${college.id}/review`, { decision, note });
        toast(decision === "approve" ? `Live. ${res.activated} admin activated.` : "Rejected.", "good");
        await reload(); refreshCounts();
      } catch (err) { failed(err); }
    } },
  }, label);

  return el("div.applicant", {},
    el("div", {},
      el("div.applicant-name", { text: college.name }),
      el("div.applicant-where", { text: [college.place, college.university].filter(Boolean).join(" · ") }),
      el("div.facts.gutter-top", {},
        fact("Address they get", `/c/${college.slug}`),
        fact("Office contact", college.contactEmail || "not given"),
        fact("Email domain", college.emailDomain || "not given"),
        fact("Applied", fmt.date(college.requestedAt))),
      college.admins?.length
        ? el("div.t-sm.quiet.gutter-top", { text: `Founding admin: ${college.admins.map((a) => `${a.name} (${a.email})`).join(", ")}` })
        : el("div.notice.notice-warn.gutter-top", {}, el("span", { text: "No admin account is attached to this application, so approving it activates nobody." }))),
    el("div.applicant-acts", {}, decide("approve", "Approve", false), decide("reject", "Reject", true)));
}

function adminApplicant(account, reload) {
  const decide = (decision, label, danger) => el(`button.btn.btn-sm${danger ? ".btn-quiet" : ".btn-seal"}`, {
    type: "button",
    on: { click: async () => {
      const note = await confirmAction({
        title: `${label} ${account.name}?`, confirmLabel: label, danger,
        note: `${account.college?.name ?? "Their college"} is live. ${decision === "approve" ? "They will be able to read every report in it." : "They will not be able to sign in."}`,
        needs: { label: "Note", placeholder: decision === "approve" ? "Confirmed with the existing admin" : "Not authorised by the college" },
      });
      if (note === null) return;
      try { await api.post(`/api/platform/accounts/${account.id}/review`, { decision, note }); toast(decision === "approve" ? "Approved." : "Rejected.", "good"); await reload(); refreshCounts(); }
      catch (err) { failed(err); }
    } },
  }, label);

  return el("div.applicant", {},
    el("div", {},
      el("div.applicant-name", { text: account.name }),
      el("div.applicant-where", { text: `${roleLabel(account.role)} at ${account.college?.name ?? "an unknown college"}` }),
      el("div.t-xs.quiet.gutter-top", { text: `${account.email} · registered ${fmt.date(account.createdAt)}` })),
    el("div.applicant-acts", {}, decide("approve", "Approve", false), decide("reject", "Reject", true)));
}

/** Every tenant, with the one failure mode worth flagging: set up and never used. */
async function viewPlatformColleges() {
  head("Colleges", "Every tenant on the platform");
  fill(page(), loading(5));

  const paint = async () => {
    const [{ colleges }, stats] = await Promise.all([
      api.get("/api/platform/colleges"),
      api.get("/api/platform/analytics").catch(() => null),
    ]);
    const byId = new Map((stats?.tenants ?? []).map((t) => [t.id, t]));
    const dormant = (stats?.tenants ?? []).filter((t) => t.dormant);

    fill(page(), el("div.stack-loose", {},
      el("p.platform-note", { text: PLATFORM_NOTE }),
      dormant.length
        ? panel("Signed up and never used", el("div.panel-body", {},
          el("p.t-sm.quiet", { text: "These colleges were approved more than a fortnight ago and have never had a report. Usually it means nobody told the students the page exists." }),
          el("div.row.row-wrap.gutter-top", {}, ...dormant.map((t) => el("span.chip", {}, el("span", { text: t.name }))))))
        : null,
      panel("All colleges", el("div.panel-body-tight", {},
        sheet(["College", "Status", "#Reports", "#Open", "#Late", "#Resolved", "#Median", "Last activity"], colleges.map((c) => {
          const t = byId.get(c.id);
          return el("tr", {},
            el("td", {}, el("div", {}, el("strong", { text: c.shortName || c.name })),
              el("div.t-xs.quiet", { text: `/c/${c.slug} · ${c.place || "—"}` }),
              el("div.t-xs.faint", { text: `${c.admins} admin${c.admins === 1 ? "" : "s"} · ${c.contactEmail || "no contact"}` })),
            el("td", {}, pill(c.status, { label: c.status, tone: COLLEGE_TONE[c.status], flat: true }),
              c.reviewNote ? el("div.t-xs.faint", { text: fmt.words(c.reviewNote, 60) }) : null),
            numCell(c.reports), numCell(t?.open ?? null), numCell(t?.overdue || null),
            el("td.sheet-num", { text: pct(t?.resolvedRate) }),
            el("td.sheet-num", { text: hours(t?.medianHours) }),
            el("td.t-xs.nowrap", { text: t?.lastActivityAt ? fmt.when(t.lastActivityAt) : "—" }));
        })))),
      panel("Suspending a college", el("div.panel-body", {},
        el("p.t-sm.quiet.measure", { text: "A suspended college stops accepting new reports and its staff cannot sign in. Nothing is deleted and no report is touched — the data stays exactly where it was, so reinstating is a single decision rather than a restore." })))));
  };
  await paint().catch(showFailure);
}

const COLLEGE_TONE = { active: "good", pending: "warn", suspended: "bad", rejected: "bad" };

/** Network-wide volume. Counts and health per tenant, and never a title. */
async function viewPlatformRecord() {
  head("The network", "Volume and health, with nothing about any report");
  fill(page(), loading(5));

  const stats = await api.get("/api/platform/analytics").catch((err) => {
    showFailure(err);
    return null;
  });
  if (!stats) return;

  const volumeBox = chartBox("chart-h-tall");
  const healthBox = chartBox("chart-h-tall");
  queueMicrotask(() => {
    bars(volumeBox, {
      rows: stats.tenants.filter((t) => t.reports > 0).map((t) => ({
        label: t.shortName || t.name, value: t.reports, note: `${t.open} open`, tone: "indigo",
      })),
      empty: "No college has had a report yet.",
    });
    bars(healthBox, {
      rows: stats.tenants.filter((t) => t.resolvedRate !== null).map((t) => ({
        label: t.shortName || t.name, value: t.resolvedRate, suffix: "%",
        note: `${t.resolvedRate}%`, tone: t.resolvedRate >= 75 ? "green" : t.resolvedRate >= 40 ? "amber" : "seal",
      })),
      empty: "Nothing resolved anywhere yet.",
    });
  });

  fill(page(), el("div.stack-loose", {},
    el("p.platform-note", { text: PLATFORM_NOTE }),
    el("div.kpis", {},
      el("div.kpi", {}, count(stats.reports.total, "reports on the platform"),
        el("div.kpi-delta", { text: `${stats.reports.last7Days} filed in the last week` })),
      el("div.kpi", {}, count(stats.reports.open, "still open"),
        el("div.kpi-delta", { text: `${stats.reports.resolved} resolved all time` })),
      el("div.kpi", {}, count(stats.colleges.total, "colleges"),
        el("div.kpi-delta", { text: `${stats.colleges.active} live · ${stats.colleges.pending} waiting` })),
      el("div.kpi", {}, count(stats.accounts.total, "accounts"),
        el("div.kpi-delta", { text: `${stats.accounts.pending} waiting for review` }))),
    el("div.grid.grid-2", {},
      panel("Reports by college", el("div.panel-body", {}, volumeBox)),
      panel("Resolved rate by college", el("div.panel-body", {}, healthBox))),
    panel("Every tenant", el("div.panel-body-tight", {},
      sheet(["College", "#Desks", "#Categories", "#Reports", "#Open", "#Late", "#Resolved", "#Median"],
        stats.tenants.map((t) => el("tr", {},
          el("td", {}, el("strong", { text: t.name }),
            el("div.t-xs.quiet", { text: `${t.status}${t.dormant ? " · never used" : ""}` })),
          numCell(t.departments), numCell(t.categories), numCell(t.reports),
          numCell(t.open), numCell(t.overdue || null),
          el("td.sheet-num", { text: pct(t.resolvedRate) }),
          el("td.sheet-num", { text: hours(t.medianHours) }))))))));
}

/** The cross-college log. Same guarantee as a college's own: no reporter is an actor. */
async function viewPlatformLog() {
  head("The log", "Every action across every college");
  fill(page(), loading(6));
  try {
    const { events } = await api.get("/api/platform/audit?limit=300");
    fill(page(), el("div.stack-loose", {},
      el("p.platform-note", { text: PLATFORM_NOTE }),
      logPanel(events, "Nothing has happened on the platform yet.")));
  } catch (err) { showFailure(err); }
}

/**
 * What the process is actually doing: rows on disk, events seen, who is listening,
 * and the SLA clock. The sweep button forces the pass that otherwise runs on a minute
 * timer — the demo would be dull if you had to wait for it.
 */
async function viewPlatformSystem() {
  head("System", "What this process is doing right now");
  fill(page(), loading(4));

  const paint = async () => {
    const status = await api.get("/api/platform/status");
    const rows = Object.entries(status.counts).map(([label, n]) => el("tr", {},
      el("td", { text: label }), numCell(n)));

    const sweep = el("button.btn", { type: "button", on: { click: async () => {
      sweep.disabled = true;
      try {
        const out = await api.post("/api/platform/sla/sweep", {});
        toast(`Swept: ${out.escalated.length} escalated, ${out.closed.length} closed, ${out.nudged.length} nudged.`, "good");
        await paint();
      } catch (err) { failed(err); sweep.disabled = false; }
    } } }, icon("refresh"), "Run the sweep now");

    fill(page(), el("div.stack-loose", {},
      el("p.platform-note", { text: PLATFORM_NOTE }),
      el("div.kpis", {},
        el("div.kpi", {}, count(status.events.total, "events since boot", { marks: false }),
          el("div.kpi-delta", { text: `Counting since ${fmt.date(status.events.since)}` })),
        el("div.kpi", {}, count(status.liveClients, "consoles watching"),
          el("div.kpi-delta", { text: "Open dashboards on the live stream" })),
        el("div.kpi", {}, count(status.sla.sweeps, "clock sweeps", { marks: false }),
          el("div.kpi-delta", { text: status.sla.lastSweep ? `Last ${fmt.when(status.sla.lastSweep)}` : "Not swept yet" })),
        el("div.kpi", {}, count(Math.round(status.uptimeSeconds / 60), "minutes up", { marks: false }),
          el("div.kpi-delta", { text: `Booted ${fmt.date(status.booted)}` }))),
      el("div.grid.grid-2", {},
        panel("Rows on disk", el("div.panel-body-tight", {}, sheet(["Store", "#Rows"], rows)), null,
          el("span.t-xs.quiet", { text: "JSON files under data/" })),
        panel("The response clock", el("div.panel-body", {},
          el("div.facts", {},
            fact("Timer", status.sla.running ? "running" : "stopped"),
            fact("Sweeps", fmt.n(status.sla.sweeps)),
            fact("Last sweep", status.sla.lastSweep ? fmt.date(status.sla.lastSweep) : "—")),
          el("p.t-sm.quiet.gutter-top.measure", { text: "A sweep escalates what has run out of time, closes what has been resolved long enough, and nudges reporters who went quiet on a question. It runs every minute on its own." }),
          el("div.row.gutter-top", {}, sweep)))),
      panel("What is listening", el("div.panel-body", {},
        el("p.t-sm.quiet", { text: "Every subscriber bound to the event bus. The audit trail writes the log, the live feed pushes the stream, and the counter keeps the figures above." }),
        el("div.reading.gutter-top", {},
          ...status.listeners.bound.map(({ event, subscribers }) => el("div.reading-item", {},
            el("span.reading-k.mono", { text: event }),
            el("span.reading-v", { text: subscribers.join(", ") }))),
          status.listeners.always.length
            ? el("div.reading-item", {},
              el("span.reading-k", { text: "every event" }),
              el("span.reading-v.reading-v-strong", { text: status.listeners.always.join(", ") }))
            : null))),
      panel("Events seen", el("div.panel-body-tight", {},
        sheet(["Event", "#Count"], status.events.byEvent.map((e) => el("tr", {},
          el("td.mono.t-sm", { text: e.event }), numCell(e.count))))))));
  };
  await paint().catch(showFailure);
}

/* ---- the routes ------------------------------------------------------------- */

/**
 * One table, and it is the whole map of the console.
 *
 * Every path is registered whatever the account is. A desk officer who types
 * `#/settings` gets `viewSettings`, which calls an endpoint the server refuses, and
 * lands on the same "you cannot see this" panel as any other refusal. That is on
 * purpose: hiding a route in the client would only look like security.
 *
 * `/report/:code` exists so a trace code can be pasted into a chat and opened by
 * whoever has the queue open — it draws the queue underneath and the drawer on top,
 * because a report with no context behind it is hard to act on.
 */
router
  .add("/", () => viewDashboard().catch(showFailure))
  .add("/queue", () => viewQueue().catch(showFailure))
  .add("/report/:code", ({ code }) => {
    viewQueue({ title: "The queue", where: "Everything you can act on" })
      .catch(showFailure)
      .finally(() => openReport(code, () => Router.go("/queue", { replace: true })));
  })
  .add("/categories", () => viewCategories().catch(showFailure))
  .add("/desks", () => viewDesks().catch(showFailure))
  .add("/team", () => viewTeam().catch(showFailure))
  .add("/news", () => viewNews().catch(showFailure))
  .add("/record", () => viewRecord().catch(showFailure))
  .add("/log", () => viewLog().catch(showFailure))
  .add("/settings", () => viewSettings().catch(showFailure))
  .add("/platform", () => viewPlatform().catch(showFailure))
  .add("/platform/colleges", () => viewPlatformColleges().catch(showFailure))
  .add("/platform/record", () => viewPlatformRecord().catch(showFailure))
  .add("/platform/log", () => viewPlatformLog().catch(showFailure))
  .add("/platform/system", () => viewPlatformSystem().catch(showFailure))
  .fallback((path) => {
    head("Not a page", path);
    fill(page(), blank("There is nothing at that address",
      "The link may be from an older version of the console.",
      el("a.btn.btn-line", { href: isPlatform() ? "#/platform" : "#/" }, "Back to the dashboard")));
  });

/**
 * A view that threw got as far as the server and was refused, or the server is not
 * there at all. Either way the screen says which, and the rail still works.
 */
function showFailure(err) {
  const forbidden = err instanceof ApiError && (err.status === 403 || err.status === 401);
  fill(page(), blank(
    forbidden ? "This account cannot see that" : "That did not load",
    forbidden
      ? "The console showed you the link, and the server refused it — which is the right way round. Permissions are checked on the request, not in the browser."
      : failed(err),
    el("button.btn.btn-line", { type: "button", on: { click: () => router.refresh() } }, "Try again")));
}

// Everything above is a definition. This is the only line that does anything.
boot();

