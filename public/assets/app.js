// app.js — the reporter's surface.
//
// One module, one hash router, no framework. Every view here is reachable
// without an account and none of them touch a cookie, which is what keeps a
// reporter from having a login that could be linked back to them.
//
// Two rules run through the whole file:
//
//   1. A trace code is a credential. It never goes in a path the browser would
//      send upstream (that is why routing is by `#`), it is never written to
//      storage, and the passphrase that guards it lives in a module variable in
//      ui.js that dies with the tab.
//   2. Nothing the server sends is ever parsed as markup. `el()` has no `html`
//      option; every string arrives as a text node.

import {
  api, ApiError, setTracePass,
  el, fill, $, $$, tally, count, icon, fmt, pill, prio, clock,
  toast, failed, drawer, confirmAction, closeOverlay, debounce, copy,
  fact, blank, loading, Router, markNav,
} from "./ui.js";

const view = $("#view");
const navHost = $("#nav");
const router = new Router();

/* ---- shell ---------------------------------------------------------------- */

function paint(...nodes) {
  fill(view, ...nodes);
  window.scrollTo({ top: 0, behavior: "instant" });
  view.focus({ preventScroll: true });
}

function shell(...kids) { return el("div.shell", {}, ...kids); }

function busy(title) {
  paint(shell(el("div.band-flush", { style: { paddingBlock: "64px" } },
    el("h1.t-lg", { text: title }), loading(3))));
}

/** The masthead links. They change with the college, so they are drawn per view. */
function nav(handle = null) {
  const links = handle
    ? [["#/c/" + handle, "Report"], ["#/c/" + handle + "/feed", "Feed"],
      ["#/c/" + handle + "/record", "Response times"], ["#/trace", "Track"]]
    : [["#/", "Colleges"], ["#/trace", "Track a report"], ["#/join", "For colleges"]];
  fill(navHost, ...links.map(([href, text]) => el("a", { href, text })));
  markNav(navHost, Router.path());
}

function title(text) { document.title = `${text} — TrustLine`; }

/**
 * Turns a thrown error into a page rather than a toast. A view that failed to
 * load has nothing else on screen, so the error has to be the screen.
 */
function crash(err, back = "#/") {
  const known = err instanceof ApiError;
  const heading = known && err.status === 404 ? "Nothing here" : "That did not load";
  const said = known ? err.message : "The server did not answer. Check that it is running and try again.";
  paint(shell(el("div.band-flush", { style: { paddingBlock: "64px" } },
    blank(heading, said, el("a.btn", { href: back }, "Back")))));
  if (!known) console.error(err);
}

/* ---- data ----------------------------------------------------------------- */

/* One in-memory cache per college, so moving between the report form, the feed
   and the numbers page does not re-fetch the same catalogue three times. It is
   dropped on any write, because a stale category list is a misrouted report. */
const cache = new Map();

async function collegeOf(handle) {
  if (cache.has(handle)) return cache.get(handle);
  const data = await api.get(`/api/colleges/${encodeURIComponent(handle)}`);
  cache.set(handle, data);
  return data;
}

function forget(handle) { cache.delete(handle); }

/* ---- home ----------------------------------------------------------------- */

async function viewHome(_params, query) {
  nav();
  title("Report a problem, anonymously");
  const q = query.get("q") || "";
  busy("Finding colleges");

  let colleges;
  try {
    colleges = (await api.get(`/api/colleges?q=${encodeURIComponent(q)}`)).colleges;
  } catch (err) { return crash(err); }

  const filed = colleges.reduce((sum, c) => sum + c.reports, 0);
  const open = colleges.filter((c) => c.acceptsReports).length;

  paint(
    shell(el("div.hero.band", {},
      el("div.hero-grid", {},
        el("div", {},
          el("h1", { text: "Say it without saying who you are." }),
          el("p.hero-sub", {},
            "TrustLine is a college's register kept in the open. Student, staff, parent or "
            + "visitor — anyone adds to it without a name, it reaches the desk that can fix it, "
            + "and one trace code follows your problem start to finish."),
          el("div.hero-actions", {},
            el("a.btn.btn-seal.btn-lg", {
              href: "#picker",
              // "picker" is a section on this page, not a route. Letting it hit the
              // hash router would send the reporter to the "nothing at that address"
              // page, so divert the anchor and scroll to the picker instead.
              on: { click: (e) => {
                e.preventDefault();
                const anchor = document.getElementById("picker");
                if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
              } },
            }, icon("file"), "Report something"),
            el("a.btn.btn-line.btn-lg", { href: "#/trace" }, icon("search"), "Track a report"),
          ),
        ),
        el("div.register", {},
          el("div.register-head", {},
            el("span.register-title", { text: "Marks in the register" }),
            el("span.register-date", { text: fmt.day(Date.now()) }),
          ),
          count(filed, filed === 1 ? "report filed" : "reports filed", { cap: 11, tone: "seal" }),
          el("p.t-sm.quiet.measure-tight", {},
            `Across ${fmt.n(colleges.length)} ${colleges.length === 1 ? "college" : "colleges"}, `
            + `${fmt.n(open)} of them open for reports right now. Every mark is one person `
            + "who decided to say something instead of nothing."),
        ),
      ),
    )),
    picker(colleges, q),
    steps(),
  );
}

/** The college picker. Search runs on the server so a long list stays honest. */
function picker(colleges, q) {
  const list = el("div.entries");
  const draw = (rows) => fill(list, ...(rows.length === 0
    ? [blank("No college by that name", "Try the place instead, or register your college.",
      el("a.btn.btn-sm", { href: "#/join" }, "Register a college"))]
    : rows.map(collegeRow)));
  draw(colleges);

  const box = el("input.input", {
    type: "search", value: q, id: "college-q", autocomplete: "off",
    placeholder: "Your college, or the town it is in",
    on: {
      input: debounce(async (e) => {
        const next = e.target.value.trim();
        Router.go(next ? `/?q=${encodeURIComponent(next)}` : "/", { replace: true });
        try { draw((await api.get(`/api/colleges?q=${encodeURIComponent(next)}`)).colleges); }
        catch (err) { failed(err, "Search did not answer."); }
      }, 240),
    },
  });

  return shell(el("section.band-sunk", { id: "picker" },
    el("div.row-between.gutter-top", {},
      el("div", {},
        el("h2.t-md", { text: "Find your college" }),
        el("p.t-sm.quiet", { text: "Reports go to the college you pick, and nowhere else." }),
      ),
    ),
    el("div.field", {}, el("label.label", { for: "college-q", text: "Search" }), box),
    list,
  ));
}

function collegeRow(college) {
  const shut = !college.acceptsReports;
  return el("a.entry", { href: `#/c/${college.slug}` },
    el("div.entry-head", {},
      el("span.entry-title", { text: college.name }),
      shut ? pill("closed", { label: "Not accepting yet", tone: "neutral", flat: true }) : null,
    ),
    el("p.entry-body", { text: college.motto || `${college.shortName} — ${college.place}` }),
    el("div.entry-foot", {},
      el("span.facts", {},
        fact("Place", college.place),
        fact("Desks", fmt.n(college.departments)),
        fact("Categories", fmt.n(college.categories)),
        fact("Reports", fmt.n(college.reports)),
      ),
    ),
  );
}

/* Numbered because filing really is a sequence, and because the third step is
   the one people do not believe until they read it. */
function steps() {
  const rows = [
    ["Write it", "Pick your college, say what happened. No name, no email, no sign-in. "
      + "The form warns you if you have typed something that identifies you."],
    ["It gets routed", "The words in your report decide which desk it lands on — "
      + "hostel, exams, IT, accounts, grievance. A response clock starts at the same moment."],
    ["Follow it with a code", "Filing gives you one trace code. It is the only way back in, "
      + "so keep it. You can read the desk's replies, answer them, and see the clock."],
  ];
  return shell(el("section.band", {},
    el("h2.t-md", { text: "How it works" }),
    el("div.line.gutter-top", {}, ...rows.map(([name, note]) => el("div.line-item", {},
      el("span.line-node", { "aria-hidden": "true" }),
      el("div", {},
        el("span.line-what", { text: name }),
        el("p.line-note", { text: note }),
      ),
    ))),
  ));
}

/* ---- college home --------------------------------------------------------- */

async function viewCollege({ handle }) {
  nav(handle);
  busy("Opening the register");

  let data;
  try { data = await collegeOf(handle); } catch (err) { return crash(err); }
  const { college, categories, announcements, health } = data;
  title(college.shortName);

  paint(
    shell(el("div.hero.band", {},
      el("div.hero-grid", {},
        el("div", {},
          el("p.t-xs.faint", { text: `${college.place} · ${college.university || "Independent"}` }),
          el("h1", { text: college.name }),
          el("p.hero-sub", { text: college.motto
            || "Say what is wrong here. It reaches the desk that can fix it, and you stay anonymous." }),
          el("div.hero-actions", {},
            college.status === "active"
              ? el("a.btn.btn-seal.btn-lg", { href: `#/c/${handle}/report` }, icon("file"), "Report something")
              : el("span.notice.notice-warn", { text: "This college is not accepting reports yet." }),
            college.publicFeed
              ? el("a.btn.btn-line.btn-lg", { href: `#/c/${handle}/feed` }, icon("layers"), "Read the feed")
              : null,
          ),
        ),
        healthPanel(health, handle),
      ),
    )),
    announcements.length ? noticeBoard(announcements, handle) : null,
    categoryBoard(categories, handle),
  );
}

/**
 * The college's own numbers, on its own front page, including the ones it would
 * rather not print. `worst` is deliberately absent from this payload — see the
 * comment on SlaService.health — so this shows counts only.
 */
function healthPanel(health, handle) {
  return el("div.panel.panel-seal", {},
    el("div.panel-head", {},
      el("span.panel-title", { text: "Where this college stands today" }),
    ),
    el("div.panel-body", {},
      el("div.grid.grid-2", {},
        count(health.open, "open", { cap: 6 }),
        count(health.overdue, "past their response time", { cap: 6, tone: "seal" }),
      ),
      el("div.facts.gutter-top", {},
        fact("Due within 12 hours", fmt.n(health.dueSoon)),
        fact("Escalated to the admin", fmt.n(health.escalated)),
        fact("Answered in time", health.onTimeRate === null ? "No history yet" : `${health.onTimeRate}%`),
        fact("Typical time to resolve", health.medianResolutionHours === null
          ? "No history yet" : `${health.medianResolutionHours} hours`),
      ),
      el("a.btn.btn-quiet.btn-sm.gutter-top", { href: `#/c/${handle}/record` },
        icon("chart", "icon-sm"), "See the full record"),
    ),
  );
}

