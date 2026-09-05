// ids.js — identifier generation.
//
// Trace codes are the only thing a reporter walks away with, so they are built
// from a Crockford-style alphabet: no I, L, O, U, so nobody mistypes them when
// reading a code off a phone screen or a scrap of paper.

import { randomBytes, randomInt } from "node:crypto";

const SAFE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function safeChars(count) {
  const bytes = randomBytes(count);
  let out = "";
  for (let i = 0; i < count; i += 1) out += SAFE_ALPHABET[bytes[i] % SAFE_ALPHABET.length];
  return out;
}

/** Internal primary key. Never shown to a reporter. */
export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(5).toString("hex")}`;
}

/** Reporter-facing trace code, e.g. TL-7K2M-9QX4 */
export function newTraceCode() {
  return `TL-${safeChars(4)}-${safeChars(4)}`;
}

export function normaliseTraceCode(raw) {
  const cleaned = String(raw || "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/^TL/, "");
  if (cleaned.length !== 8) return null;
  return `TL-${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

// Handles come from birds you actually see around a Kerala campus. A reporter
// is never "User #4821" — they get a name the whole thread can refer to, which
// keeps a conversation readable without ever identifying anyone.
const HANDLES = [
  "Kingfisher", "Hornbill", "Drongo", "Egret", "Koel", "Bulbul", "Myna", "Heron",
  "Cormorant", "Oriole", "Barbet", "Parakeet", "Sunbird", "Owlet", "Lapwing",
  "Sandpiper", "Robin", "Warbler", "Kite", "Swift", "Nightjar", "Treepie",
  "Flycatcher", "Woodpecker", "Bee-eater", "Stork", "Ibis", "Darter", "Plover",
  "Shrike", "Tailorbird", "Pipit", "Wagtail", "Minivet", "Iora",
];

export function newHandle() {
  return `${HANDLES[randomInt(HANDLES.length)]} ${safeChars(3)}`;
}

/** Short, human-readable code for a department or category. */
export function slugify(value, fallback = "item") {
  const slug = String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}
