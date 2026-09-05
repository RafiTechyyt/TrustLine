// ModerationService.js — the self-doxx scanner.
//
// The one way anonymity usually breaks is the reporter breaking it themselves:
// typing their own roll number, phone or full name into the description because
// that is how they would write a normal complaint. So every draft is scanned
// before it is filed and the findings are handed back to the reporter as advice.
//
// It advises, it does not censor. Only two things are hard blocks (an Aadhaar
// number and a bank card), because those cause harm far beyond this system.

// A pattern may carry an `accept` hook: the regex casts a wide net and the hook
// decides. Cheaper than one unreadable regex, and each rule stays explainable.

const NOT_A_NAME = new Set([
  "Sorry", "Very", "Not", "Just", "Still", "Also", "Really", "Being", "Writing",
  "Reporting", "From", "Studying", "Currently", "Afraid", "Unable", "Trying",
  "Sure", "Fine", "Here", "There", "The", "This", "That", "But", "And", "Now",
]);

function digitsOnly(raw) { return raw.replace(/\D/g, ""); }

const PATTERNS = [
  {
    kind: "aadhaar", severity: "block", label: "an Aadhaar-style 12-digit number",
    advice: "Never put an Aadhaar number in a complaint. Remove it before filing.",
    re: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g,
    accept: (raw) => digitsOnly(raw).length === 12,
  },
  {
    kind: "card", severity: "block", label: "something shaped like a card number",
    advice: "Remove card or account numbers — no complaint needs them.",
    re: /\b(?:\d[ -]?){14,18}\d\b/g,
    accept: (raw) => digitsOnly(raw).length >= 15,
  },
  {
    kind: "phone", severity: "high", label: "a phone number",
    advice: "A phone number identifies you. Use the contact step below if you want the desk to reach you.",
    re: /(?:\+?\s?91[\s-]?)?\b(?:\d[\s-]?){9}\d\b/g,
    accept: (raw) => {
      const digits = digitsOnly(raw);
      if (digits.length < 10 || digits.length > 12) return false;
      const local = digits.slice(-10);
      return /^[6-9]/.test(local);
    },
  },
  {
    kind: "email", severity: "high", label: "an email address",
    advice: "An email address identifies you. Share it in the contact step instead, where only the handling desk sees it.",
    re: /\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi,
  },
  {
    kind: "register", severity: "high", label: "what looks like a register or admission number",
    advice: "Register numbers point straight back to one student. Describe the situation without it.",
    re: /\b[A-Z]{2,4}\d{2}[A-Z]{2,4}\d{2,4}\b/g,
  },
  {
    kind: "self_named", severity: "medium", label: "your own name",
    advice: "You have introduced yourself in the text. The desk does not need your name to act.",
    re: /\b(?:[Mm]y name is|[Ii] am|[Tt]his is|[Mm]yself is|[Ii]'?m)\s+(?:(?:[MmSs][rs]s?)\.?\s*)?([A-Z][a-z]{2,})(?:\s+[A-Z][a-z]+)?/g,
    accept: (_raw, match) => !NOT_A_NAME.has(match[1]),
  },
  {
    kind: "room", severity: "low", label: "a hostel room or seat number",
    advice: "A room number narrows things down to a few people. Keep it only if the desk needs it to act.",
    re: /\b(?:room|rm|bed|seat)\s*(?:no\.?|number|#)?\s*[A-Z]?-?\d{1,4}[A-Z]?\b/gi,
  },
  {
    kind: "handle", severity: "low", label: "a social media handle",
    advice: "A handle is usually enough to find someone. Consider removing it.",
    re: /(?<![\w/])@[a-z0-9_.]{3,30}\b/gi,
  },
];

const ABUSE = /\b(bastard|bitch|motherf\w*|f\*{2,}k|fuck\w*|randi|kutta|naaye|myru|pooru)\b/gi;
const SEVERITY_RANK = { low: 1, medium: 2, high: 3, block: 4 };

export class ModerationService {
  /**
   * @returns {{findings:Array, severity:string|null, blocked:boolean, abusive:boolean}}
   */
  scan(...texts) {
    const text = texts.filter(Boolean).join("\n");
    const findings = [];

    for (const pattern of PATTERNS) {
      const seen = new Set();
      for (const match of text.matchAll(pattern.re)) {
        const value = match[0].trim();
        if (pattern.accept && !pattern.accept(value, match)) continue;
        if (seen.has(value.toLowerCase())) continue;
        seen.add(value.toLowerCase());
        findings.push({
          kind: pattern.kind, severity: pattern.severity, label: pattern.label,
          advice: pattern.advice, sample: this.#mask(value), at: match.index ?? 0,
        });
        if (seen.size >= 3) break;
      }
    }

    findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.at - b.at);
    const severity = findings[0]?.severity ?? null;
    return {
      findings,
      severity,
      blocked: severity === "block",
      abusive: new RegExp(ABUSE.source, "i").test(text),
    };
  }

  /** Never show the whole thing back — that would echo the leak into a log or a UI. */
  #mask(value) {
    if (value.length <= 4) return "•".repeat(value.length);
    return `${value.slice(0, 2)}${"•".repeat(Math.min(8, value.length - 4))}${value.slice(-2)}`;
  }

  /** Advisory quality nudges shown live in the report wizard. */
  quality(title, body) {
    const nudges = [];
    const words = String(body || "").trim().split(/\s+/).filter(Boolean);
    if (String(title || "").trim().length < 12) nudges.push("Give the report a clearer one-line summary.");
    if (words.length < 20) nudges.push("Add a little more detail — what happened, where, and when.");
    if (!/\b(today|yesterday|morning|evening|night|last week|since|on \d|\d{1,2}(st|nd|rd|th)?|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(body || "")) {
      nudges.push("Mentioning when this happened helps the desk act faster.");
    }
    if (/^(.)\1{9,}$/.test(String(body || "").replace(/\s/g, ""))) nudges.push("This does not look like a description yet.");
    const shouting = (String(title || "").match(/[A-Z]/g) || []).length;
    if (shouting > 8 && shouting / Math.max(1, title.length) > 0.7) nudges.push("Turn off caps lock — it does not raise the priority.");
    return { nudges, wordCount: words.length };
  }
}