function noticeBoard(announcements, handle) {
  return shell(el("section.band-sunk", {},
    el("h2.t-md", {}, icon("megaphone"), " From the college"),
    el("div.entries", {}, ...announcements.map((note) => el("article.entry", {},
      el("div.entry-head", {},
        el("span.entry-title", { text: note.title }),
        note.pinned ? pill("pinned", { label: "Pinned", tone: "neutral", flat: true }) : null,
      ),
      el("p.entry-body", { text: note.body }),
      el("div.entry-foot", {},
        el("span.t-xs.quiet", { text: `${note.authorName} · ${fmt.when(note.at)}` }),
        note.linked.length
          ? el("span.row-wrap.push", {}, ...note.linked.map((r) => el("a.chip", {
            href: `#/c/${handle}/entry/${encodeURIComponent(r.traceCode)}`,
          }, el("span.trace-sm", { text: fmt.code(r.traceCode) }), r.statusLabel)))
          : null,
      ),
    ))),
  ));
}

/**
 * What this college takes reports about. Confidential categories are shown and
 * marked, not hidden: knowing that a private route exists is the reason someone
 * uses it, and the marking is the promise that it stays off the feed.
 */
function categoryBoard(categories, handle) {
  if (categories.length === 0) {
    return shell(el("section.band", {}, blank("No desks yet",
      "This college has not finished setting up where reports go. Nothing can be filed until it does.")));
  }
  return shell(el("section.band", {},
    el("h2.t-md", { text: "What you can report here" }),
    el("div.grid.grid-3", {}, ...categories.map((cat) => el("a.choice", {
      href: `#/c/${handle}/report?category=${encodeURIComponent(cat.id)}`,
    },
      el("span.choice-mark", { "aria-hidden": "true" }),
      el("div.choice-body", {},
        el("span.choice-title", {}, icon(cat.glyph || "file", "icon-sm"), cat.name),
        el("p.choice-note", { text: cat.description || "" }),
        el("div.row-wrap", {},
          cat.confidential
            ? el("span.chip", {}, icon("lock", "icon-sm"), "Never on the feed")
            : (cat.allowPublic ? el("span.chip", {}, icon("eye", "icon-sm"), "Can be public") : null),
          cat.requireEvidence ? el("span.chip", {}, icon("note", "icon-sm"), "Needs evidence") : null,
          cat.audiences.length ? el("span.chip", { text: cat.audiences.join(", ") }) : null,
        ),
      ),
    ))),
  ));
}

/* ---- the feed ------------------------------------------------------------- */

const SORTS = [["hot", "Active"], ["new", "Newest"], ["backed", "Most backed"],
  ["urgent", "Most urgent"], ["resolved", "Recently fixed"]];

async function viewFeed({ handle }, query) {
  nav(handle);
  busy("Reading the feed");

  const params = new URLSearchParams({
    sort: query.get("sort") || "hot",
    limit: "60",
  });
  if (query.get("category")) params.set("category", query.get("category"));
  if (query.get("status")) params.set("status", query.get("status"));
  if (query.get("q")) params.set("q", query.get("q"));

  let data;
  try {
    data = await api.get(`/api/colleges/${encodeURIComponent(handle)}/feed?${params}`);
  } catch (err) { return crash(err); }

  const { college, reports, categories } = data;
  title(`Feed — ${college.shortName}`);

  if (!college.publicFeed) {
    return paint(shell(el("div.band", {}, blank("This college keeps its feed closed",
      `${college.shortName} has turned the public feed off. Reports still reach the desks, and you can still `
      + "follow your own with its trace code.",
      el("a.btn", { href: `#/c/${handle}/report` }, "Report something")))));
  }

  paint(
    feedHead(college, data, handle, query),
    shell(el("section.band-tight", {},
      reports.length === 0
        ? blank("Nothing matches", "No public report here fits those filters yet.")
        : el("div.entries", {}, ...reports.map((r) => feedRow(r, handle))),
    )),
  );
}

function feedHead(college, data, handle, query) {
  // The router keys on the path, so a filter change (query only) never re-runs the
  // route. That is on purpose — the hash still updates so the view is linkable and
  // the back button works, and the redraw is done here.
  const go = (patch) => {
    const next = new URLSearchParams(query.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const qsPart = next.toString();
    Router.go(`/c/${handle}/feed${qsPart ? "?" + qsPart : ""}`);
    viewFeed({ handle }, Router.query());
  };
  const categories = data.categories ?? [];
  const sort = query.get("sort") || "hot";
  const category = query.get("category") || "";
  const status = query.get("status") || "";

  return shell(el("div.band-tight", {},
    el("div.row-between.row-wrap", {},
      el("div", {},
        el("p.t-xs.faint", { text: college.shortName }),
        el("h1.t-lg", { text: "What people here have reported" }),
        el("p.t-sm.quiet.measure", {},
          `${fmt.n(data.total ?? data.reports.length)} public ${(data.total ?? 0) === 1 ? "report" : "reports"}. `
          + "Reports are here because the person who filed them chose to publish them — "
          + "backing one tells the desk it is not just one person's problem."),
      ),
      el("a.btn.btn-seal", { href: `#/c/${handle}/report` }, icon("plus"), "Add yours"),
    ),

    el("div.filters", {},
      el("div.tabs", {}, ...SORTS.map(([key, label]) => el("button.tab", {
        type: "button", "aria-selected": String(key === sort),
        on: { click: () => go({ sort: key === "hot" ? "" : key }) },
      }, label))),
      el("div.row-wrap.push", {},
        el("select.select", {
          "aria-label": "Category",
          on: { change: (e) => go({ category: e.target.value }) },
        },
          el("option", { value: "", selected: !category, text: "Every category" }),
          ...categories.map((c) => el("option", {
            value: c.id, selected: c.id === category, text: `${c.name} (${c.count})`,
          })),
        ),
        el("select.select", {
          "aria-label": "Status",
          on: { change: (e) => go({ status: e.target.value }) },
        },
          el("option", { value: "", selected: !status, text: "Open and closed" }),
          el("option", { value: "open", selected: status === "open", text: "Still open" }),
          el("option", { value: "resolved", selected: status === "resolved", text: "Dealt with" }),
        ),
        el("input.input", {
          type: "search", value: query.get("q") || "", placeholder: "Search these reports",
          "aria-label": "Search reports", style: { width: "min(240px, 100%)" },
          on: { change: (e) => go({ q: e.target.value.trim() }) },
        }),
      ),
    ),
  ));
}

/* A ledger entry, not a card: hairline-ruled, priority in the margin, the
   backing count as marks. `reporter.label` is a role ("A student"), never a
   person — the handle beside it is generated per report. */
function feedRow(r, handle) {
  const node = el(`article.entry${r.priority === "urgent" ? ".entry-urgent" : ""}`);
  node.append(
    el("div.entry-head", {},
      prio(r.priority),
      el("h3.entry-title", {}, el("a", {
        href: `#/c/${handle}/entry/${encodeURIComponent(r.traceCode)}`, text: r.title,
      })),
      pill(r.status, { label: r.statusLabel, tone: r.tone }),
      r.isOverdue ? pill("overdue", { label: "Late", tone: "bad", flat: true }) : null,
    ),
    el("p.entry-body", { text: fmt.words(r.body, 240) }),
    el("div.entry-foot", {},
      el("span.facts", {},
        fact("Filed by", r.reporter.label),
        fact("About", r.categoryName),
        r.departmentName ? fact("With", r.departmentName) : null,
        fact("Filed", fmt.when(r.createdAt)),
        r.replyCount ? fact("Replies", fmt.n(r.replyCount)) : null,
      ),
      backing(r),
    ),
  );
  return node;
}

/**
 * "I face this too." One per person per report, counted without knowing who —
 * the server derives a key from the request and stores only the hash, so the
 * only honest way to show a refusal is the 409 it sends back.
 */
function backing(r) {
  const marks = el("span.count-marks", {}, tally(r.supportCount, { cap: 5 }));
  const button = el("button.back", { type: "button", "data-backed": "false" },
    icon("up", "icon-sm"),
    "I face this too",
    el("span.back-n", { text: `· ${fmt.n(r.supportCount)}` }),
  );

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const res = await api.post(`/api/reports/${encodeURIComponent(r.traceCode)}/support`);
      fill(marks, tally(res.supportCount, { cap: 5 }));
      button.dataset.backed = "true";
      fill(button, icon("check", "icon-sm"), "Counted",
        el("span.back-n", { text: `· ${fmt.n(res.supportCount)}` }));
      toast("Counted. The desk sees this is more than one person.", "good");
    } catch (err) {
      failed(err);
      if (err instanceof ApiError && err.status === 409) {
        button.dataset.backed = "true";
        fill(button, icon("check", "icon-sm"), "Already counted");
      } else button.disabled = false;
    }
  });

  return el("span.row.push", {}, marks, button);
}

/* ---- one public report ---------------------------------------------------- */

async function viewEntry({ handle, code }) {
  nav(handle);
  busy("Opening the report");

  let r;
  try { r = await api.get(`/api/reports/${encodeURIComponent(code)}`); }
  catch (err) { return crash(err, `#/c/${handle}/feed`); }
  title(r.title);

  paint(shell(el("div.band", {},
    el("a.btn.btn-quiet.btn-sm", { href: `#/c/${handle}/feed` }, icon("chevron", "icon-sm"), "All reports"),
    el("div.split", {},
      el("div", {},
        el("div.row-wrap", {}, prio(r.priority), pill(r.status, { label: r.statusLabel, tone: r.tone })),
        el("h1", { text: r.title }),
        el("div.facts.gutter-top", {},
          fact("Filed by", r.reporter.label),
          fact("Known as", r.handle),
          fact("About", r.categoryName),
          r.departmentName ? fact("Handled by", r.departmentName) : null,
          fact("Filed", fmt.date(r.createdAt)),
          r.location ? fact("Where", r.location) : null,
          r.occurredAt ? fact("Happened", fmt.day(r.occurredAt)) : null,
          r.resolvedAt ? fact("Resolved", fmt.date(r.resolvedAt)) : null,
          r.satisfaction ? fact("Reporter rated it", `${r.satisfaction} of 5`) : null,
        ),
        el("div.measure.gutter-top-lg", {}, ...paragraphs(r.body)),
        r.tags.length ? el("div.row-wrap.gutter-top", {}, ...r.tags.map((t) => el("span.chip", {}, icon("tag", "icon-sm"), t))) : null,
        threadList(r.thread, { title: "What has been said" }),
      ),
      el("aside.panel.sticky", {},
        el("div.panel-head", {}, el("span.panel-title", { text: "This report" })),
        el("div.panel-body", {},
          el("div.trace.trace-lg", { text: fmt.code(r.traceCode) }),
          el("p.t-xs.quiet", { text: "A public report can be read by anyone with this code. "
            + "Only the person who filed it can reply to the desk." }),
          el("div.gutter-top", {}, backing(r)),
          el("a.btn.btn-line.btn-block.gutter-top", { href: `#/c/${handle}/report` },
            icon("plus", "icon-sm"), "Report something else"),
        ),
      ),
    ),
  )));
}

