// fx.js — TrustLine's deep-space layer.
//
// Loaded only from index.html, after app.js. Everything here is additive: it
// paints one fixed <canvas> behind the page, adds a few classes, and animates
// scroll/pointer. It never touches app state, so deleting the two tags from
// index.html returns the site to the plain theme.
//
// No dependencies, because the CSP allows scripts only from this origin and
// there is no build step: the 3D core is a few dozen lines of perspective math
// drawn straight to canvas. The starfield, the nebula, the rotating wireframe
// and the floor grid are all this file.
//
// Motion policy:
//   - prefers-reduced-motion "reduce"  → theme stays, canvas renders ONE static
//     frame, no loop, no transforms, no pointer effects.
//   - coarse pointer (touch)           → same engine, fewer particles, no mouse
//     parallax, no pointer tilt (nothing to hover with).
//   - fine pointer                     → everything.

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const coarse = window.matchMedia("(pointer: coarse)");
const fine = window.matchMedia("(pointer: fine)");

const MOVE = !reduced.matches;          // may animate at all
const FINE = MOVE && fine.matches;      // full effects

const view = document.getElementById("view");

/* ---- palette (read from the theme fx.css sets up) -------------------------- */

let PAL = {
  ink: [217, 230, 255],
  ink3: [95, 113, 150],
  cyan: [34, 211, 238],
  rose: [255, 59, 107],
  violet: [192, 132, 252],
  blue: [96, 165, 250],
};

function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const hex = (name) => {
    const raw = cs.getPropertyValue(name).trim().replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(raw)) return null;
    const n = parseInt(raw, 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  const p = {
    ink: hex("--ink") ?? PAL.ink,
    ink3: hex("--ink-3") ?? PAL.ink3,
    cyan: hex("--indigo") ?? PAL.cyan,
    rose: hex("--seal") ?? PAL.rose,
    violet: [192, 132, 252],
    blue: hex("--indigo-2") ?? PAL.blue,
  };
  PAL = p;
}

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/* ---- the canvas ------------------------------------------------------------ */

const canvas = document.createElement("canvas");
canvas.className = "fx-space";
canvas.setAttribute("aria-hidden", "true");
document.body.appendChild(canvas);

const ctx = canvas.getContext("2d");

let W = 0;
let H = 0;
let dpr = 1;

function size() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", () => { size(); }, { passive: true });

/* ---- ambient state ---------------------------------------------------------- */

let scroll = 0;
window.addEventListener("scroll", () => { scroll = window.scrollY; }, { passive: true });

const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
if (FINE) {
  window.addEventListener("pointermove", (e) => {
    mouse.tx = (e.clientX / W) * 2 - 1;
    mouse.ty = (e.clientY / H) * 2 - 1;
  }, { passive: true });
}

/* ---- nebula ---------------------------------------------------------------- */

const BLOBS = [
  { x: 0.20, y: 0.28, r: 0.5, c: [34, 211, 238], a: 0.12, ph: 0.0 },
  { x: 0.76, y: 0.18, r: 0.46, c: [192, 132, 252], a: 0.11, ph: 2.1 },
  { x: 0.16, y: 0.82, r: 0.5, c: [255, 59, 107], a: 0.06, ph: 4.2 },
  { x: 0.86, y: 0.74, r: 0.5, c: [96, 165, 250], a: 0.07, ph: 1.4 },
];

function drawNebula(now) {
  ctx.globalCompositeOperation = "lighter";
  for (const b of BLOBS) {
    const xc = W * b.x + Math.sin(now * 0.00009 + b.ph) * W * 0.05;
    const yc = H * b.y + Math.cos(now * 0.00007 + b.ph) * H * 0.05;
    const radius = Math.max(W, H) * b.r;
    const g = ctx.createRadialGradient(xc, yc, 0, xc, yc, radius);
    g.addColorStop(0, rgba(b.c, b.a));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = "source-over";
}

/* ---- starfield -------------------------------------------------------------- */

function makeStars(n, bright) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: Math.random(),
      y: Math.random(),
      r: (bright ? 0.5 : 0.35) + Math.random() * (bright ? 1.3 : 0.8),
      a: (bright ? 0.28 : 0.14) + Math.random() * 0.5,
      tw: Math.random() * Math.PI * 2,
      speed: 0.005 + Math.random() * 0.013,
      depth: 0.15 + Math.random() * 0.8,
    });
  }
  return out;
}

const cap = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (v, l) => ((v % l) + l) % l;

