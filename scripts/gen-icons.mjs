// gen-icons.mjs — draws the TrustLine app icons and writes real PNGs.
// Run: node scripts/gen-icons.mjs
// The favicon is a dark rounded square with four ink bars cut by one coral
// diagonal; the launcher icons render the same mark at web sizes and, on
// Android, as legacy launcher tiles and adaptive-icon foregrounds.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BG = [5, 8, 15];        // #05080f
const BAR = [34, 211, 238];   // cyan
const SEAL = [226, 98, 79];   // coral

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The logo alone, in a unit glyph square [0,1]^2: bars + a diagonal stroke. */
function glyph(gx, gy) {
  const bw = 0.123, gap = 0.169, x0 = 0.03, top = 0.18, base = 0.82;
  let on = false;
  for (let i = 0; i < 4; i++) {
    const cx = x0 + i * (bw + gap);
    if (gx >= cx && gx <= cx + bw && gy >= top && gy <= base) on = true;
  }
  if (!on) return 0;
  const ax = 0.33, ay = 0.95, bx = 0.67, by = 0.05, w = 0.09;
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  const t = ((gx - ax) * dx + (gy - ay) * dy) / (len * len);
  const px = ax + t * dx, py = ay + t * dy;
  const d = Math.hypot(gx - px, gy - py);
  return d <= w ? 2 : 1;
}

/** Full tile: dark rounded square with the glyph. Coverage at normalized x,y in [0,1]^2. */
function mark(x, y) {
  let inside = true;
  const r = 0.16;
  if (x < r && y < r) inside = (x - r) ** 2 + (y - r) ** 2 <= r * r;
  else if (x > 1 - r && y < r) inside = (x - (1 - r)) ** 2 + (y - r) ** 2 <= r * r;
  else if (x < r && y > 1 - r) inside = (x - r) ** 2 + (y - (1 - r)) ** 2 <= r * r;
  else if (x > 1 - r && y > 1 - r) inside = (x - (1 - r)) ** 2 + (y - (1 - r)) ** 2 <= r * r;
  else if (x < r || x > 1 - r || y < r || y > 1 - r) inside = false;
  if (!inside) return 0;
  // Tile space maps the glyph unit square into the bars' original window.
  const gx = (x - 0.187) / 0.75, gy = (y - 0.27) / 0.46;
  return glyph(gx, gy);
}

/** Adaptive foreground: the glyph only, centered in a 66%-safe canvas, transparent around it. */
function glyphCover(x, y) {
  const side = 0.6, aspect = 0.374 / 0.46; // glyph width/height ratio in tile space
  const gx = 0.5 + (x - 0.5) / side;
  const gy = 0.5 + (y - 0.5) / (side * aspect);
  return glyph(gx, gy);
}

/** Render an image; draw returns coverage 0..1 given normalized pixel coords, and for a
 *  foreground image zero coverage means transparent. */
function render(size, draw, color) {
  const ss = 3;
  const big = size * ss;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0], hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          const g = draw(u, v);
          if (g > 0) {
            hits++;
            const col = g === 2 ? SEAL : color;
            acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2];
          }
        }
      }
      const i = (y * size + x) * 4;
      if (hits === 0) { out[i + 3] = 0; continue; }
      const n = ss * ss;
      out[i] = Math.round(acc[0] / n);
      out[i + 1] = Math.round(acc[1] / n);
      out[i + 2] = Math.round(acc[2] / n);
      out[i + 3] = Math.round((hits / n) * 255);
    }
  }
  return out;
}

const root = dirname(fileURLToPath(import.meta.url));
const pub = join(root, "..", "public", "icons");
const mip = join(root, "..", "android", "app", "src", "main", "res");
mkdirSync(pub, { recursive: true });

// Web / PWA icons: full tile.
for (const size of [512, 192, 180]) {
  const name = size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`;
  writeFileSync(join(pub, name), png(size, size, render(size, mark, BAR)));
  process.stdout.write(`${name}  ${size}x${size}\n`);
}

// Android legacy launcher tiles (mipmap-{mdpi..xxxhdpi}) and adaptive foregrounds.
const densities = [
  ["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192],
];
for (const [density, size] of densities) {
  const dir = join(mip, `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ic_launcher.png"), png(size, size, render(size, mark, BAR)));
  writeFileSync(join(dir, "ic_launcher_round.png"), png(size, size, render(size, mark, BAR)));
  writeFileSync(join(dir, "ic_launcher_foreground.png"), png(size, size, render(size, glyphCover, BAR)));
  process.stdout.write(`mipmap-${density} launcher + round + foreground (${size})\n`);
}

/** Splash canvas: the dark background everywhere, the glyph centered on it. */
function renderRect(width, height) {
  const ss = 3;
  const out = Buffer.alloc(width * height * 4);
  const side = Math.round(0.3 * Math.min(width, height));
  const ox = (width - side) / 2, oy = (height - side) / 2;
  const bg = [BG[0], BG[1], BG[2], 255];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[i] = bg[0]; out[i + 1] = bg[1]; out[i + 2] = bg[2]; out[i + 3] = 255;
      let acc = [0, 0, 0], hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const gx = (x + (sx + 0.5) / ss - ox) / side;
          const gy = (y + (sy + 0.5) / ss - oy) / side;
          if (gx < 0 || gx > 1 || gy < 0 || gy > 1) continue;
          const g = glyph(gx, gy);
          if (g > 0) {
            hits++;
            const col = g === 2 ? SEAL : BAR;
            acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2];
          }
        }
      }
      if (hits > 0) {
        const n = ss * ss;
        out[i] = Math.round(acc[0] / n + (bg[0] * (n - hits)) / n);
        out[i + 1] = Math.round(acc[1] / n + (bg[1] * (n - hits)) / n);
        out[i + 2] = Math.round(acc[2] / n + (bg[2] * (n - hits)) / n);
      }
    }
  }
  return out;
}

const splashDims = [
  ["drawable-land-mdpi", 480, 320], ["drawable-land-hdpi", 800, 480],
  ["drawable-land-xhdpi", 1280, 720], ["drawable-land-xxhdpi", 1600, 960],
  ["drawable-land-xxxhdpi", 1920, 1280], ["drawable-port-mdpi", 320, 480],
  ["drawable-port-hdpi", 480, 800], ["drawable-port-xhdpi", 720, 1280],
  ["drawable-port-xxhdpi", 960, 1600], ["drawable-port-xxxhdpi", 1280, 1920],
];
for (const [dirName, w, h] of splashDims) {
  const dir = join(mip, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "splash.png"), png(w, h, renderRect(w, h)));
  process.stdout.write(`${dirName}/splash.png ${w}x${h}\n`);
}