/** Text a person typed, split on blank lines. Never markup — see el(). */
function paragraphs(text) {
  return String(text || "").split(/\n{2,}/).map((part) => el("p.prose.measure", { text: part.trim() }));
}

/**
 * The correspondence file. A desk reply, a reporter's answer and a line the
 * system wrote look different from each other on purpose — the one thing a
 * reporter must never have to guess is who is talking to them.
 */
function threadList(messages, { title: heading = "The thread", empty = null } = {}) {
  const rows = (messages || []).filter((m) => !m.internal);
  return el("section.gutter-top-lg", {},
    el("h2.t-md", { text: heading }),
    rows.length === 0
      ? blank("Nothing yet", empty || "No messages on this report.")
      : el("div.thread", {}, ...rows.map(messageRow)),
  );
}

function messageRow(m) {
  const kind = m.authorType === "reporter" ? "msg-reporter"
    : m.authorType === "officer" ? "msg-desk" : "msg-system";
  const note = m.kind === "nudge" || m.kind === "note";
  return el(`div.msg.${kind}${note ? ".msg-note" : ""}`, {},
    el("div.msg-who", {},
      el("span.msg-by", { text: m.authorLabel }),
      el("span.msg-when", { text: fmt.when(m.at) }),
    ),
    el("div.msg-text", {}, ...paragraphs(m.body)),
  );
}

/* ---- the report form ------------------------------------------------------ */

/**
 * Four steps, because the questions are genuinely of four kinds and a single
 * long form is where reports get abandoned. The draft lives in one object; the
 * reading panel on the right is refreshed from POST /api/reports/preview on a
 * debounce, so the privacy warning arrives while there is still time to act on
 * it rather than as a rejection at the end.
 */
async function viewReport({ handle }, query) {
  nav(handle);
  busy("Opening the form");

  let data;
  try { data = await collegeOf(handle); } catch (err) { return crash(err); }
  const { college, categories, reporters } = data;
  title(`Report something — ${college.shortName}`);

  if (college.status !== "active" || categories.length === 0) {
    return paint(shell(el("div.band", {}, blank("Not open for reports",
      `${college.shortName} has not finished setting up its desks, so nothing can be filed yet.`,
      el("a.btn", { href: `#/c/${handle}` }, "Back to the college")))));
  }

  const draft = {
    college: handle,
    reporterKey: reporters[0]?.key || "student",
    categoryId: query.get("category") || "",
    title: "", body: "", location: "", occurredAt: "",
    wantsPublic: Boolean(college.publicFeed),
    passphrase: "", evidence: "",
    contact: { sharing: "none", channel: "phone", value: "" },
  };

  const state = { step: 0, preview: null, filing: false };
  const form = el("div");
  const reading = el("aside.reading.sticky");
  paint(shell(el("div.band", {},
    el("a.btn.btn-quiet.btn-sm", { href: `#/c/${handle}` }, icon("chevron", "icon-sm"), college.shortName),
    el("div.split", {}, form, reading),
  )));

  const STEPS = ["Who you are", "What happened", "Who sees it", "Send it"];
  const chosen = () => categories.find((c) => c.id === draft.categoryId) || null;

  const reread = debounce(async () => {
    if (draft.title.trim().length === 0 && draft.body.trim().length === 0) {
      state.preview = null; drawReading(); return;
    }
    try {
      state.preview = await api.post("/api/reports/preview", {
        college: handle,
        title: draft.title,
        body: draft.body,
        categoryId: draft.categoryId || null,
        reporterKey: draft.reporterKey,
      });
    } catch { /* the panel is advice; a failed dry run must not block typing */ }
    drawReading();
  }, 420);

  function drawReading() { fill(reading, readingPanel(state.preview, draft, college, chosen(), handle)); }

  function goStep(n) {
    state.step = Math.max(0, Math.min(STEPS.length - 1, n));
    drawForm();
    drawReading();
  }

  function drawForm() {
    const body = [stepOne, stepTwo, stepThree, stepFour][state.step]();
    fill(form,
      el("div.steps", {}, ...STEPS.map((label, i) => el("button.step", {
        type: "button",
        "data-state": i === state.step ? "now" : (i < state.step ? "done" : "next"),
        disabled: i > state.step,
        on: { click: () => goStep(i) },
      }, el("span.step-n", { text: String(i + 1) }), el("span.step-name", { text: label })))),
      el("h1.t-lg.gutter-top", { text: STEPS[state.step] }),
      body,
    );
  }

  /* ---- step 1: who is filing, and about what ---- */
  function stepOne() {
    const wrap = el("div.stack-loose");
    wrap.append(
      el("p.t-sm.quiet.measure", { text: "This is the only thing we ask about you, and it is a "
        + "kind rather than a name. It decides which categories are open to you and how the desk "
        + "reads the report — nothing else." }),
      el("div.choices-2", {}, ...reporters.map((r) => choiceRow({
        name: "who", checked: draft.reporterKey === r.key, title: r.label, note: r.blurb,
        onPick: () => { draft.reporterKey = r.key; reread(); },
      }))),
    );

    const open = categories.filter((c) => c.audiences.length === 0 || c.audiences.includes(draft.reporterKey));
    wrap.append(
      el("h2.t-md.gutter-top", { text: "What is it about?" }),
      el("p.t-sm.quiet.measure", { text: "Pick the closest one. If you are not sure, leave it — "
        + "the words in your report will route it and a person checks the routing afterwards." }),
      el("div.choices-2", {},
        choiceRow({
          name: "cat", checked: draft.categoryId === "", title: "Let TrustLine decide",
          note: "Routed from what you write, then confirmed by a person at the desk.",
          onPick: () => { draft.categoryId = ""; reread(); },
        }),
        ...open.map((c) => choiceRow({
          name: "cat", checked: draft.categoryId === c.id, title: c.name,
          note: [c.description, c.confidential ? "Never appears on the feed." : null,
            c.requireEvidence ? "You will be asked what you can show." : null].filter(Boolean).join(" "),
          glyph: c.glyph,
          onPick: () => { draft.categoryId = c.id; reread(); },
        })),
      ),
      navRow({ next: () => goStep(1) }),
    );
    return wrap;
  }

  /* ---- step 2: the report itself ---- */
  function stepTwo() {
    const cat = chosen();
    const wrap = el("div.stack-loose");
    const err = el("p.field-error", { role: "alert" });

    const titleCount = el("span.counter", { text: "0 / 140" });
    const bodyCount = el("span.counter", { text: "0 / 4000" });

    const titleField = field({
      label: "One line that says what is wrong", hint: "Six characters or more. This is what a desk sees first.",
      after: titleCount,
      input: el("input.input", {
        type: "text", value: draft.title, maxlength: "140", autofocus: true,
        placeholder: "Water has been off in the boys' hostel since Monday",
        on: { input: (e) => { draft.title = e.target.value; markFields(); reread(); } },
      }),
    });

    const bodyField = field({
      label: "What happened", hint: "What, where, when, and what you have already tried. "
        + "Do not put your name, roll number or phone number in here — the panel beside this will tell you if you do.",
      after: bodyCount,
      input: el("textarea.textarea", {
        rows: "9", maxlength: "4000", placeholder: "Write it the way you would tell a friend.",
        on: { input: (e) => { draft.body = e.target.value; markFields(); reread(); } },
      }, draft.body),
    });

    wrap.append(titleField, bodyField, el("div.grid.grid-2", {},
      field({
        label: "Where (optional)",
        input: el("input.input", {
          type: "text", value: draft.location, maxlength: "120", placeholder: "Block C, second floor",
          on: { input: (e) => { draft.location = e.target.value; } },
        }),
      }),
      field({
        label: "When did it happen (optional)",
        input: el("input.input", {
          type: "date", value: draft.occurredAt, max: new Date().toISOString().slice(0, 10),
          on: { input: (e) => { draft.occurredAt = e.target.value; } },
        }),
      }),
    ));

    let evidenceField = null;
    if (cat?.requireEvidence) {
      const ef = field({
        label: `What can you show the desk?`,
        hint: `“${cat.name}” needs something to look at. Describe it here — a photo, a receipt, a screenshot, `
          + "a witness. Nothing is uploaded: TrustLine stores no files, so the desk will ask you for it in the thread.",
        input: el("textarea.textarea", {
          rows: "3", maxlength: "300", placeholder: "A photo of the notice board taken on Tuesday morning",
          on: { input: (e) => { draft.evidence = e.target.value; markFields(); } },
        }, draft.evidence),
      });
      evidenceField = ef;
      wrap.append(ef);
    }

    const bad = (f, on) => { if (f) f.classList.toggle("field-bad", on); };
    function markFields() {
      const t = draft.title.trim().length;
      const b = draft.body.trim().length;
      const e = (draft.evidence || "").trim().length;
      bad(titleField, t < 6);
      bad(bodyField, b < 20);
      bad(evidenceField, cat?.requireEvidence && e < 3);
      titleCount.textContent = `${t} / 140`;
      bodyCount.textContent = `${b} / 4000`;
      titleCount.classList.toggle("counter-bad", t < 6);
      bodyCount.classList.toggle("counter-bad", b < 20);
    }
    markFields();

    wrap.append(err, navRow({
      back: () => goStep(0),
      next: () => {
        const problem = draftProblem(draft, cat);
        if (problem) {
          fill(err, problem);
          markFields();
          const first = [titleField, bodyField, evidenceField]
            .find((f) => f && f.classList.contains("field-bad"));
          first?.querySelector("input, textarea")?.focus();
          return;
        }
        fill(err);
        markFields();
        goStep(2);
      },
    }));
    return wrap;
  }

  /* ---- step 3: visibility, the passphrase, and contact ---- */
  function stepThree() {
    const cat = chosen();
    const canPublish = college.publicFeed && (!cat || (cat.allowPublic && !cat.confidential));
    const wrap = el("div.stack-loose");

    wrap.append(canPublish
      ? switchRow({
        checked: draft.wantsPublic, label: "Put this on the college feed",
        note: "Other people can read it, back it, and see it was dealt with. Your handle is generated — "
          + "it is not your name. Turn this off and only you and the desk can see it.",
        onChange: (on) => { draft.wantsPublic = on; drawReading(); },
      })
      : el("div.notice", {},
        el("span.notice-title", {}, icon("lock", "icon-sm"), " This one stays private"),
        el("p", { text: cat?.confidential
          ? `“${cat.name}” never appears on a feed, whatever else you choose. Only the handling desk and you can read it.`
          : `${college.shortName} does not run a public feed, so every report here is private to you and the desk.` }),
      ));

    const passRequired = college.requirePassphrase;
    wrap.append(el("div.panel", {},
      el("div.panel-head", {}, el("span.panel-title", {}, icon("lock", "icon-sm"),
        passRequired ? " Set a passphrase" : " Add a passphrase (optional)")),
      el("div.panel-body", {},
        el("p.t-sm.quiet.measure-tight", { text: passRequired
          ? `${college.shortName} requires one. Your trace code alone will not open the report — the code and this together will.`
          : "With one, someone who finds your trace code still cannot read the report. Without one, the code is enough. "
            + "There is no way to reset it, so pick something you will not lose." }),
        field({
          label: "Passphrase",
          input: el("input.input", {
            type: "text", value: draft.passphrase, maxlength: "72", autocomplete: "off",
            placeholder: "four words you will remember",
            on: { input: (e) => { draft.passphrase = e.target.value; } },
          }),
        }),
      ),
    ));

    wrap.append(contactBlock(draft, college));
    wrap.append(navRow({ back: () => goStep(1), next: () => goStep(3) }));
    return wrap;
  }

  /* ---- step 4: read it back, then send ---- */
  function stepFour() {
    const cat = chosen();
    const err = el("p.field-error", { role: "alert" });
    const send = el("button.btn.btn-seal.btn-lg", { type: "button" }, icon("send"), "File this report");

    send.addEventListener("click", async () => {
      const bad = draftProblem(draft, cat);
      const badPass = bad ? null : passProblem(draft, college);
      if (bad || badPass) { fill(err, bad || badPass); goStep(bad ? 1 : 2); return; }
      if (state.filing) return;
      state.filing = true;
      send.disabled = true;
      fill(send, icon("clock"), "Filing…");
      try {
        const res = await api.post("/api/reports", {
          college: handle,
          title: draft.title.trim(),
          body: draft.body.trim(),
          reporterKey: draft.reporterKey,
          wantsPublic: draft.wantsPublic,
          location: draft.location.trim(),
          categoryId: draft.categoryId || null,
          occurredAt: draft.occurredAt ? Date.parse(draft.occurredAt) : null,
          passphrase: draft.passphrase.trim(),
          evidence: draft.evidence.trim() ? [{ name: draft.evidence.trim() }] : [],
          contact: draft.contact.sharing !== "none" && draft.contact.value.trim()
            ? { ...draft.contact, value: draft.contact.value.trim() } : null,
        });
        // Held in memory only, so the reporter can walk straight into their own
        // report from the receipt without typing the passphrase again.
        if (draft.passphrase.trim()) setTracePass(draft.passphrase.trim());
        forget(handle);
        receiptScreen(res, handle, draft);
      } catch (e) {
        state.filing = false;
        send.disabled = false;
        fill(send, icon("send"), "File this report");
        fill(err, failed(e, "The report was not filed."));
      }
    });

    return el("div.stack-loose", {},
      el("p.t-sm.quiet.measure", { text: "Read it once more. After this, the report belongs to the desk — "
        + "you can add to it in the thread, but the college keeps what you wrote." }),
      el("div.panel", {},
        el("div.panel-head", {}, el("span.panel-title", { text: draft.title || "No summary yet" })),
        el("div.panel-body", {},
          el("div.facts", {},
            fact("Filed as", reporters.find((r) => r.key === draft.reporterKey)?.label ?? draft.reporterKey),
            fact("About", cat ? cat.name : "TrustLine will decide"),
            fact("Where", draft.location.trim() || "Not said"),
            fact("When", draft.occurredAt ? fmt.day(Date.parse(draft.occurredAt)) : "Not said"),
            fact("On the feed", draft.wantsPublic && college.publicFeed ? "Yes, publicly" : "No, private"),
            fact("Passphrase", draft.passphrase.trim() ? "Set" : "None"),
            fact("Contact shared", draft.contact.sharing === "none" || !draft.contact.value.trim()
              ? "Nothing" : `${draft.contact.channel} with ${draft.contact.sharing === "admin_only" ? "the admin" : "the desk"}`),
          ),
          el("div.gutter-top", {}, ...paragraphs(draft.body || "Nothing written yet.")),
        ),
      ),
      err,
      el("div.row", {},
        el("button.btn.btn-quiet", { type: "button", on: { click: () => goStep(2) } }, "Back"),
        el("span.push", {}, send),
      ),
    );
  }

  goStep(query.get("category") ? 1 : 0);
}