function drawStars(now, dt, field, bright) {
  for (const s of field) {
    const px = wrap(s.x + s.speed * (now / 1000) * 0.05, 1);
    const lx = px + mouse.x * 0.02 * s.depth;
    const ly = s.y + mouse.y * 0.015 * s.depth;
    const sy = wrap(ly * H - scroll * 0.25 * s.depth, H);
    const x = cap(lx * W, -10, W + 10);
    const tw = 0.55 + 0.45 * Math.sin(now / 600 + s.tw);
    ctx.fillStyle = rgba(PAL.ink, cap(s.a * tw * (bright ? 1 : 0.8), 0, 1));
    ctx.beginPath();
    ctx.arc(x, sy, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawConstellation(now, dt) {
  ctx.strokeStyle = rgba(PAL.cyan, 0.08);
  ctx.lineWidth = 1;
  const nodes = [];
  for (const s of CONST_FIELD) {
    const x = cap((s.x + mouse.x * 0.03 * s.depth) * W, -20, W + 20);
    const y = wrap(s.y * H - scroll * 0.3 * s.depth, H);
    nodes.push({ x, y });
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 110 * 110) {
        ctx.globalAlpha = cap(0.16 - d2 / (110 * 110) * 0.14, 0, 0.16);
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(nodes[j].x, nodes[j].y);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
}

const STAR_FAR = makeStars(coarse.matches ? 70 : 150, false);
const CONST_FIELD = makeStars(coarse.matches ? 22 : 46, true);

/* ---- the 3D core ------------------------------------------------------------- */

/* A wireframe icosahedron with a drifting particle shell and three orbit rings,
   projected by hand. GOLDEN builds the 12 vertices, the unit edge length then
   pairs them into the 30 edges. */

const GOLDEN = (1 + Math.sqrt(5)) / 2;
const RAW_VERTICES = [
  [0, -1, -GOLDEN], [0, -1, GOLDEN], [0, 1, -GOLDEN], [0, 1, GOLDEN],
  [-1, -GOLDEN, 0], [-1, GOLDEN, 0], [1, -GOLDEN, 0], [1, GOLDEN, 0],
  [-GOLDEN, 0, -1], [-GOLDEN, 0, 1], [GOLDEN, 0, -1], [GOLDEN, 0, 1],
];

const CORE_VERTICES = RAW_VERTICES.map(([x, y, z]) => {
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
});

const EDGE_LEN = Math.hypot(
  CORE_VERTICES[0].x - CORE_VERTICES[1].x,
  CORE_VERTICES[0].y - CORE_VERTICES[1].y,
  CORE_VERTICES[0].z - CORE_VERTICES[1].z,
);

const CORE_EDGES = [];
for (let i = 0; i < CORE_VERTICES.length; i++) {
  for (let j = i + 1; j < CORE_VERTICES.length; j++) {
    const d = Math.hypot(
      CORE_VERTICES[i].x - CORE_VERTICES[j].x,
      CORE_VERTICES[i].y - CORE_VERTICES[j].y,
      CORE_VERTICES[i].z - CORE_VERTICES[j].z,
    );
    if (d < EDGE_LEN * 1.02) CORE_EDGES.push([i, j]);
  }
}

function spherePoint(radius) {
  const u = Math.random() * Math.PI * 2;
  const v = Math.acos(2 * Math.random() - 1);
  const s = Math.sin(v);
  return {
    x: radius * s * Math.cos(u),
    y: radius * s * Math.sin(u),
    z: radius * Math.cos(v),
  };
}

const PARTICLE_COUNT = coarse.matches ? 90 : 200;
const CORE_PARTICLES = [];
for (let i = 0; i < PARTICLE_COUNT; i++) {
  const radius = 1.18 + Math.random() * 0.55;
  const p = spherePoint(radius);
  CORE_PARTICLES.push({
    ...p,
    r: 0.6 + Math.random() * 1.1,
    a: 0.25 + Math.random() * 0.45,
    c: [PAL.cyan, PAL.rose, PAL.violet, PAL.blue][(Math.random() * 4) | 0],
  });
}

function ringPoints(count, tiltX, tiltY) {
  const pts = [];
  const cx = Math.cos(tiltX) * Math.cos(tiltY);
  const cy = Math.sin(tiltX);
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const a = Math.cos(t);
    const b = Math.sin(t);
    pts.push({ x: a, y: b * cy, z: b * cx });
  }
  return pts;
}

const RINGS = [
  { pts: ringPoints(coarse.matches ? 40 : 90, 0.2, 0), r: 1.4, c: PAL.cyan, a: 0.10 },
  { pts: ringPoints(coarse.matches ? 40 : 90, 1.5, 1.1), r: 1.52, c: PAL.violet, a: 0.09 },
  { pts: ringPoints(coarse.matches ? 40 : 90, -0.9, 2.2), r: 1.44, c: PAL.rose, a: 0.07 },
];

function drawCore(now, dt) {
  // Fade the core out as the page scrolls past the first screenful.
  const fade = 1 - cap(scroll / (H * 0.85), 0, 1);
  if (fade <= 0) return;

  const ry = now * 0.00012 + mouse.x * 0.35;
  const rx = 0.32 + mouse.y * 0.3;

  const cx = W * 0.5 + mouse.x * 26;
  const cy = H * 0.40 + mouse.y * 18;
  const scl = Math.min(W, H) * (coarse.matches ? 0.22 : 0.30);
  const FOV = 680;

  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const cosX = Math.cos(rx), sinX = Math.sin(rx);

  const project = (p) => {
    const x1 = p.x * cosY - p.z * sinY;
    const z1 = p.x * sinY + p.z * cosY;
    const y1 = p.y * cosX - z1 * sinX;
    const z2 = p.y * sinX + z1 * cosX;
    const persp = FOV / (FOV + z2 * scl * 0.85);
    return { x: cx + x1 * scl * persp, y: cy - y1 * scl * persp, persp };
  };

  // Central glow.
  ctx.globalCompositeOperation = "lighter";
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, scl * 1.25);
  glow.addColorStop(0, rgba(PAL.cyan, 0.16 * fade));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - scl * 1.3, cy - scl * 1.3, scl * 2.6, scl * 2.6);
  ctx.globalCompositeOperation = "source-over";

  // Orbit rings.
  for (const ring of RINGS) {
    ctx.strokeStyle = rgba(ring.c, ring.a * fade);
    ctx.lineWidth = 1;
    ctx.beginPath();
    let move = true;
    for (const p of ring.pts) {
      const q = project({ x: p.x * ring.r, y: p.y * ring.r, z: p.z * ring.r });
      if (move) { ctx.moveTo(q.x, q.y); move = false; }
      else ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Retro-orbit dashes: two slow counter-rotating dashed guides in screen space.
  ctx.save();
  ctx.setLineDash([3, 11]);
  ctx.lineDashOffset = -now * 0.025;
  ctx.strokeStyle = rgba(PAL.violet, 0.14 * fade);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, scl * 1.04, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([1, 15]);
  ctx.lineDashOffset = now * 0.02;
  ctx.strokeStyle = rgba(PAL.cyan, 0.10 * fade);
  ctx.beginPath();
  ctx.arc(cx, cy, scl * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Particle shell.
  for (const p of CORE_PARTICLES) {
    const q = project(p);
    if (q.persp < 0.28) continue;
    ctx.fillStyle = rgba(p.c, p.a * fade * cap(q.persp, 0.2, 1));
    ctx.beginPath();
    ctx.arc(q.x, q.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Wireframe shell.
  ctx.strokeStyle = rgba(PAL.cyan, 0.16 * fade);
  ctx.lineWidth = 1;
  const proj = CORE_VERTICES.map(project);
  for (const [i, j] of CORE_EDGES) {
    if (proj[i].persp < 0.1 || proj[j].persp < 0.1) continue;
    ctx.beginPath();
    ctx.moveTo(proj[i].x, proj[i].y);
    ctx.lineTo(proj[j].x, proj[j].y);
    ctx.stroke();
  }

  ctx.fillStyle = rgba(PAL.cyan, 0.6 * fade);
  for (const q of proj) {
    if (q.persp < 0.1) continue;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ---- the floor grid --------------------------------------------------------- */

function drawGrid(now) {
  if (W < 560 || H < 460) return;
  const horizonY = H * 0.80;
  const fade = 1 - cap(scroll / (H * 0.9), 0, 1);
  if (fade <= 0) return;

  const rows = 14;
  for (let i = 1; i <= rows; i++) {
    const t = i / rows;
    const y = horizonY + Math.pow(t, 2.6) * Math.min(H * 0.55, 480);
    if (y > H + 4) break;
    ctx.strokeStyle = rgba(PAL.cyan, (0.03 + t * 0.09) * fade);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  const bs = Math.min(W * 0.16, 130);
  const cols = Math.ceil(W / bs) + 2;
  for (let c = -cols; c <= cols; c++) {
    const x0 = W / 2 + c * bs;
    if (x0 < -120 || x0 > W + 120) continue;
    const x1 = W / 2 + c * bs * 0.04;
    ctx.strokeStyle = rgba(PAL.cyan, cap(0.10 - Math.abs(c) * 0.008, 0, 0.10) * fade);
    ctx.beginPath();
    ctx.moveTo(x0, H + 4);
    ctx.lineTo(x1, horizonY);
    ctx.stroke();
  }

  const horizonGradient = ctx.createLinearGradient(0, horizonY - 10, 0, horizonY + 10);
  horizonGradient.addColorStop(0, rgba(PAL.cyan, 0));
  horizonGradient.addColorStop(0.5, rgba(PAL.cyan, 0.13 * fade));
  horizonGradient.addColorStop(1, rgba(PAL.cyan, 0));
  ctx.fillStyle = horizonGradient;
  ctx.fillRect(0, horizonY - 10, W, 20);
}

/* ---- the scan sweep ---------------------------------------------------------
   One soft horizontal light band falls slowly down the screen, then loops. It is
   the only full-viewport motion, kept faint enough to read as instrument light. */

let sweepRef = 0;

function drawSweep(now) {
  const cycle = 9000;
  const t = ((((now - sweepRef) % cycle) + cycle) % cycle) / cycle;
  const y = t * (H + 160) - 80;
  const g = ctx.createLinearGradient(0, y - 46, 0, y + 46);
  g.addColorStop(0, "rgba(34,211,238,0)");
  g.addColorStop(0.5, "rgba(34,211,238,0.06)");
  g.addColorStop(1, "rgba(34,211,238,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, y - 46, W, 92);
  ctx.fillStyle = "rgba(34,211,238,0.13)";
  ctx.fillRect(0, y - 1, W, 2);
}

/* ---- one frame --------------------------------------------------------------- */

function frame(now, dt) {
  ctx.clearRect(0, 0, W, H);
  drawNebula(now);
  drawStars(now, dt, STAR_FAR, false);
  drawConstellation(now, dt);
  drawCore(now, dt);
  drawGrid(now);
  drawSweep(now);
}

/* ---- the loop ---------------------------------------------------------------- */

let last = performance.now();
let raf = 0;

function loop(now) {
  const dt = Math.min(80, now - last);
  last = now;
  if (!document.hidden) {
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    frame(now, dt);
    tiltBands();
  }
  raf = requestAnimationFrame(loop);
}

/* ---- entrance rise ------------------------------------------------------------
   Cards and rows fly up out of the depth once, just inside the viewport, with a
   stagger down the list. The .fx-rise class is removed on animationend so the
   fill-mode never pins a transform over the pointer tilt. */

const RISE = ".entry, .choice, .panel, .register, .receipt, .line-item";
const SKIP = ".reading, .sheet-over, .modal, .toasts";
const observed = new WeakSet();
let riseIO = null;

function ensureRise() {
  if (riseIO) return riseIO;
  riseIO = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const el = en.target;
      riseIO.unobserve(el);
      if (el.closest(SKIP)) continue;
      el.classList.add("fx-rise");
      const sibs = el.parentElement ? el.parentElement.children : [];
      let idx = 0;
      for (let i = 0; i < sibs.length; i++) {
        if (sibs[i] === el) { idx = i; break; }
      }
      const delay = Math.min(380, idx * 40);
      if (delay) el.style.animationDelay = delay + "ms";
    }
  }, { threshold: 0.08, rootMargin: "0px 0px -5% 0px" });
  return riseIO;
}

function armRise() {
  if (!MOVE) return;
  const io = ensureRise();
  const nodes = view ? view.querySelectorAll(RISE) : [];
  for (const el of nodes) {
    if (observed.has(el)) continue;
    observed.add(el);
    io.observe(el);
  }
}

document.addEventListener("animationend", (e) => {
  const el = e.target;
  if (!el || !el.classList) return;
  if (e.animationName === "fx-enter") {
    el.classList.remove("fx-enter");
  } else if (e.animationName === "fx-rise") {
    el.classList.remove("fx-rise");
    if (el.style.animationDelay) el.style.animationDelay = "";
  }
}, true);

/* ---- pointer tilt -------------------------------------------------------------- */

const TILT = ".register, .choice, .panel-seal, .receipt";
const tilted = new WeakSet();

function armTilt() {
  if (!FINE) return;
  const nodes = view ? view.querySelectorAll(TILT) : [];
  for (const el of nodes) {
    if (tilted.has(el)) continue;
    tilted.add(el);
    el.classList.add("fx-tilt");
    let val = [0, 0, false];
    let pending = 0;
    const paint = () => {
      pending = 0;
      const [x, y, over] = val;
      el.style.transform = over
        ? `perspective(900px) rotateX(${(-y * 6.5).toFixed(2)}deg) rotateY(${(x * 6.5).toFixed(2)}deg) translateY(-2px)`
        : "";
    };
    const queue = () => { if (!pending) pending = requestAnimationFrame(paint); };
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      val = [
        (e.clientX - (r.left + r.width / 2)) / (r.width / 2),
        (e.clientY - (r.top + r.height / 2)) / (r.height / 2),
        true,
      ];
      queue();
    }, { passive: true });
    el.addEventListener("pointerleave", () => {
      val = [0, 0, false];
      queue();
    }, { passive: true });
  }
}

/* ---- the scroll tilt ------------------------------------------------------------
   Bands recede into the depth as they leave the middle of the screen: the section
   you are reading is flat and close, the ones around it tip away. */

let bands = [];

function collectBands() {
  const out = [];
  if (!view) return out;
  for (const shell of view.children) {
    if (!(shell instanceof HTMLElement) || !shell.classList.contains("shell")) continue;
    for (const kid of shell.children) {
      const cls = typeof kid.className === "string" ? kid.className : "";
      if (cls.includes("band")) out.push(kid);
    }
  }
  return out;
}

function tiltBands() {
  if (!MOVE || !view) return;
  const vh = window.innerHeight || 800;
  const cx = vh / 2;
  for (const b of bands) {
    if (!b.isConnected) continue;
    const r = b.getBoundingClientRect();
    if (r.bottom < -60 || r.top > vh + 60) continue;
    const t = Math.min(1, Math.abs((r.top + r.height / 2) - cx) / (vh * 0.8));
    if (t < 0.05) {
      if (b.style.transform) b.style.transform = "";
      if (b.style.opacity) b.style.opacity = "";
      continue;
    }
    b.style.transform =
      `translate3d(0, ${Math.round(t * 24)}px, ${Math.round(t * -30)}px) rotateX(${(t * 9).toFixed(2)}deg)`;
    b.style.opacity = Math.max(0.55, 1 - t * 0.18).toFixed(3);
  }
}

/* ---- rescan after every SPA paint -------------------------------------------- */

let scanQueued = false;

function armEnter() {
  if (!MOVE || !view) return;
  for (const child of view.children) {
    if (child.classList && child.classList.contains("shell") && !child.classList.contains("fx-enter")) {
      child.classList.add("fx-enter");
    }
  }
}

function scan() {
  scanQueued = false;
  bands = collectBands();
  armRise();
  armTilt();
  armEnter();
}

function queueScan() {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(scan);
}

/* ---- HUD ----------------------------------------------------------------------- */

function hud() {
  const el = document.createElement("div");
  el.className = "fx-hud";
  el.innerHTML =
    "TRUSTLINE//TRACE" +
    "<span class='fx-hud-ok'> ● SECURE</span>" +
    "<span class='fx-hud-caret'>▮</span>";
  const time = document.createElement("div");
  time.className = "fx-hud-time";
  el.appendChild(time);
  const tick = () => {
    time.textContent = "T " + new Date().toTimeString().slice(0, 8) + " UTC" + (new Date().getTimezoneOffset() <= 0 ? "+" : "-") + Math.abs(new Date().getTimezoneOffset() / 60);
  };
  tick();
  setInterval(tick, 1000);
  document.body.appendChild(el);
}

/* ---- screen chrome ----------------------------------------------------------------

   The scanlines, the corner brackets and the energy beam are pure decoration and
   pointer-transparent; add them unconditionally (they stay static under reduced
   motion because the animations are gated by the media query in fx.css). */

function chrome() {
  const wrap = (cls, html) => {
    const el = document.createElement("div");
    el.className = cls;
    if (html) el.innerHTML = html;
    document.body.appendChild(el);
  };
  wrap("fx-scan");
  wrap("fx-frame", "<i></i><i></i><i></i><i></i>");
  wrap("fx-beam");
}

/* ---- boot ----------------------------------------------------------------------- */

if (ctx) {
  readPalette();
  size();
  document.body.classList.add("fx-active");
  chrome();

  if (MOVE) {
    frame(0, 16);        // paint one frame immediately so the sky is never blank
    if (view) {
      const mo = new MutationObserver(queueScan);
      mo.observe(view, { childList: true, subtree: true });
    }
    scan();
    hud();
    raf = requestAnimationFrame(loop);
  } else {
    document.body.classList.add("fx-reduced");
    frame(0, 16);        // a single static frame is all reduced-motion users get
  }
}