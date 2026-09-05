// A DOM good enough to actually run TrustLine's front end in Node, so boot
// crashes and render crashes surface here instead of in rafik's browser.

class ClassList {
  constructor(node) { this.node = node; }
  get set() { return new Set(String(this.node.getAttribute("class") || "").split(/\s+/).filter(Boolean)); }
  write(s) { this.node.setAttribute("class", [...s].join(" ")); }
  add(...c) { const s = this.set; c.forEach((x) => s.add(x)); this.write(s); }
  remove(...c) { const s = this.set; c.forEach((x) => s.delete(x)); this.write(s); }
  toggle(c, on) { const s = this.set; const has = s.has(c); const want = on === undefined ? !has : on; want ? s.add(c) : s.delete(c); this.write(s); return want; }
  contains(c) { return this.set.has(c); }
}

export class Node {
  constructor(tag = "div", ns = null) {
    this.tagName = String(tag).toUpperCase();
    this.localName = String(tag).toLowerCase();
    this.namespaceURI = ns;
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = new Proxy({}, { set: (t, k, v) => { t[k] = v; return true; } });
    this.dataset = new Proxy({}, { set: (t, k, v) => { t[k] = String(v); return true; }, get: (t, k) => t[k] });
    this._classList = new ClassList(this);
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.selected = false;
    this.scrollTop = 0;
    this.nodeValue = null;
  }
  get classList() { return this._classList; }
  get className() { return this.getAttribute("class") || ""; }
  set className(v) { this.setAttribute("class", v); }
  get children() { return this.childNodes.filter((n) => n instanceof Node && n.tagName !== "#TEXT"); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === globalThis.document; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  append(...ns) { ns.forEach((n) => n != null && this.appendChild(typeof n === "string" ? new Text(n) : n)); }
  prepend(...ns) { ns.reverse().forEach((n) => { if (n == null) return; const x = typeof n === "string" ? new Text(n) : n; x.parentNode = this; this.childNodes.unshift(x); }); }
  insertBefore(n, ref) { const i = this.childNodes.indexOf(ref); n.parentNode = this; i < 0 ? this.childNodes.push(n) : this.childNodes.splice(i, 0, n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  remove() { this.parentNode?.removeChild(this); }
  replaceChildren(...ns) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; this.append(...ns); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(v) { this.childNodes = []; if (v !== "" && v != null) this.appendChild(new Text(v)); }
  addEventListener(ev, fn) { if (!this.listeners.has(ev)) this.listeners.set(ev, new Set()); this.listeners.get(ev).add(fn); }
  removeEventListener(ev, fn) { this.listeners.get(ev)?.delete(fn); }
  dispatchEvent(e) {
    e.target = e.target || this;
    e.currentTarget = this;
    for (const fn of this.listeners.get(e.type) ?? []) fn(e);
    if (e.bubbles && this.parentNode?.dispatchEvent) this.parentNode.dispatchEvent(e);
    return true;
  }
  /**
   * Clicking a submit button submits its form, which is how most of the write
   * paths in this product are actually triggered. Without this the harness can
   * click every button in the console and still exercise none of the forms.
   */
  click() {
    this.dispatchEvent({ type: "click", target: this, bubbles: true, preventDefault() {}, stopPropagation() {} });
    const submits = this.tagName === "BUTTON" && (this.getAttribute("type") ?? "submit") === "submit";
    if (!submits) return;
    let form = this.parentNode;
    while (form && form.tagName !== "FORM") form = form.parentNode;
    form?.dispatchEvent({ type: "submit", target: form, bubbles: false, preventDefault() {}, stopPropagation() {} });
  }
  focus() {} blur() {} scrollIntoView() {} select() {}
  getContext() { return canvas2d(); }
  getBoundingClientRect() { return { width: 640, height: 320, top: 0, left: 0, bottom: 320, right: 640 }; }
  get offsetWidth() { return 640; }
  get clientWidth() { return 640; }
  get offsetHeight() { return 320; }
  closest(sel) { let n = this; while (n) { if (n.matches?.(sel)) return n; n = n.parentNode; } return null; }
  matches(sel) { return matchOne(this, sel); }
  querySelector(sel) { return walk(this).find((n) => matchSel(n, sel)) ?? null; }
  querySelectorAll(sel) { return walk(this).filter((n) => matchSel(n, sel)); }
  get elements() { return walk(this).filter((n) => ["INPUT", "SELECT", "TEXTAREA"].includes(n.tagName)); }
  reset() {}
  submit() {}
}

export class Text extends Node {
  constructor(v) { super("#text"); this.data = String(v); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

function walk(root, out = []) {
  for (const c of root.childNodes) { if (c instanceof Node && c.tagName !== "#TEXT") { out.push(c); walk(c, out); } }
  return out;
}

// Selector support: the subset the front end actually uses — tag, .class, #id,
// [attr], [attr="v"], :has(...), descendant combinators, and comma lists.
function matchSel(node, sel) {
  return String(sel).split(",").some((part) => {
    const steps = part.trim().split(/\s+/).filter(Boolean);
    if (!steps.length) return false;
    if (!matchOne(node, steps[steps.length - 1])) return false;
    let n = node.parentNode;
    for (let i = steps.length - 2; i >= 0; i -= 1) {
      let found = false;
      while (n) { if (matchOne(n, steps[i])) { found = true; n = n.parentNode; break; } n = n.parentNode; }
      if (!found) return false;
    }
    return true;
  });
}

function matchOne(node, sel) {
  if (!(node instanceof Node) || node.tagName === "#TEXT") return false;
  let s = String(sel).trim();
  if (s === "*") return true;
  const has = s.match(/:has\(([^)]*)\)/);
  if (has) { s = s.replace(has[0], ""); if (!walk(node).some((d) => matchOne(d, has[1].trim()))) return false; }
  for (const m of s.matchAll(/\[([\w-]+)(?:([~^$*]?=)"?([^\]"]*)"?)?\]/g)) {
    const v = node.getAttribute(m[1]) ?? (m[1] === "name" ? node.getAttribute("name") : null);
    if (v === null) return false;
    if (m[2] && v !== m[3]) return false;
  }
  s = s.replace(/\[[^\]]*\]/g, "").replace(/:(hover|focus|disabled|checked|first-child|last-child|not\([^)]*\))/g, "");
  const id = s.match(/#([\w-]+)/);
  if (id && node.getAttribute("id") !== id[1]) return false;
  s = s.replace(/#[\w-]+/g, "");
  for (const c of s.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(c[1])) return false;
  const tag = s.replace(/\.[\w-]+/g, "").trim();
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  return true;
}

function canvas2d() {
  const noop = () => {};
  return new Proxy({
    measureText: (t) => ({ width: String(t).length * 6 }),
    canvas: { width: 640, height: 320 },
    createLinearGradient: () => ({ addColorStop: noop }),
    getImageData: () => ({ data: [] }),
    setLineDash: noop,
  }, { get: (t, k) => (k in t ? t[k] : noop), set: () => true });
}

export function install(base = "http://localhost:3333") {
  const doc = new Node("#document");
  doc.createElement = (tag) => new Node(tag);
  doc.createElementNS = (ns, tag) => new Node(tag, ns);
  doc.createTextNode = (v) => new Text(v);
  doc.createDocumentFragment = () => new Node("#fragment");
  doc.documentElement = new Node("html");
  doc.body = new Node("body");
  doc.head = new Node("head");
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.appendChild(doc.documentElement);
  doc.getElementById = (id) => doc.querySelector(`#${id}`);
  doc.activeElement = null;
  doc.title = "";
  doc.hidden = false;
  doc.readyState = "complete";
  doc.cookie = "";

  // `hash` is a real accessor: assigning it fires hashchange, the way a browser
  // does, because that is the only thing that drives the router.
  let hash = "";
  const loc = {
    origin: base, protocol: "http:", host: "localhost:3333", pathname: "/", search: "",
    get href() { return `${base}/${hash}`; },
    get hash() { return hash; },
    set hash(v) {
      const next = String(v).startsWith("#") ? String(v) : `#${v}`;
      if (next === hash) return;
      hash = next;
      globalThis.window.dispatchEvent(new globalThis.HashChangeEvent("hashchange"));
    },
    replace(u) { loc.hash = String(u); },
    assign(u) { loc.hash = String(u); },
    reload() {},
  };

  const win = new Node("#window");
  Object.assign(win, {
    location: loc, document: doc, innerWidth: 1280, innerHeight: 900, devicePixelRatio: 1,
    scrollTo: () => {}, requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {} }),
    // The charts read their palette out of the cascade, so this has to answer like
    // a CSSStyleDeclaration: a real getPropertyValue, with values for the tokens.
    getComputedStyle: () => ({
      getPropertyValue: (name) => (String(name).startsWith("--") ? "#123456" : ""),
      fontFamily: "system-ui",
    }),
  });

  class EventSourceStub extends Node {
    constructor(url) { super("#es"); this.url = url; this.readyState = 1; EventSourceStub.made.push(this); }
    close() { this.readyState = 2; }
  }
  EventSourceStub.made = [];

  globalThis.window = win;
  globalThis.document = doc;
  globalThis.location = loc;
  globalThis.history = { pushState: () => {}, replaceState: () => {}, back: () => {}, go: () => {} };
  // Node 22 defines navigator as a getter-only global, so it has to be redefined.
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, writable: true,
    value: { clipboard: { writeText: async () => {} }, userAgent: "node", language: "en-IN" },
  });
  globalThis.Node = Node;
  globalThis.Text = Text;
  globalThis.Element = Node;
  globalThis.HTMLElement = Node;
  globalThis.EventSource = EventSourceStub;
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  globalThis.matchMedia = win.matchMedia;
  globalThis.getComputedStyle = win.getComputedStyle;
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.sessionStorage = globalThis.localStorage;
  globalThis.CustomEvent = class { constructor(t, o = {}) { this.type = t; this.detail = o.detail; this.bubbles = !!o.bubbles; } };
  globalThis.Event = globalThis.CustomEvent;
  globalThis.HashChangeEvent = class { constructor(t) { this.type = t; } };
  globalThis.FormData = class { constructor() { this.m = new Map(); } append(k, v) { this.m.set(k, v); } get(k) { return this.m.get(k); } };

  // Cookies, so signing in sticks across requests like a browser.
  let jar = "";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const full = String(url).startsWith("http") ? String(url) : base + String(url);
    const headers = { ...(init.headers || {}) };
    if (jar) headers.cookie = jar;
    const res = await realFetch(full, { ...init, headers, redirect: "manual" });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) jar = set.map((c) => c.split(";")[0]).join("; ");
    return res;
  };

  return { doc, win, loc, EventSourceStub, clearJar: () => { jar = ""; } };
}

export const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