/* ---- form parts ----------------------------------------------------------- */

let fieldSeq = 0;

function field({ label, hint = null, input, after = null }) {
  const id = `f${(fieldSeq += 1)}`;
  input.id = id;
  const kids = [el("label.label", { for: id, text: label })];
  if (hint) kids.push(el("p.hint", { text: hint }));
  kids.push(input);
  if (after) kids.push(after);
  return el("div.field", {}, ...kids);
}

/** A radio in the shape of a card, ticked with a seal edge rather than a dot. */
function choiceRow({ name, checked, title: heading, note, glyph = null, onPick }) {
  const id = `c${(fieldSeq += 1)}`;
  const label = el("label.choice", { for: id, "data-picked": String(Boolean(checked)) });
  label.append(
    el("input.sr", {
      type: "radio", name, id, checked,
      on: {
        change: () => {
          // Only the picked card is re-marked, so the form is never re-rendered
          // mid-typing and nothing loses focus.
          for (const other of $$(`.choice:has(input[name="${name}"])`)) other.dataset.picked = "false";
          label.dataset.picked = "true";
          onPick();
        },
      },
    }),
    el("span.choice-mark", { "aria-hidden": "true" }),
    el("span.choice-body", {},
      el("span.choice-title", {}, glyph ? icon(glyph, "icon-sm") : null, heading),
      note ? el("span.choice-note", { text: note }) : null,
    ),
  );
  return label;
}

function switchRow({ checked, label, note, onChange }) {
  const id = `s${(fieldSeq += 1)}`;
  const box = el("input.sr", { type: "checkbox", id, checked, on: { change: (e) => onChange(e.target.checked) } });
  return el("label.switch", { for: id },
    box,
    el("span.switch-track", { "aria-hidden": "true" }),
    el("span.switch-text", {},
      el("span.choice-title", { text: label }),
      el("span.choice-note", { text: note }),
    ),
  );
}

function navRow({ back = null, next = null, nextLabel = "Next" }) {
  return el("div.row.gutter-top", {},
    back ? el("button.btn.btn-quiet", { type: "button", on: { click: back } }, "Back") : null,
    next ? el("span.push", {}, el("button.btn", { type: "button", on: { click: next } },
      nextLabel, icon("arrow", "icon-sm"))) : null,
  );
}

/* ---- the reading panel ----------------------------------------------------
   The dry run at POST /api/reports/preview writes nothing, so this panel can say
   what the draft gives away, what looks like a duplicate and which desk it is
   about to reach — while the person is still typing, when the advice is still
   useful. None of it blocks filing. Advice that blocks gets worked around. */

function readingPanel(preview, draft, college, cat, handle) {
  const box = el("div.panel", {},
    el("div.panel-head", {},
      el("span.panel-title", { text: "What this draft says" }),
      el("span.t-xs.faint", { text: preview ? "live" : "waiting" }),
    ),
  );
  const body = el("div.panel-body.stack", {});
  box.append(body);

  if (!preview) {
    body.append(el("p.t-sm.quiet", { text: "Start writing and this panel will tell you what your words "
      + "reveal about you, whether someone has already reported it, and which desk it is heading for." }));
    return box;
  }

  const findings = preview.privacy?.findings ?? [];
  if (findings.length) {
    for (const f of findings.slice(0, 3)) {
      body.append(el(`div.warn${f.severity === "block" ? ".warn-hard" : ""}`, {},
        el("div.warn-title", {}, icon("alert"), f.label),
        el("p.warn-body", {}, f.advice, " ", el("span.warn-sample", { text: f.sample })),
      ));
    }
  } else {
    body.append(el("div.notice.notice-good", {},
      el("span.notice-title", { text: "Nothing identifying yet" }),
      "No name, number, roll number or email found in what you have written.",
    ));
  }

  if (preview.privacy?.abusive) {
    body.append(el("div.warn", {},
      el("div.warn-title", {}, icon("flag"), "Strong language"),
      el("p.warn-body", { text: "A desk acts on what happened, not on how it is put. "
        + "Say the thing plainly and it lands harder." }),
    ));
  }

  body.append(readingRows(preview, draft, college, cat, handle));
  return box;
}
function readingRows(preview, draft, college, cat, handle) {
  const rows = el("div.reading", {});
  const row = (k, ...v) => rows.append(el("div.reading-item", {},
    el("div.reading-k", { text: k }), el("div.reading-v", {}, ...v)));

  if (preview.routing) {
    row("Heading for",
      el("span.reading-v-strong", { text: preview.routing.department }),
      el("div.t-xs.quiet", { text: `${preview.routing.explains} · ${preview.routing.confidence}% sure` }),
    );
  } else {
    row("Heading for", el("span.reading-empty", { text: "Pick a category or write a little more." }));
  }

  const nudges = preview.quality?.nudges ?? [];
  row("Detail", nudges.length === 0
    ? el("span", { text: `${preview.quality?.wordCount ?? 0} words. Enough for a desk to act on.` })
    : el("div.stack-tight", {}, ...nudges.map((n) => el("div", { text: n }))));

  const dupes = preview.duplicates ?? [];
  if (dupes.length) {
    const list = el("div.stack-tight", {});
    for (const d of dupes) {
      list.append(el("div", {},
        el("a", { href: `#/c/${handle}/entry/${encodeURIComponent(d.traceCode)}`, text: d.title }),
        el("div.t-xs.quiet", { text: `${d.statusLabel} · ${fmt.n(d.supportCount)} backing · ${d.confidence}% alike` }),
      ));
    }
    list.append(el("p.t-xs.quiet", { text: "If one of these is your problem too, back it instead — "
      + "one report with twenty people behind it moves faster than twenty reports." }));
    row("Already reported", list);
  }

  row("On the feed", draft.wantsPublic
    ? el("span", { text: "Yes — anyone can read it, under your generated handle." })
    : el("span", { text: college.publicFeed
      ? "No — only the desk handling it will see it."
      : "This college keeps its feed closed, so private either way." }));

  if (preview.passphraseRequired) {
    row("Passphrase", draft.passphrase.trim().length >= 4
      ? el("span", { text: "Set. You will need it to open this report again." })
      : el("span.seal-ink", { text: `${college.shortName} requires one before you can file.` }));
  }

  if (cat?.confidential) row("Category", el("span", { text: `${cat.name} never appears on the feed.` }));
  return rows;
}
/* Mirrors of the server's own rules (ComplaintService.#validateDraft). The server
   is still the authority — this only avoids a round trip to be told something the
   form already knew. Keep the numbers in step with config.limits. */
