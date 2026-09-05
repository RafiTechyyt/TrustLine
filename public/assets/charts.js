// charts.js — the four charts in the console, drawn by hand on a canvas.
//
// No chart library. Not to prove a point: the CSP on this server is 'self' only, so
// a CDN script would be blocked, and vendoring a charting library to draw two kinds
// of bar would cost more bytes than the rest of this console put together.
//
// The house rules, so all four look like they came from the same place as the paper:
//   · a bar is flat ink, an overdue bar is seal, nothing has a gradient
//   · axes are hairlines and there is no grid, because the numbers are on the bars
//   · nothing animates, because these redraw on a live event and a chart that
//     re-animates every thirty seconds is a chart nobody can read
//   · every chart reads its colours out of the stylesheet, so the carbon theme in
//     ops.css governs them without a second palette living in here
//
// Every function takes the wrapping element rather than a canvas and manages the
// canvas itself, which is what lets a chart redraw on resize without its caller
// knowing that happened.

const px = (v) => Math.round(v) + 0.5; // hairlines land on a pixel, not between two

/** Palette, straight from the cascade. */
function theme() {
  const style = getComputedStyle(document.body);
  const v = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    ink: v("--ink", "#1b1c1a"),
    ink2: v("--ink-2", "#5c615c"),
    ink3: v("--ink-3", "#8a8f89"),
    seal: v("--seal", "#b4372a"),
    indigo: v("--indigo", "#3d4d7a"),
    green: v("--green", "#2f6b46"),
    amber: v("--amber", "#8a6216"),
    face: v("--card", "#ffffff"),
    ui: v("--ui", "system-ui, sans-serif"),
  };
}

/**
 * Sizes the canvas to its box at device resolution and hands back a context in CSS
 * pixels. Without the DPR scale every hairline on a retina screen is a grey smudge.
 */
function surface(host) {
  let canvas = host.querySelector("canvas");
  if (!canvas) { canvas = document.createElement("canvas"); host.appendChild(canvas); }
  const w = host.clientWidth;
  const h = host.clientHeight;
  if (w < 8 || h < 8) return null; // laid out but not yet visible
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h, t: theme() };
}

/** Remembers how to redraw, so one observer can repaint everything on resize. */
const drawings = new WeakMap();
const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
  for (const entry of entries) drawings.get(entry.target)?.();
});

function paint(host, drawFn) {
  const run = () => { const s = surface(host); if (s) drawFn(s); };
  if (!drawings.has(host) && observer) observer.observe(host);
  drawings.set(host, run);
  run();
  return host;
}

/** Says so in words rather than drawing an empty axis and letting it look broken. */
function nothing(host, message) {
  host.querySelector(".chart-empty")?.remove();
  host.appendChild(Object.assign(document.createElement("div"), {
    className: "chart-empty", textContent: message,
  }));
  return host;
}

function clearEmpty(host) { host.querySelector(".chart-empty")?.remove(); }

/**
 * Grouped columns over time — filed against resolved, by day.
 *
 * `rows` is `[{ label, values: [n, …] }]` and `keys` is `[{ name, color }]`. Only
 * every nth label is written, chosen from the width, because ninety dates along a
 * 700px axis is a grey band rather than an axis.
 */
export function columns(host, { rows = [], keys = [], empty = "Nothing in this window yet." } = {}) {
  clearEmpty(host);
  if (!rows.length || !rows.some((r) => r.values.some((v) => v > 0))) return nothing(host, empty);

  return paint(host, ({ ctx, w, h, t }) => {
    const pad = { top: 14, right: 4, bottom: 22, left: 30 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const top = Math.max(1, ...rows.flatMap((r) => r.values));
    // A round ceiling so the top gridline is a number a person would have chosen.
    const ceil = top <= 4 ? top : Math.ceil(top / 5) * 5;
    const band = plotW / rows.length;
    const barW = Math.max(1.5, Math.min(14, (band - 2) / keys.length));

    ctx.font = `10px ${t.ui}`;
    ctx.fillStyle = t.ink3;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const at of [0, ceil]) {
      const y = pad.top + plotH - (at / ceil) * plotH;
      ctx.fillText(String(at), pad.left - 6, y);
      ctx.strokeStyle = at === 0 ? t.ink3 : t.face;
      if (at === 0) {
        ctx.beginPath();
        ctx.moveTo(pad.left, px(y));
        ctx.lineTo(w - pad.right, px(y));
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    rows.forEach((row, i) => {
      const groupW = barW * keys.length;
      const x0 = pad.left + i * band + (band - groupW) / 2;
      row.values.forEach((value, k) => {
        const barH = ceil > 0 ? (value / ceil) * plotH : 0;
        if (barH <= 0) return;
        ctx.fillStyle = keys[k]?.color || t.ink;
        ctx.fillRect(x0 + k * barW, pad.top + plotH - barH, Math.max(1, barW - 1), barH);
      });
    });

    // Roughly one label every 64px, and always the last day.
    const every = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor(plotW / 64))));
    ctx.textAlign = "center";
    ctx.fillStyle = t.ink3;
    rows.forEach((row, i) => {
      if (i % every !== 0 && i !== rows.length - 1) return;
      ctx.fillText(row.label, Math.min(w - 18, pad.left + i * band + band / 2), h - pad.bottom / 2);
    });
  });
}

