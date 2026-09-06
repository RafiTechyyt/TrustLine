/* ui.js — the shared kit both surfaces are built from.
 *
 * No framework, no build step, no bundle: an ES module the browser loads directly.
 * That is a constraint of the project (this has to run from a checkout on any
 * machine with node), but it also keeps the whole client small enough to read.
 *
 * Four things live here: talking to the API, building DOM without innerHTML,
 * drawing the tally marks the design is built around, and the handful of shared
 * behaviours (toasts, drawers, hash routing) that both the public site and the
 * staff console need.
 */

/* ---- errors --------------------------------------------------------------- */

/** Mirrors the server's AppError body: { error, code, details }. */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code || "unknown";
    this.details = body?.details ?? null;
  }
}

/* ---- the API client ------------------------------------------------------- */

/**
 * A trace code is a credential — anyone holding it can open the report it belongs
 * to. So the passphrase that protects one never goes in a URL or a query string
 * where it would land in browser history and server logs; it rides in a header,
 * held in memory only, and it is dropped the moment the tab closes.
 */
let tracePass = null;
export function setTracePass(value) { tracePass = value || null; }
export function getTracePass() { return tracePass; }

async function request(method, path, body, extraHeaders) {
  const headers = { accept: "application/json", ...extraHeaders };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (tracePass) headers["x-trace-pass"] = tracePass;

  const res = await fetch(path, {
    method,
    headers,
    // Sessions are httpOnly cookies; nothing here reads them, it just sends them.
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return null;

  const text = await res.text();
  let payload = null;
  if (text) { try { payload = JSON.parse(text); } catch { payload = { error: text }; } }

  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

export const api = {
  get: (path, headers) => request("GET", path, undefined, headers),
  post: (path, body, headers) => request("POST", path, body ?? {}, headers),
  patch: (path, body, headers) => request("PATCH", path, body ?? {}, headers),
  del: (path, headers) => request("DELETE", path, undefined, headers),
};

/* ---- DOM ------------------------------------------------------------------ */

/**
 * el("div.entry", { text: "…" }, child, child) — a tag string with optional
 * .classes and an optional #id, then a props object, then children.
 *
 * Text always goes in through `text`, which becomes a text node. There is no
 * `html` option anywhere in this file on purpose: every string on this site is
 * either a complaint somebody typed or a name an admin typed, and none of it is
 * ever parsed as markup.
 */
export function el(spec, props = {}, ...kids) {
  const { tag, id, classes } = parseSpec(spec);
  const node = document.createElement(tag);
  if (classes) node.className = classes;
  if (id) node.setAttribute("id", id);
  apply(node, props);
  add(node, kids);
  return node;
}

/**
 * Splits "main.page#page" into its three parts.
 *
 * The `#id` half of this used to be missing: the spec was split on "." alone, so
 * an id in the string became part of the class name and the element never got the
 * id at all. Every console screen paints into `#page`, so the whole staff console
 * rendered its frame and then nothing — and because the markup was otherwise
 * valid, no test that spoke HTTP could see it. The syntax is supported here now
 * rather than removed from ten call sites, because the call sites were the clearer
 * of the two.
 */
function parseSpec(spec) {
  const s = String(spec);
  return {
    tag: s.match(/^[^.#]*/)[0] || "div",
    id: s.match(/#([^.#]+)/)?.[1] ?? null,
    classes: [...s.matchAll(/\.([^.#]+)/g)].map((m) => m[1]).join(" "),
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Same idea, for SVG, where createElement would silently produce the wrong node. */
export function svgEl(spec, props = {}, ...kids) {
  const { tag, id, classes } = parseSpec(spec);
  const node = document.createElementNS(SVG_NS, tag === "" ? "svg" : tag);
  if (classes) node.setAttribute("class", classes);
  if (id) node.setAttribute("id", id);
  apply(node, props, true);
  add(node, kids);
  return node;
}

function apply(node, props, isSvg = false) {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "text") { node.appendChild(document.createTextNode(String(value))); continue; }
    if (key === "class" || key === "className") {
      const merged = [node.getAttribute("class"), value].filter(Boolean).join(" ");
      isSvg ? node.setAttribute("class", merged) : (node.className = merged);
      continue;
    }
    if (key === "on") { for (const [ev, fn] of Object.entries(value)) node.addEventListener(ev, fn); continue; }
    if (key === "data") { for (const [k, v] of Object.entries(value)) if (v !== null && v !== undefined) node.dataset[k] = v; continue; }
    if (key === "style" && typeof value === "object") { Object.assign(node.style, value); continue; }
    if (!isSvg && (key === "value" || key === "checked" || key === "disabled" || key === "selected")) { node[key] = value; continue; }
    node.setAttribute(key, value === true ? "" : String(value));
  }
}

function add(node, kids) {
  for (const kid of kids.flat(4)) {
    if (kid === null || kid === undefined || kid === false || kid === "") continue;
    node.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

/** Empty a node and fill it in one go, so a re-render never double-paints. */
export function fill(node, ...kids) {
  node.replaceChildren();
  add(node, kids);
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---- the tally ------------------------------------------------------------ */

const MARK_W = 21;
const MARK_H = 24;

/**
 * Draws a number as tally marks: four uprights and a stroke across for the fifth,
 * grouped in fives, the way a count is kept by hand.
 *
 * This is the one piece of ornament in the design and it is load-bearing. A page
 * that says "128 reports resolved" asks you to trust a number. A page that draws
 * 128 marks shows you a quantity, and every mark is one person who decided to say
 * something. Past `cap` groups it stops drawing and appends the remainder, because
 * the honest impression is "more marks than you can count", not a wall of them.
 */
export function tally(n, { cap = 12, tone = "" } = {}) {
  const total = Math.max(0, Math.floor(Number(n) || 0));
  const wrap = el("span.tally" + (tone ? `.tally-${tone}` : ""), {
    role: "img",
    "aria-label": `${total} ${total === 1 ? "mark" : "marks"}`,
  });

  const groups = Math.floor(total / 5);
  const rest = total % 5;
  const shown = Math.min(groups, cap);

  for (let i = 0; i < shown; i += 1) wrap.appendChild(markGroup(5));
  if (groups <= cap && rest) wrap.appendChild(markGroup(rest));
  if (groups > cap) wrap.appendChild(el("span.tally-rest", { text: `+${total - shown * 5}` }));
  if (total === 0) wrap.appendChild(el("span.tally-rest", { text: "0" }));

  return wrap;
}

function markGroup(count) {
  const node = svgEl("svg", { viewBox: `0 0 ${MARK_W} ${MARK_H}`, "aria-hidden": "true", focusable: "false" });
  const uprights = Math.min(count, 4);
  for (let i = 0; i < uprights; i += 1) {
    const x = 2.5 + i * 4.6;
    node.appendChild(svgEl("line", { x1: x, y1: 3, x2: x, y2: MARK_H - 3 }));
  }
  // The fifth is struck across the four, low-left to high-right.
  if (count === 5) node.appendChild(svgEl("line", { x1: 0.5, y1: MARK_H - 4, x2: 19.5, y2: 4 }));
  return node;
}

/** A figure with its marks and its label — the unit both surfaces count in. */
export function count(n, label, { tone = "", cap = 10, marks = true } = {}) {
  return el("span.count", {},
    el("span.count-n", { text: fmt.n(n) }),
    marks ? el("span.count-marks", {}, tally(n, { cap, tone })) : null,
    label ? el("span.count-label", { text: label }) : null,
  );
}

/* ---- icons ---------------------------------------------------------------- */

/**
 * Line icons, drawn on a 24-unit grid, stroked in currentColor. Emoji would have
 * been free but they render as a different typeface on every OS and they carry a
 * tone this subject cannot afford — a small yellow face next to "harassment" is
 * the wrong register. These inherit the ink instead.
 */
const ICONS = {
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4",
  send: "M4 4l16 8-16 8 3-8z",
  note: "M5 4h14v11l-4 5H5zM15 20v-5h4",
  lock: "M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3",
  eye: "M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  eyeOff: "M3 3l18 18M10.6 6.2A8.9 8.9 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-2.4 3M6.3 8.3C3.8 9.9 2 12 2 12s3.6 6 10 6c1.4 0 2.6-.3 3.7-.7M9.9 9.9a3 3 0 0 0 4.2 4.2",
  clock: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4.5l3 2",
  check: "M4 12.5l5 5L20 6.5",
  alert: "M12 4l9 16H3zM12 10v4M12 17h.01",
  flag: "M6 3v18M6 4h11l-2 4 2 4H6",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6L6 18",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4.5 4.5",
  filter: "M3 5h18l-7 8v6l-4-2v-4z",
  arrow: "M4 12h15M13 6l6 6-6 6",
  chevron: "M8 5l7 7-7 7",
  chevronDown: "M5 9l7 7 7-7",
  up: "M12 20V5M6 11l6-6 6 6",
  merge: "M7 20V9a5 5 0 0 1 5-5h5M13 8l4-4-4-4",
  route: "M6 4v7a4 4 0 0 0 4 4h8M14 11l4 4-4 4",
  tag: "M4 4h7l9 9-7 7-9-9zM8 8h.01",
  desk: "M3 20V8l9-4 9 4v12M9 20v-6h6v6M3 12h18",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5M17 5.5a3 3 0 0 1 0 6M18 14.5c2.4.7 4 2.4 4 5.5",
  chart: "M4 20V4M4 20h16M8 17V11M13 17V7M18 17v-4",
  bell: "M6 16V10a6 6 0 0 1 12 0v6l2 3H4zM10 22h4",
  shield: "M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6zM9 12l2.2 2.2L15.5 10",
  out: "M9 20H5V4h4M14 8l4 4-4 4M18 12H9",
  home: "M4 11l8-7 8 7v9H4zM10 20v-6h4v6",
  inbox: "M3 12h5l1.5 3h5L16 12h5M3 12l3-8h12l3 8v8H3z",
  mail: "M3 6h18v12H3zM3 6l9 7 9-7",
  megaphone: "M4 10v4l12 5V5zM16 8h2a4 4 0 0 1 0 8h-2M6 14v5h3v-3.7",
  refresh: "M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4",
  copy: "M9 9h11v11H9zM15 9V4H4v11h5",
  calendar: "M4 6h16v15H4zM4 10h16M9 3v4M15 3v4",
  spark: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z",
};

export function icon(name, cls = "icon") {
  const path = ICONS[name];
  const node = svgEl("svg", { viewBox: "0 0 24 24", class: cls, "aria-hidden": "true", focusable: "false" });
  node.appendChild(svgEl("path", { d: path || ICONS.file, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  return node;
}

/* ---- formatting ----------------------------------------------------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmt = {
  n(value) {
    const num = Number(value) || 0;
    return num.toLocaleString("en-IN");
  },

  /** "14:02, 4 Sep" for this year, with the year added once it matters. */
  date(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return `${time}, ${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? "" : " " + d.getFullYear()}`;
  },

  day(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  },

  /** Relative, and honest about it: "just now", "4 hours ago", then a real date. */
  when(ts) {
    if (!ts) return "—";
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 0) return fmt.date(ts);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    if (days < 8) return `${days} day${days === 1 ? "" : "s"} ago`;
    return fmt.day(ts);
  },

  /** A span of time, coarse on purpose: nobody needs seconds on a two-day clock. */
  dur(ms) {
    const total = Math.max(0, Math.floor(Number(ms) || 0));
    const mins = Math.floor(total / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours}h ${mins % 60}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  },

  /** Trace codes are read aloud and typed by hand, so they get breathing room. */
  code(value) { return String(value || "").toUpperCase(); },

  words(text, limit = 140) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    return clean.length <= limit ? clean : `${clean.slice(0, limit - 1).trimEnd()}…`;
  },
};

/* ---- status, priority, clock ---------------------------------------------- */

/* The server sends each status with a label and a tone it decided in the domain
   layer, so the client never re-derives what a status means. These maps only turn
   a tone into a class and provide a fallback label if a view ships without one. */
const TONE_CLASS = {
  good: "pill-resolved",
  bad: "pill-overdue",
  warn: "pill-waiting",
  working: "pill-progress",
  neutral: "",
};

const STATUS_LABEL = {
  submitted: "Received",
  triaged: "Accepted",
  in_progress: "Being worked on",
  awaiting_reporter: "Waiting for you",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
  declined: "Not taken forward",
  withdrawn: "Withdrawn",
};

export function pill(status, { label, tone, flat = false } = {}) {
  const text = label || STATUS_LABEL[status] || status || "Unknown";
  const cls = ["pill", TONE_CLASS[tone] || "", flat ? "pill-flat" : ""].filter(Boolean).join(".");
  return el(`span.${cls}`, { text });
}

const PRIO_STROKES = { low: 1, normal: 2, high: 3, urgent: 4 };
const PRIO_LABEL = { low: "Low priority", normal: "Normal priority", high: "High priority", urgent: "Urgent" };

/** One to four strokes in the margin. Same visual language as the tally. */
export function prio(level) {
  const key = PRIO_STROKES[level] ? level : "normal";
  const node = el(`span.prio.prio-${key}`, { role: "img", "aria-label": PRIO_LABEL[key] });
  for (let i = 0; i < PRIO_STROKES[key]; i += 1) {
    node.appendChild(el("i", { style: { height: `${40 + i * 20}%` } }));
  }
  return node;
}

/**
 * The response clock. `remainingMs === null` means it is not running — either the
 * desk is waiting on the reporter or the report is closed — and that is said in
 * words, because a bar that has silently stopped looks like a bar that is broken.
 */
export function clock({ remainingMs, windowMs, overdue = false, paused = false, dueAt = null }) {
  const stopped = remainingMs === null || remainingMs === undefined;
  const span = Number(windowMs) || 0;
  const left = stopped ? 0 : Math.max(0, Number(remainingMs));
  const used = span > 0 ? Math.min(100, Math.max(0, ((span - left) / span) * 100)) : 100;

  const tone = overdue ? "clock-late" : (span > 0 && left / span < 0.25 ? "clock-soon" : "");
  const wrap = el(`div.clock${tone ? "." + tone : ""}${paused || stopped ? ".clock-paused" : ""}`);
  const bar = el("div.clock-bar", {}, el("div.clock-fill", { style: { width: `${overdue ? 100 : used}%` } }));

  let says;
  if (overdue) says = "Past its response time";
  else if (paused) says = "Clock paused — waiting on the reporter";
  else if (stopped) says = "Clock stopped";
  else says = `${fmt.dur(left)} left to respond`;

  wrap.append(bar, el("div.clock-text", {},
    el("span", { text: says }),
    dueAt && !stopped ? el("span.faint", { text: `due ${fmt.date(dueAt)}` }) : null,
  ));
  return wrap;
}

/* ---- toasts --------------------------------------------------------------- */

let toastHost = null;

/**
 * Confirmation of something the person just did, in the past tense, bottom-left —
 * away from the thumb on a phone and away from the action that caused it, so it
 * never covers the thing you were about to press next.
 */
export function toast(message, kind = "") {
  if (!toastHost) {
    toastHost = el("div.toasts", { role: "status", "aria-live": "polite" });
    document.body.appendChild(toastHost);
  }
  const node = el(`div.toast${kind ? ".toast-" + kind : ""}`, { text: message });
  toastHost.appendChild(node);
  setTimeout(() => node.remove(), kind === "bad" ? 6500 : 4000);
  return node;
}

/** Turns a thrown ApiError into something a person can act on. */
export function failed(err, fallback = "That did not go through.") {
  const message = err instanceof ApiError ? err.message : fallback;
  toast(message, "bad");
  if (!(err instanceof ApiError)) console.error(err);
  return message;
}

/* ---- overlays ------------------------------------------------------------- */

/* One overlay at a time, Esc closes it, focus goes in and comes back out to
   whatever opened it. Written once here rather than three times in the pages. */
let openOverlay = null;

function mountOverlay(node, onClose) {
  closeOverlay();
  const returnTo = document.activeElement;
  document.body.appendChild(node);
  document.body.style.overflow = "hidden";

  const onKey = (e) => { if (e.key === "Escape") closeOverlay(); };
  document.addEventListener("keydown", onKey);

  openOverlay = () => {
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = "";
    node.remove();
    openOverlay = null;
    if (returnTo instanceof HTMLElement) returnTo.focus({ preventScroll: true });
    onClose?.();
  };

  const first = node.querySelector("[autofocus], button, a, input, textarea, select");
  (first instanceof HTMLElement ? first : node).focus?.({ preventScroll: true });
  return openOverlay;
}

export function closeOverlay() { openOverlay?.(); }

/** The report drawer: slides in from the right, which is where it goes back to. */
export function drawer({ title, head = [], body = [], onClose }) {
  const panel = el("div.sheet-panel", { role: "dialog", "aria-modal": "true", "aria-label": title || "Details", tabindex: "-1" });
  panel.append(
    el("div.sheet-head", {},
      el("div.row", {}, ...head),
      el("button.btn.btn-quiet.btn-sm", { type: "button", "aria-label": "Close", on: { click: () => closeOverlay() } }, icon("x")),
    ),
    el("div.sheet-body", {}, ...body),
  );
  const over = el("div.sheet-over", {}, el("div.sheet-veil", { on: { click: () => closeOverlay() } }), panel);
  mountOverlay(over, onClose);
  return panel;
}

/**
 * Asks one question and returns a promise. Used where an action cannot be undone —
 * merging two reports, rejecting a college — and nowhere else, because a dialog on
 * a safe action just teaches people to dismiss dialogs.
 */
export function confirmAction({ title, note, confirmLabel = "Confirm", danger = false, needs = null }) {
  return new Promise((resolve) => {
    let value = needs?.value ?? needs?.options?.[0]?.[0] ?? "";
    // `needs.options` turns the one input into a picker: same promise, same
    // contract, so a caller that needs a choice rather than a sentence does not
    // need a second modal implementation.
    const input = !needs
      ? null
      : needs.options
        ? el("select.select", {
          value,
          on: { change: (e) => { value = e.target.value; } },
        }, ...needs.options.map(([key, label]) => el("option", { value: key, text: label })))
        : el("input.input", {
          type: "text", placeholder: needs.placeholder || "", value, autofocus: true,
          on: { input: (e) => { value = e.target.value; } },
        });

    const panel = el("div.modal-panel", { role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1" });
    panel.append(
      el("div.panel-head", {}, el("span.panel-title", { text: title })),
      el("div.panel-body.stack-tight", {},
        note ? el("p.t-sm.quiet", { text: note }) : null,
        needs ? el("label.field", {}, el("span.label", { text: needs.label }), input) : null,
      ),
      el("div.panel-foot.row", {},
        el("button.btn.btn-quiet.btn-sm", { type: "button", on: { click: () => { closeOverlay(); resolve(null); } } }, "Cancel"),
        el(`button.btn.btn-sm${danger ? ".btn-seal" : ""}.push`, {
          type: "button",
          on: { click: () => { resolve(needs ? (value || "") : true); closeOverlay(); } },
        }, confirmLabel),
      ),
    );
    mountOverlay(el("div.modal", {}, el("div.sheet-veil", { on: { click: () => { closeOverlay(); resolve(null); } } }), panel), () => resolve(null));
    input?.focus();
  });
}

/* ---- small helpers -------------------------------------------------------- */

/** Waits for typing to stop. Used by the live reading panel and the search box. */
export function debounce(fn, ms = 260) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export async function copy(text, said = "Copied.") {
  try {
    await navigator.clipboard.writeText(String(text));
    toast(said, "good");
    return true;
  } catch {
    // Clipboard access is refused on insecure origins, which a LAN demo often is.
    toast("Copying is blocked here — select the code and copy it by hand.", "bad");
    return false;
  }
}

/** A labelled key/value pair, the metadata unit both surfaces use. */
export function fact(k, v) {
  return el("div.fact", {}, el("span.fact-k", { text: k }), el("span.fact-v", { text: v ?? "—" }));
}

export function blank(title, note, action = null) {
  return el("div.blank", {},
    el("div.blank-title", { text: title }),
    note ? el("p.blank-note", { text: note }) : null,
    action ? el("div.blank-act", {}, action) : null,
  );
}

export function loading(rows = 3) {
  const node = el("div.load", { "aria-hidden": "true" });
  for (let i = 0; i < rows; i += 1) node.appendChild(el("i"));
  return node;
}

/* ---- routing -------------------------------------------------------------- */

/**
 * Hash routing, deliberately.
 *
 * A trace code identifies a report and works as its credential, so it must never
 * appear in a path the browser would send to the server in a Referer header or
 * write into a proxy log. Everything after `#` stays on the machine it was typed
 * on. The server's own no-referrer policy is the second half of the same decision.
 */
export class Router {
  #routes = [];
  #fallback = null;
  #current = null;

  add(pattern, handler) {
    const names = [];
    const rx = new RegExp(`^${pattern.replace(/:([a-z]+)/gi, (_, n) => { names.push(n); return "([^/]+)"; })}$`, "i");
    this.#routes.push({ rx, names, handler });
    return this;
  }

  fallback(handler) { this.#fallback = handler; return this; }

  /** The path part of the hash, without its query string. */
  static path() {
    const raw = location.hash.replace(/^#/, "") || "/";
    return raw.split("?")[0] || "/";
  }

  static query() {
    const raw = location.hash.replace(/^#/, "");
    return new URLSearchParams(raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "");
  }

  static go(path, { replace = false } = {}) {
    const next = `#${path}`;
    if (location.hash === next) { window.dispatchEvent(new HashChangeEvent("hashchange")); return; }
    if (replace) location.replace(next); else location.hash = next;
  }

  start() {
    const run = () => {
      const path = Router.path();
      if (path === this.#current) return;
      this.#current = path;
      for (const { rx, names, handler } of this.#routes) {
        const hit = rx.exec(path);
        if (!hit) continue;
        const params = {};
        names.forEach((n, i) => { params[n] = decodeURIComponent(hit[i + 1]); });
        handler(params, Router.query());
        return;
      }
      this.#fallback?.(path);
    };
    window.addEventListener("hashchange", run);
    run();
    return this;
  }

  /** Forces a re-run of the current route, after a mutation changed the data. */
  refresh() { this.#current = null; window.dispatchEvent(new HashChangeEvent("hashchange")); }
}

/** Marks the nav link that matches where we are. */
export function markNav(root, path) {
  for (const link of $$("a[href^='#']", root)) {
    const target = link.getAttribute("href").slice(1).split("?")[0];
    const on = target === path || (target !== "/" && path.startsWith(target));
    if (on) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  }
}