function draftProblem(draft, cat) {
  if (draft.title.trim().length < 6) return "Give it a title of at least six characters.";
  if (draft.body.trim().length < 20) return "Describe what happened in at least twenty characters.";
  if (cat?.requireEvidence && draft.evidence.trim().length < 3) {
    return `“${cat.name}” needs you to say what you can show the desk.`;
  }
  return null;
}

function passProblem(draft, college) {
  if (college.requirePassphrase && draft.passphrase.trim().length < 4) {
    return `${college.shortName} requires a passphrase of at least four characters.`;
  }
  if (draft.contact.sharing !== "none" && draft.contact.value.trim().length < 4) {
    return "Add the number or address you want the desk to use, or set sharing back to no.";
  }
  return null;
}

/* The only place a reporter can attach something identifying. Opt in, scoped, and
   withdrawable later from the tracking page. */
function contactBlock(draft, college) {
  const wrap = el("div.panel.gutter-top", {},
    el("div.panel-head", {}, el("span.panel-title", { text: "A way to reach you (optional)" })),
  );
  const body = el("div.panel-body.stack-tight", {});
  const detail = el("div");

  const drawDetail = () => {
    if (draft.contact.sharing === "none") return fill(detail);
    fill(detail,
      el("div.filters.gutter-top", {},
        el("label.field", {},
          el("span.label", { text: "How" }),
          el("select.select", { on: { change: (e) => { draft.contact.channel = e.target.value; } } },
            ...[["phone", "Phone"], ["email", "Email"], ["other", "Something else"]].map(([v, t]) =>
              el("option", { value: v, selected: draft.contact.channel === v, text: t })),
          ),
        ),
        el("label.field", {},
          el("span.label", { text: "What" }),
          el("input.input", {
            type: "text", value: draft.contact.value, placeholder: "Only what you want shared",
            on: { input: (e) => { draft.contact.value = e.target.value; } },
          }),
        ),
      ),
    );
  };
  const CHOICES = [
    ["none", "Nothing at all", "The desk replies in the thread here. This is the default and it stays anonymous."],
    ["department", "The desk handling this", `Only ${college.shortName}'s officers on this report can see it.`],
    ["admin_only", "The college admin only", "Not the desk. Use this when the problem involves the desk itself."],
  ];

  for (const [key, heading, note] of CHOICES) {
    body.append(choiceRow({
      name: "contact-sharing", checked: draft.contact.sharing === key, title: heading, note,
      onPick: () => { draft.contact.sharing = key; drawDetail(); },
    }));
  }
  body.append(detail);
  drawDetail();
  wrap.append(body);
  return wrap;
}

/* ---- the receipt ----------------------------------------------------------
   The one and only time the trace code is shown. There is no email to send it to,
   which the screen says in as many words rather than quietly hoping. */

function receiptScreen(res, handle, draft) {
  const r = res.receipt;
  title("Your trace code");
  window.scrollTo({ top: 0 });

  const code = el("div.trace.trace-lg", { text: fmt.code(r.traceCode) });
  paint(shell(el("div.band", {},
    el("div.split", {},
      el("div", {},
        el("p.t-xs.faint", { text: "Filed" }),
        el("h1", { text: "Write this code down now." }),
        el("p.hero-sub", { text: "It is the only way back to your report. Nobody at TrustLine can "
          + "look it up for you, resend it, or tell you what it was — that is the same design that "
          + "keeps the report from being traced back to you." }),

        el("div.receipt.gutter-top-lg", {},
          el("div.row.row-wrap", {}, code,
            el("button.btn.btn-line.btn-sm", {
              type: "button", on: { click: () => copy(r.traceCode, "Trace code copied.") },
            }, icon("copy", "icon-sm"), "Copy"),
          ),
          el("div.facts.gutter-top", {},
            fact("Known as", r.handle),
            fact("Went to", r.department),
            r.category ? fact("Filed under", r.category) : null,
            fact("Priority", r.priority),
            fact("Reply due by", fmt.date(r.dueAt)),
            fact("On the feed", r.visibility === "public" ? "Yes" : "No"),
            fact("Passphrase", draft.passphrase.trim() ? "Set by you" : "None"),
          ),
        ),
        el("div.line.gutter-top-lg", {},
          el("div.line-item.line-now", {},
            el("div.line-node"),
            el("div", {},
              el("div.line-what", { text: "Routed" }),
              el("div.line-note", { text: `${r.explains} Priority was set ${r.priorityReason}.` }),
            ),
          ),
          el("div.line-item", {},
            el("div.line-node"),
            el("div", {},
              el("div.line-what", { text: "The desk reads it" }),
              el("div.line-note", { text: `${r.department} has until ${fmt.date(r.dueAt)} to respond. `
                + "Past that it escalates to the college admin on its own." }),
            ),
          ),
          el("div.line-item", {},
            el("div.line-node"),
            el("div", {},
              el("div.line-what", { text: "You follow it with the code" }),
              el("div.line-note", { text: "Replies, status changes and the desk's questions all appear "
                + "on the tracking page. You can reply there without ever signing in." }),
            ),
          ),
        ),

        el("div.row.row-wrap.gutter-top-lg", {},
          el("a.btn.btn-seal", { href: `#/track/${encodeURIComponent(r.traceCode)}` },
            icon("search", "icon-sm"), "Open my report"),
          el("a.btn.btn-line", { href: `#/c/${handle}` }, "Back to ", "the college"),
        ),
      ),

      el("aside.panel.sticky", {},
        el("div.panel-head", {}, el("span.panel-title", { text: "What we kept" })),
        el("div.panel-body.stack-tight", {},
          el("p.t-sm.quiet", { text: "Your words, the category, the desk, the time — and nothing else. "
            + "No IP address, no browser fingerprint, no account." }),
          (r.privacyFindings ?? []).length
            ? el("div.warn", {},
              el("div.warn-title", {}, icon("alert"), "Read your own words back"),
              el("p.warn-body", { text: `${r.privacyFindings.length} thing${r.privacyFindings.length === 1 ? "" : "s"} `
                + "in your text could identify you. You can edit the report from the tracking page." }))
            : el("div.notice.notice-good", { text: "Nothing identifying was found in your text." }),
          el("p.t-xs.faint", { text: "Filed at " + fmt.date(Date.now()) }),
        ),
      ),
    ),
  )));
  code.focus?.();
}
/* ---- following a report ---------------------------------------------------- */

function viewTraceEntry(_params, query) {
  nav();
  title("Track a report");
  let code = query.get("code") || "";
  let pass = "";

  const go = () => {
    const clean = code.trim().toUpperCase();
    if (clean.length < 4) return toast("Type the trace code from your receipt.", "bad");
    if (pass.trim()) setTracePass(pass.trim());
    Router.go(`/track/${encodeURIComponent(clean)}`);
  };

  paint(shell(el("div.band", {},
    el("div.split", {},
      el("div", {},
        el("p.t-xs.faint", { text: "No account, no email" }),
        el("h1", { text: "Your code is your key." }),
        el("p.hero-sub", { text: "TrustLine has no idea who filed what. The code you wrote down when you "
          + "filed is the whole of your identity here — type it in and you get your report, the desk's "
          + "replies, and a way to answer them." }),

        el("form.gutter-top-lg", { on: { submit: (e) => { e.preventDefault(); go(); } } },
          field({
            label: "Trace code",
            hint: "Case does not matter. It looks like CEP-4F2K9T.",
            input: el("input.input.mono", {
              type: "text", value: code, placeholder: "CEP-000000", autocomplete: "off",
              spellcheck: "false", "aria-label": "Trace code",
              on: { input: (e) => { code = e.target.value; } },
            }),
          }),
          field({
            label: "Passphrase, if you set one",
            hint: "Leave this empty unless you chose a passphrase while filing. It is never stored — "
              + "it lives in this tab and is gone when you close it.",
            input: el("input.input", {
              type: "password", placeholder: "••••••", autocomplete: "off",
              on: { input: (e) => { pass = e.target.value; } },
            }),
          }),
          el("div.gutter-top", {}, el("button.btn.btn-seal", { type: "submit" },
            icon("search", "icon-sm"), "Open my report")),
        ),
      ),
      el("aside.panel.sticky", {},
        el("div.panel-head", {}, el("span.panel-title", { text: "Lost the code?" })),
        el("div.panel-body.stack-tight", {},
          el("p.t-sm.quiet", { text: "Then it is gone, and that is not a bug. A system that can recover "
            + "your code for you is a system that knows which report is yours." }),
          el("p.t-sm.quiet", { text: "Your report is still in the queue and the desk still has to answer it. "
            + "If it was public you can find it on the feed and back it, and you can file again with more detail." }),
          el("a.btn.btn-line.btn-block.gutter-top", { href: "#/" }, "Find your college"),
        ),
      ),
    ),
  )));
}
async function viewTrack({ code }) {
  nav();
  busy("Opening your report");

  let r;
  try {
    r = await api.get(`/api/trace/${encodeURIComponent(code)}`);
  } catch (err) {
    // 403 here means the report exists and is passphrase-locked. Asking for it on
    // this screen keeps it out of the URL that got us here.
    if (err instanceof ApiError && err.status === 403) return lockScreen(code);
    return crash(err, "#/trace");
  }

  title(r.title);
  const redraw = () => viewTrack({ code });

  paint(shell(el("div.band", {},
    el("a.btn.btn-quiet.btn-sm", { href: "#/trace" }, icon("chevron", "icon-sm"), "Another code"),
    el("div.split", {},
      el("div", {},
        el("div.row-wrap", {}, prio(r.priority),
          pill(r.status, { label: r.statusLabel, tone: r.tone }),
          r.isOverdue ? pill("overdue", { label: "Past due", tone: "bad" }) : null,
          r.visibility === "public" ? el("span.chip", {}, icon("eye", "icon-sm"), "On the feed") : null,
        ),
        el("h1", { text: r.title }),
        el("p.hero-sub", { text: r.reporterNote }),

        r.mergedInto
          ? el("div.notice.gutter-top", {},
            el("span.notice-title", { text: "Folded into another report" }),
            `This was merged into “${r.mergedIntoTitle ?? "another report"}”, which the desk is tracking `
            + "instead. Everything said there applies to yours.")
          : null,

        railRow(r),
        el("div.facts.gutter-top-lg", {},
          fact("Trace code", fmt.code(r.traceCode)),
          fact("Known as", r.handle),
          fact("Filed under", r.categoryName),
          r.departmentName ? fact("Desk", r.departmentName) : null,
          fact("Filed", fmt.date(r.createdAt)),
          r.location ? fact("Where", r.location) : null,
          fact("Backing", `${fmt.n(r.supportCount)}`),
          r.reopenCount ? fact("Reopened", `${r.reopenCount}×`) : null,
        ),
        el("div.measure.gutter-top-lg", {}, ...paragraphs(r.body)),
        r.escalationReason ? el("div.warn.gutter-top", {},
          el("div.warn-title", {}, icon("up"), "Escalated"),
          el("p.warn-body", { text: r.escalationReason })) : null,
        threadList(r.thread, { title: "The thread", empty: "Nothing said yet. The desk sees this report in its queue." }),
        replyBox(r, redraw),
      ),
      trackPanel(r, redraw),
    ),
  )));
}
function lockScreen(code) {
  title("Passphrase needed");
  let pass = "";
  paint(shell(el("div.band", {},
    el("div.shell-narrow", {},
      el("h1", { text: "This report has a passphrase." }),
      el("p.hero-sub", { text: "You set one when you filed it, so the code alone is not enough — "
        + "which is the point. Nobody who finds your code on a shared computer gets your report." }),
      el("form.gutter-top-lg", { on: { submit: (e) => {
        e.preventDefault();
        if (!pass.trim()) return toast("Type the passphrase you chose.", "bad");
        setTracePass(pass.trim());
        viewTrack({ code });
      } } },
        field({
          label: `Passphrase for ${fmt.code(code)}`,
          hint: "Held in this tab only. Never written to disk, never sent in a URL.",
          input: el("input.input", {
            type: "password", autofocus: true, autocomplete: "off",
            on: { input: (e) => { pass = e.target.value; } },
          }),
        }),
        el("div.gutter-top", {}, el("button.btn.btn-seal", { type: "submit" }, icon("lock", "icon-sm"), "Unlock")),
      ),
      el("p.t-sm.quiet.gutter-top-lg", { text: "Forgotten it? Then this report can only be reached by the desk "
        + "holding it. It is still in their queue and still has a response deadline." }),
    ),
  )));
}