/**
 * Horizontal bars with the name on the left and the figure on the right — for desks,
 * categories and resolution bands, where the label is words and not a date.
 *
 * `rows` is `[{ label, value, note, tone }]`. Sorting is the caller's business: a
 * chart that reorders itself is one you cannot compare against last week's.
 */
export function bars(host, { rows = [], empty = "Nothing to compare yet.", suffix = "" } = {}) {
  clearEmpty(host);
  if (!rows.length || !rows.some((r) => r.value > 0)) return nothing(host, empty);

  return paint(host, ({ ctx, w, h, t }) => {
    const top = Math.max(1, ...rows.map((r) => r.value));
    const lane = Math.min(34, h / rows.length);
    const labelW = Math.min(160, Math.max(76, w * 0.3));
    const figureW = 46;
    const trackW = Math.max(20, w - labelW - figureW - 12);
    const tone = { seal: t.seal, indigo: t.indigo, green: t.green, amber: t.amber };

    ctx.textBaseline = "middle";
    rows.forEach((row, i) => {
      const y = i * lane + lane / 2;
      const barH = Math.max(5, Math.min(13, lane - 12));

      ctx.font = `12px ${t.ui}`;
      ctx.fillStyle = t.ink;
      ctx.textAlign = "left";
      ctx.fillText(clip(ctx, row.label, labelW - 8), 0, row.note ? y - 6 : y);
      if (row.note) {
        ctx.font = `10px ${t.ui}`;
        ctx.fillStyle = t.ink3;
        ctx.fillText(clip(ctx, row.note, labelW - 8), 0, y + 7);
      }

      ctx.fillStyle = t.face;
      ctx.fillRect(labelW, y - barH / 2, trackW, barH);
      ctx.fillStyle = tone[row.tone] || t.ink;
      ctx.fillRect(labelW, y - barH / 2, Math.max(2, (row.value / top) * trackW), barH);

      ctx.font = `600 12px ${t.ui}`;
      ctx.fillStyle = t.ink2;
      ctx.textAlign = "right";
      ctx.fillText(`${row.value}${suffix}`, w, y);
    });
  });
}

/** Truncates to fit rather than letting a long desk name run under the bars. */
function clip(ctx, text, max) {
  let out = String(text ?? "");
  if (ctx.measureText(out).width <= max) return out;
  while (out.length > 1 && ctx.measureText(out + "…").width > max) out = out.slice(0, -1);
  return out + "…";
}

/**
 * The status mix, as one stacked bar rather than a pie.
 *
 * A pie asks people to compare angles; a single bar of the whole caseload asks them
 * to compare lengths, which is the comparison they can actually make.
 */
export function stack(host, { rows = [], empty = "No open reports." } = {}) {
  clearEmpty(host);
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  if (!total) return nothing(host, empty);

  return paint(host, ({ ctx, w, h, t }) => {
    const tone = { seal: t.seal, indigo: t.indigo, green: t.green, amber: t.amber, ink: t.ink2 };
    const barH = Math.min(26, h - 34);
    let x = 0;
    for (const row of rows) {
      const width = (row.value / total) * w;
      ctx.fillStyle = tone[row.tone] || t.ink;
      ctx.fillRect(x, 0, Math.max(1, width - 1), barH);
      if (width > 34) {
        ctx.font = `600 11px ${t.ui}`;
        ctx.fillStyle = t.face;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(row.value), x + width / 2, barH / 2);
      }
      x += width;
    }

    // The legend is drawn rather than marked up so it cannot wrap away from its bar.
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let lx = 0;
    const ly = barH + 18;
    for (const row of rows) {
      ctx.fillStyle = tone[row.tone] || t.ink;
      ctx.fillRect(lx, ly - 4, 8, 8);
      ctx.font = `11px ${t.ui}`;
      ctx.fillStyle = t.ink2;
      const label = `${row.label} ${row.value}`;
      ctx.fillText(label, lx + 12, ly);
      lx += 12 + ctx.measureText(label).width + 14;
      if (lx > w - 40) break;
    }
  });
}