/** The four-stop rail the server names in StateRegistry.rail(). */
function railRow(r) {
  const stops = r.rail ?? [];
  return el("div.steps.gutter-top-lg", {}, ...stops.map((name, i) => el("div.step", {
    "data-state": i < r.railStep ? "done" : i === r.railStep ? "now" : "",
    "aria-current": i === r.railStep ? "step" : null,
  },
    el("span.step-n", { text: String(i + 1) }),
    el("span.step-name", { text: name }),
  )));
}
/* A reply is scanned the same way the report was, and the findings come back *with*
   the posted message rather than instead of it — see traceRoutes. */
function replyBox(r, redraw) {
  if (!r.isOpen) {
    return el("div.notice.gutter-top-lg", { text: "This report is closed, so the thread is closed with it. "
      + "Reopen it below if the problem came back." });
  }
  let text = "";
  const button = el("button.btn.btn-seal", { type: "submit" }, icon("send", "icon-sm"), "Send to the desk");
  const box = el("form.gutter-top-lg", { on: { submit: async (e) => {
    e.preventDefault();
    if (text.trim().length < 2) return toast("Write something first.", "bad");
    button.disabled = true;
    try {
      const res = await api.post(`/api/trace/${encodeURIComponent(r.traceCode)}/replies`, { body: text.trim() });
      const found = res?.privacyFindings ?? [];
      if (found.length) {
        toast(`Sent — but it contains ${found[0].label.toLowerCase()}. The desk can see it now.`, "bad");
      } else toast("Sent. The desk sees it in the thread.", "good");
      redraw();
    } catch (err) { failed(err); button.disabled = false; }
  } } },
    field({
      label: r.status === "awaiting_reporter" ? "The desk asked you something" : "Add to the thread",
      hint: "The desk sees your words and your handle. It never sees who you are.",
      input: el("textarea.textarea", {
        rows: "4", placeholder: "What else should they know?",
        on: { input: (e) => { text = e.target.value; } },
      }),
    }),
    el("div.gutter-top", {}, button),
  );
  return box;
}

function trackPanel(r, redraw) {
  const acts = el("div.panel-body.stack-tight", {});
  const panel = el("aside.panel.sticky", {},
    el("div.panel-head", {}, el("span.panel-title", { text: "Your report" })),
    acts,
  );

  acts.append(
    el("div.trace.trace-lg", { text: fmt.code(r.traceCode) }),
    el("button.btn.btn-line.btn-block.btn-sm", {
      type: "button", on: { click: () => copy(r.traceCode, "Trace code copied.") },
    }, icon("copy", "icon-sm"), "Copy the code"),
  );

  if (r.isOpen) {
    acts.append(el("div.gutter-top", {}, clock({
      remainingMs: r.remainingMs,
      // The server sends the deadline and the filing time, not the span between
      // them, so the bar's denominator is derived here.
      windowMs: r.dueAt ? r.dueAt - r.createdAt : 0,
      overdue: r.isOverdue,
      paused: r.status === "awaiting_reporter",
      dueAt: r.dueAt,
    })));
  }
  acts.append(...trackActions(r, redraw));
  return panel;
}
/* Everything the person who filed can do without an account. Each one is a route
   under /api/trace/:code, authorised by the code plus passphrase and nothing else. */
function trackActions(r, redraw) {
  const out = [];
  const call = async (fn, said) => {
    try { await fn(); toast(said, "good"); redraw(); } catch (err) { failed(err); }
  };

  if (r.isOpen) {
    out.push(el("div.gutter-top", {}, switchRow({
      checked: r.visibility === "public",
      label: r.visibility === "public" ? "On the public feed" : "Private to the desk",
      note: "You decide this, not the college. Turn it on and others facing the same "
        + "thing can back it; turn it off and it disappears from the feed at once.",
      onChange: (on) => call(
        () => api.patch(`/api/trace/${encodeURIComponent(r.traceCode)}/visibility`, { public: on }),
        on ? "It is on the feed now." : "Taken off the feed.",
      ),
    })));
  }

  out.push(el("div.gutter-top", {},
    el("button.btn.btn-line.btn-block.btn-sm", { type: "button", on: { click: () => reviseSheet(r, redraw) } },
      icon("note", "icon-sm"), "Edit what I wrote"),
  ));

  out.push(el("div.gutter-top", {},
    el("button.btn.btn-line.btn-block.btn-sm", { type: "button", on: { click: () => contactSheet(r, redraw) } },
      icon("mail", "icon-sm"), r.contactSharing === "none" ? "Share a way to reach me" : "Change or withdraw contact"),
  ));

  if (r.status === "resolved" || r.status === "closed") {
    out.push(el("div.gutter-top", {},
      el("button.btn.btn-block.btn-sm", { type: "button", on: { click: () => rateSheet(r, redraw) } },
        icon("check", "icon-sm"), r.satisfaction ? `Rated ${r.satisfaction}/5 — change it` : "Rate how this was handled"),
    ));
  }

  if (r.allowedNext?.includes("in_progress") && !r.isOpen) {
    out.push(el("div.gutter-top", {},
      el("button.btn.btn-line.btn-block.btn-sm", { type: "button", on: { click: async () => {
        const why = await confirmAction({
          title: "Reopen this report", confirmLabel: "Reopen",
          note: "Use this if the problem came back or was never really fixed. The desk gets a fresh clock.",
          needs: { label: "What is still wrong?", placeholder: "The tap was fixed and started leaking again" },
        });
        if (why === null) return;
        call(() => api.post(`/api/trace/${encodeURIComponent(r.traceCode)}/reopen`, { reason: why }), "Reopened.");
      } } }, icon("refresh", "icon-sm"), "Reopen it"),
    ));
  }
  out.push(...withdrawAction(r, call));
  return out;
}
function withdrawAction(r, call) {
  if (!r.isOpen) return [];
  return [el("div.gutter-top", {},
    el("button.btn.btn-quiet.btn-block.btn-sm", { type: "button", on: { click: async () => {
      const why = await confirmAction({
        title: "Withdraw this report", danger: true, confirmLabel: "Withdraw it",
        note: "It leaves every queue and comes off the feed. The desk keeps the record that it existed, "
          + "because a college should not be able to make a complaint disappear — but nobody will work on it.",
        needs: { label: "Why, for the record (optional)", placeholder: "Sorted out directly" },
      });
      if (why === null) return;
      call(() => api.post(`/api/trace/${encodeURIComponent(r.traceCode)}/withdraw`, { reason: why }), "Withdrawn.");
    } } }, icon("x", "icon-sm"), "Withdraw it"),
  )];
}

function reviseSheet(r, redraw) {
  const next = { title: r.title, body: r.body, location: r.location || "" };
  drawer({
    title: "Edit your report",
    head: [el("span.panel-title", { text: "Edit your report" }),
      el("span.trace.trace-sm", { text: fmt.code(r.traceCode) })],
    body: [
      el("p.t-sm.quiet", { text: "The desk sees that it was edited and when. Editing does not reset the "
        + "response clock." }),
      field({ label: "Title", input: el("input.input", {
        type: "text", value: next.title, on: { input: (e) => { next.title = e.target.value; } } }) }),
      field({ label: "What happened", input: el("textarea.textarea", {
        rows: "7", on: { input: (e) => { next.body = e.target.value; } } }, next.body) }),
      field({ label: "Where", hint: "A place, not a person.", input: el("input.input", {
        type: "text", value: next.location, on: { input: (e) => { next.location = e.target.value; } } }) }),
      el("div.gutter-top", {}, el("button.btn.btn-seal", { type: "button", on: { click: async () => {
        try {
          await api.patch(`/api/trace/${encodeURIComponent(r.traceCode)}`, next);
          closeOverlay(); toast("Saved. The desk sees the new version.", "good"); redraw();
        } catch (err) { failed(err); }
      } } }, icon("check", "icon-sm"), "Save changes")),
    ],
  });
}

function rateSheet(r, redraw) {
  let score = r.satisfaction || 0;
  let note = r.feedback || "";
  const marks = el("div.row.row-wrap");
  const draw = () => fill(marks, ...[1, 2, 3, 4, 5].map((n) => el(
    `button.btn.btn-sm.${n === score ? "btn-seal" : "btn-line"}`,
    { type: "button", "aria-pressed": String(n === score), on: { click: () => { score = n; draw(); } } },
    String(n),
  )));
  draw();
  drawer({
    title: "Rate how this was handled",
    head: [el("span.panel-title", { text: "How was this handled?" })],
    body: [
      el("p.t-sm.quiet", { text: "This is the number that ends up on the college's public transparency "
        + "page. It is the one piece of leverage a reporter has after the fact." }),
      el("div.gutter-top", {}, el("span.label", { text: "1 is badly, 5 is well" }), marks),
      field({ label: "Anything to add", input: el("textarea.textarea", {
        rows: "4", placeholder: "What they did or did not do",
        on: { input: (e) => { note = e.target.value; } } }, note) }),
      el("div.gutter-top", {}, el("button.btn.btn-seal", { type: "button", on: { click: async () => {
        if (!score) return toast("Pick a number from 1 to 5.", "bad");
        try {
          await api.post(`/api/trace/${encodeURIComponent(r.traceCode)}/rating`, { score, note });
          closeOverlay(); toast("Rated. It counts towards the public figures.", "good"); redraw();
        } catch (err) { failed(err); }
      } } }, icon("check", "icon-sm"), "Submit rating")),
    ],
  });
}

function contactSheet(r, redraw) {
  const now = { sharing: r.contactSharing || "none", channel: "phone", value: "" };
  const detail = el("div");
  const drawDetail = () => {
    if (now.sharing === "none") return fill(detail, el("p.t-sm.quiet", {
      text: "Saving this withdraws any contact detail you shared before." }));
    fill(detail, el("div.filters.gutter-top", {},
      el("label.field", {}, el("span.label", { text: "How" }),
        el("select.select", { on: { change: (e) => { now.channel = e.target.value; } } },
          ...[["phone", "Phone"], ["email", "Email"], ["other", "Something else"]].map(([v, t]) =>
            el("option", { value: v, selected: now.channel === v, text: t })))),
      el("label.field", {}, el("span.label", { text: "What" }),
        el("input.input", { type: "text", placeholder: "Only what you want shared",
          on: { input: (e) => { now.value = e.target.value; } } })),
    ));
  };
  drawDetail();

  drawer({
    title: "A way to reach you",
    head: [el("span.panel-title", { text: "A way to reach you" })],
    body: [
      el("p.t-sm.quiet", { text: "Everything here is optional and reversible. The desk can already reply "
        + "in the thread — this is only for when someone has to phone you to get into a room." }),
      ...["none", "department", "admin_only"].map((key) => choiceRow({
        name: "contact-now", checked: now.sharing === key,
        title: { none: "Share nothing", department: "The desk handling this", admin_only: "The college admin only" }[key],
        note: { none: "Withdraw anything shared before.",
          department: "Officers on this report only.",
          admin_only: "Use this when the problem involves the desk itself." }[key],
        onPick: () => { now.sharing = key; drawDetail(); },
      })),
      detail,
      el("div.gutter-top", {}, el("button.btn.btn-seal", { type: "button", on: { click: async () => {
        try {
          await api.post(`/api/trace/${encodeURIComponent(r.traceCode)}/contact`, now);
          closeOverlay(); toast(now.sharing === "none" ? "Contact withdrawn." : "Saved.", "good"); redraw();
        } catch (err) { failed(err); }
      } } }, icon("check", "icon-sm"), "Save")),
    ],
  });
}
/* ---- the transparency page -------------------------------------------------
   Public, and unflattering where the numbers are unflattering. A college that
   publishes its median response time has a reason to shorten it. */

async function viewTransparency({ handle }, query) {
  nav(handle);
  busy("Reading the record");
  const days = Number(query.get("days")) || 90;

  let t;
  try { t = await api.get(`/api/colleges/${encodeURIComponent(handle)}/transparency?days=${days}`); }
  catch (err) { return crash(err); }

  const { college, totals, departments, categories, resolution } = t;
  title(`The record — ${college.shortName}`);

  paint(shell(el("div.band", {},
    el("div.row-between.row-wrap", {},
      el("div", {},
        el("p.t-xs.faint", { text: college.shortName }),
        el("h1", { text: "The record, published as it is." }),
        el("p.t-sm.quiet.measure", { text: "Every number here is generated from the reports themselves, "
          + "nobody edits it, and confidential categories are left out entirely. Last "
          + `${days} days for the daily figures; everything else is all time.` }),
      ),
      el("select.select", { "aria-label": "Window",
        on: { change: (e) => { Router.go(`/c/${handle}/record?days=${e.target.value}`); viewTransparency({ handle }, Router.query()); } } },
        ...[[30, "Last 30 days"], [90, "Last 90 days"], [180, "Last 6 months"], [365, "Last year"]]
          .map(([v, t2]) => el("option", { value: String(v), selected: v === days, text: t2 })),
      ),
    ),

    el("div.grid.grid-4.gutter-top-lg", {},
      count(totals.filed, "reports filed in total", { tone: "seal", cap: 10 }),
      count(totals.resolved, `dealt with — ${totals.resolvedRate ?? 0}% of everything filed`, { cap: 10 }),
      count(totals.open, "still open right now", { tone: totals.open > totals.resolved ? "seal" : "", cap: 10 }),
      count(totals.backed, "times someone said “this happens to me too”", { tone: "indigo", cap: 10 }),
    ),

    el("div.grid.grid-3.gutter-top-lg", {},
      figureBox("Median time to fix", totals.medianHours === null ? "No data yet" : fmt.dur(totals.medianHours * 3600000),
        "Half of all resolved reports were closed faster than this. Half were slower."),
      figureBox("Reporters' own rating", totals.satisfaction === null ? "Not rated yet" : `${totals.satisfaction} of 5`,
        "Given by the person who filed, after the desk called it done."),
      figureBox("Filed in the open", `${totals.publicShare}%`,
        "The share of reporters who chose to publish rather than keep it private."),
    ),
    resolutionBands(resolution),
    deskTable(departments),
    categoryTable(categories),
  )));
}
function figureBox(k, v, note) {
  return el("div.panel", {}, el("div.panel-body", {},
    el("div.reading-k", { text: k }),
    el("div.t-lg.mono.gutter-top", { text: v }),
    el("p.t-sm.quiet", { text: note }),
  ));
}

/** A distribution drawn with the response-clock bar, so it reads as time, not decoration. */
function resolutionBands(res) {
  if (!res || res.count === 0) return null;
  const most = Math.max(1, ...res.bands.map((b) => b.count));
  return el("div.panel.gutter-top-lg", {},
    el("div.panel-head", {},
      el("span.panel-title", { text: "How long a fix actually takes" }),
      el("span.t-xs.faint", { text: `${fmt.n(res.count)} resolved · fastest ${res.fastest}h · slowest ${res.slowest}h` }),
    ),
    el("div.panel-body.stack-tight", {}, ...res.bands.map((b) => el("div", {},
      el("div.clock-text", {}, el("span", { text: b.label }), el("span.faint", { text: fmt.n(b.count) })),
      el("div.clock-bar", {}, el("div.clock-fill", { style: { width: `${(b.count / most) * 100}%` } })),
    ))),
  );
}

function deskTable(rows) {
  if (!rows.length) return null;
  return el("div.panel.gutter-top-lg", {},
    el("div.panel-head", {}, el("span.panel-title", { text: "By desk" }),
      el("span.t-xs.faint", { text: "Desks, never the officers on them" })),
    el("div.panel-body-tight", {},
      el("table.sheet", {},
        el("thead", {}, el("tr", {},
          el("th", { text: "Desk" }), el("th.sheet-num", { text: "Received" }),
          el("th.sheet-num", { text: "Dealt with" }), el("th.sheet-num", { text: "Median" }))),
        el("tbody", {}, ...rows.map((d) => el("tr", {},
          el("td", { text: d.name }),
          el("td.sheet-num", { text: fmt.n(d.filed) }),
          el("td.sheet-num", { text: `${fmt.n(d.resolved)} · ${Math.round((d.resolved / d.filed) * 100)}%` }),
          el("td.sheet-num", { text: d.medianHours === null ? "—" : fmt.dur(d.medianHours * 3600000) }),
        ))),
      ),
    ),
  );
}
function categoryTable(rows) {
  if (!rows.length) return null;
  return el("div.panel.gutter-top-lg", {},
    el("div.panel-head", {}, el("span.panel-title", { text: "What people report" })),
    el("div.panel-body-tight", {},
      el("table.sheet", {},
        el("thead", {}, el("tr", {},
          el("th", { text: "Category" }), el("th.sheet-num", { text: "Filed" }),
          el("th.sheet-num", { text: "Open" }), el("th.sheet-num", { text: "Backing" }),
          el("th.sheet-num", { text: "Median" }))),
        el("tbody", {}, ...rows.map((c) => el("tr", {},
          el("td", {}, el("span.row", {}, icon(c.glyph || "file", "icon-sm"), c.name)),
          el("td.sheet-num", { text: fmt.n(c.total) }),
          el("td.sheet-num", { text: fmt.n(c.open) }),
          el("td.sheet-num", { text: fmt.n(c.backed) }),
          el("td.sheet-num", { text: c.medianHours === null ? "—" : fmt.dur(c.medianHours * 3600000) }),
        ))),
      ),
    ),
  );
}

/* ---- registering a college ------------------------------------------------- */

async function viewJoin() {
  nav();
  title("Register your college");
  const form = {
    name: "", shortName: "", city: "", state: "Kerala", university: "",
    adminName: "", adminTitle: "", adminEmail: "", password: "", confirm: "",
  };
  const problems = el("div");
  const button = el("button.btn.btn-seal.btn-lg", { type: "submit" }, icon("shield", "icon-sm"), "Send for approval");

  const submit = async (e) => {
    e.preventDefault();
    const bad = joinProblem(form);
    if (bad) { fill(problems, el("div.notice.notice-bad", { text: bad })); return; }
    fill(problems);
    button.disabled = true;
    try {
      const res = await api.post("/api/auth/register/college", {
        name: form.name.trim(), shortName: form.shortName.trim(), city: form.city.trim(),
        state: form.state.trim(), university: form.university.trim(),
        adminName: form.adminName.trim(), adminTitle: form.adminTitle.trim(),
        adminEmail: form.adminEmail.trim(), password: form.password,
      });
      joinDone(res);
    } catch (err) { failed(err); button.disabled = false; }
  };
  const text = (key, label, hint, opts = {}) => field({
    label, hint,
    input: el("input.input", { type: opts.type || "text", value: form[key],
      placeholder: opts.placeholder || "", autocomplete: opts.autocomplete || "off",
      on: { input: (e) => { form[key] = e.target.value; } } }),
  });

  paint(shell(el("div.band", {},
    el("div.split", {},
      el("form", { on: { submit } },
        el("p.t-xs.faint", { text: "For colleges" }),
        el("h1", { text: "Put your college on the register." }),
        el("p.hero-sub", { text: "Registration is free and takes two minutes. The platform office checks "
          + "that you are who you say you are before your password works — which is what stops anyone "
          + "from registering a college they do not run and reading its complaints." }),

        el("div.panel.gutter-top-lg", {},
          el("div.panel-head", {}, el("span.panel-title", { text: "The college" })),
          el("div.panel-body", {},
            text("name", "Full name", "As it appears on official letterhead.",
              { placeholder: "College of Engineering Perumon" }),
            el("div.filters.gutter-top", {},
              text("shortName", "Short name", null, { placeholder: "CEP" }),
              text("city", "Town or city", null, { placeholder: "Kollam" }),
              text("state", "State", null, { placeholder: "Kerala" }),
            ),
            text("university", "Affiliated to", "Left blank if it is autonomous.",
              { placeholder: "APJ Abdul Kalam Technological University" }),
          ),
        ),

        el("div.panel.gutter-top", {},
          el("div.panel-head", {}, el("span.panel-title", { text: "The first admin — you" })),
          el("div.panel-body", {},
            el("p.t-sm.quiet", { text: "This account routes complaints, creates desks and adds the rest of "
              + "your team. It can never read a report's contact details it was not given." }),
            el("div.gutter-top", {}),
            text("adminName", "Your name", null, { placeholder: "Your name" }),
            text("adminTitle", "Your role", null, { placeholder: "Principal" }),
            text("adminEmail", "Official email", "Use the college domain if you have one — the platform "
              + "office uses it to verify you.", { type: "email", placeholder: "principal@cep.ac.in" }),
            text("password", "Password", "At least ten characters.", { type: "password" }),
            text("confirm", "Password again", null, { type: "password" }),
          ),
        ),
        problems,
        el("div.gutter-top-lg", {}, button),
      ),
      joinAside(),
    ),
  )));
}
function joinProblem(f) {
  if (f.name.trim().length < 4) return "Give the college's full name.";
  if (f.adminName.trim().length < 2) return "Add your name.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.adminEmail.trim())) return "That email address does not look right.";
  if (f.password.length < 10) return "Use a password of at least ten characters.";
  if (f.password !== f.confirm) return "The two passwords do not match.";
  return null;
}

function joinDone(res) {
  title("Registration sent");
  window.scrollTo({ top: 0 });
  paint(shell(el("div.band", {}, el("div.shell-narrow", {},
    el("div.receipt", {},
      el("p.t-xs.faint", { text: "Sent" }),
      el("h1", { text: `${res.college.shortName || res.college.name} is with the platform office.` }),
      el("p.hero-sub", { text: res.next }),
      el("div.facts.gutter-top-lg", {},
        fact("College", res.college.name),
        fact("Status", "Awaiting approval"),
        fact("Admin", res.admin.email),
      ),
    ),
    el("div.line.gutter-top-lg", {},
      el("div.line-item.line-now", {}, el("div.line-node"), el("div", {},
        el("div.line-what", { text: "The platform office checks you are real" }),
        el("div.line-note", { text: "Usually the same day. Until then your password does not work — "
          + "AuthService refuses the sign-in, not the screen." }))),
      el("div.line-item", {}, el("div.line-node"), el("div", {},
        el("div.line-what", { text: "You set up desks and categories" }),
        el("div.line-note", { text: "A desk is where reports land. A category is what a reporter picks. "
          + "You decide which goes where, and TrustLine routes by keyword when nobody picks." }))),
      el("div.line-item", {}, el("div.line-node"), el("div", {},
        el("div.line-what", { text: "You share one link" }),
        el("div.line-note", { text: "That is the whole rollout. No app to install, no account for reporters." }))),
    ),
    el("div.row.row-wrap.gutter-top-lg", {},
      el("a.btn", { href: "/ops" }, icon("out", "icon-sm"), "Staff sign-in"),
      el("a.btn.btn-line", { href: "#/" }, "Back to the register"),
    ),
  ))));
}

function joinAside() {
  const rows = [
    ["Nothing to install", "TrustLine is one link. Reporters never make an account, so there is nothing to roll out and nobody to train."],
    ["You own the routing", "Categories, desks, keywords and priority rules are yours to change. A report that matches nothing still lands somewhere."],
    ["The numbers are public", "Your response times are published. That is the deal — it is also the reason people trust the box enough to use it."],
    ["You cannot read a reporter", "Not a design promise, a design fact: there is no identity stored to read. Even the platform office's own account returns false when asked."],
  ];
  return el("aside.panel.sticky", {},
    el("div.panel-head", {}, el("span.panel-title", { text: "What you are signing up to" })),
    el("div.panel-body", {}, el("div.reading", {}, ...rows.map(([k, v]) => el("div.reading-item", {},
      el("div.reading-k", { text: k }), el("div.reading-v", { text: v }))))),
  );
}
/* ---- what we store --------------------------------------------------------
   Written as a list of decisions with the reason attached, because a privacy page
   that only makes promises is worth nothing. Each row names the mechanism. */

function viewPrivacy() {
  nav();
  title("What we store");

  const kept = [
    ["Your words", "The title, description and location you typed, exactly as typed. If you named yourself in them, that name is stored — which is why the form warns you while you write."],
    ["A generated handle", "Something like “Quiet Kingfisher”. It is generated per report from nothing about you, so two reports by the same person share no thread."],
    ["A role, not a person", "“A student”, “A staff member”, “A parent”. Chosen by you from a list, and that is the entire demographic record."],
    ["Times", "When you filed, when the desk acted, when it closed. This is what the public response times are computed from."],
    ["A passphrase hash", "Only if you set one, and only as a scrypt hash — the passphrase itself is never written down anywhere."],
  ];
  const never = [
    ["Your IP address", "It is never written to the store or to a log line. The rate limiter needs to tell callers apart, so it hashes the address with a salt that is generated at boot, kept in memory, and rotated — after rotation the old hashes match nothing."],
    ["A browser fingerprint", "No analytics, no third-party scripts, no cookies for reporters. The content security policy allows scripts from this site only, so nothing else could load even if it were added."],
    ["An account", "There is nothing to sign in to as a reporter, so there is no login history, no password reset trail and no email address."],
    ["Your trace code in a URL", "Every page after the first lives after a “#”, which browsers never send to a server. The site also sends Referrer-Policy: no-referrer, so a click out of TrustLine carries nothing."],
    ["Uploads", "There is no file store. A photo of a hostel room with a face in it is exactly what an anonymous system should not hold, so evidence is described and the desk asks you for it in the thread."],
  ];

  paint(shell(el("div.band", {},
    el("div.shell-narrow", {},
      el("p.t-xs.faint", { text: "Privacy, mechanism by mechanism" }),
      el("h1", { text: "What TrustLine stores, and what it cannot." }),
      el("p.hero-sub", { text: "Anonymity here is not a setting that somebody could switch off. "
        + "It is an absence: the fields that would identify you are not in the database, so no admin, "
        + "no college and no court order can produce them." }),

      panelList("Kept", kept, "seal"),
      panelList("Never collected", never, ""),

      el("div.panel.gutter-top-lg", {},
        el("div.panel-head", {}, el("span.panel-title", { text: "What a college can see" })),
        el("div.panel-body", {}, el("div.reading", {},
          el("div.reading-item", {}, el("div.reading-k", { text: "A desk officer" }),
            el("div.reading-v", { text: "The reports routed to their desk, the thread, and contact details "
              + "only if you shared them with that desk." })),
          el("div.reading-item", {}, el("div.reading-k", { text: "A college admin" }),
            el("div.reading-v", { text: "Every report in their college, including confidential categories, "
              + "and the internal notes officers leave. Not your identity, because it is not stored." })),
          el("div.reading-item", {}, el("div.reading-k", { text: "The platform office" }),
            el("div.reading-v", { text: "Colleges, accounts and counts — never a report's contents. The "
              + "permission check for reading a report is hard-coded to false on that role." })),
        )),
      ),
      el("div.row.row-wrap.gutter-top-lg", {},
        el("a.btn", { href: "#/" }, "Find your college"),
        el("a.btn.btn-line", { href: "#/trace" }, "Track a report"),
      ),
    ),
  )));
}
function panelList(heading, rows, tone) {
  return el(`div.panel.gutter-top-lg${tone === "seal" ? ".panel-seal" : ""}`, {},
    el("div.panel-head", {}, el("span.panel-title", { text: heading }),
      el("span.t-xs.faint", { text: `${rows.length} things` })),
    el("div.panel-body", {}, el("div.reading", {}, ...rows.map(([k, v]) => el("div.reading-item", {},
      el("div.reading-k", { text: k }), el("div.reading-v", { text: v }))))),
  );
}

/* ---- routes ---------------------------------------------------------------
   Hash routes only. A trace code is a credential, so /track/:code must never be a
   path the browser would put in a request line or send in a Referer header. */

router
  .add("/", viewHome)
  .add("/trace", viewTraceEntry)
  .add("/track/:code", viewTrack)
  .add("/join", viewJoin)
  .add("/privacy", viewPrivacy)
  .add("/c/:handle", viewCollege)
  .add("/c/:handle/report", viewReport)
  .add("/c/:handle/feed", viewFeed)
  .add("/c/:handle/entry/:code", viewEntry)
  .add("/c/:handle/record", viewTransparency)
  .fallback((path) => {
    nav();
    title("Nothing here");
    paint(shell(el("div.band", {}, blank("Nothing at that address",
      `TrustLine has no page at “${path}”. It may be a link from somewhere that has moved.`,
      el("a.btn", { href: "#/" }, "Start again")))));
  });

// The old prototype served /r/:slug as a real path, and college addresses shared
// from the console use /c/<slug>. The catch-all shell serves index.html for both,
// so anyone landing on one via a bookmark or a pasted link is sent to the hash
// route that actually renders it — once, rather than to a blank page.
if (!location.hash && (location.pathname.startsWith("/r/") || location.pathname.startsWith("/c/"))) {
  Router.go(`/c/${location.pathname.slice(3).replace(/\/+$/, "")}`, { replace: true });
}

router.start();
