// SimilarityService.js — duplicate detection, used twice for opposite reasons.
//
// Facing the reporter: "three people already reported this — back that one
// instead of filing a fourth." Twenty separate reports about the same broken
// water pump look like noise; one report with twenty backers is a priority.
//
// Facing the desk: a merge suggestion on the report detail.
//
// No external library. A normalised token set plus a title bigram score is
// enough at the size a college feed ever reaches, and it is explainable — the UI
// can show *which* words matched.

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "at", "for", "with", "by", "from", "as", "it", "its", "this", "that",
  "these", "those", "there", "here", "we", "our", "us", "i", "my", "me", "you", "your", "they",
  "them", "their", "he", "she", "his", "her", "not", "no", "do", "does", "did", "have", "has",
  "had", "will", "would", "can", "could", "should", "very", "really", "so", "also", "please",
  "any", "all", "some", "who", "what", "when", "where", "which", "how", "than", "then", "if",
  "about", "into", "over", "after", "before", "again", "sir", "madam", "kindly", "request",
]);

export class SimilarityService {
  /** @returns {Set<string>} content words, stemmed just enough to match plurals. */
  tokens(text) {
    return new Set(
      String(text || "").toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 2 && !STOPWORDS.has(word))
        .map((word) => (word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word)),
    );
  }

  #bigrams(text) {
    const clean = String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const out = new Set();
    for (let i = 0; i < clean.length - 1; i += 1) out.add(clean.slice(i, i + 2));
    return out;
  }

  #overlap(a, b) {
    if (a.size === 0 || b.size === 0) return { score: 0, shared: [] };
    const shared = [...a].filter((token) => b.has(token));
    // Dice coefficient: kinder than Jaccard when one text is much longer.
    return { score: (2 * shared.length) / (a.size + b.size), shared };
  }

  /**
   * @param {{title:string, body:string}} draft
   * @param {Array} candidates existing reports
   * @returns {Array<{report:object, score:number, shared:string[]}>}
   */
  rank(draft, candidates, { min = 0.28, limit = 5, sameCategory = null } = {}) {
    const draftTokens = this.tokens(`${draft.title} ${draft.body}`);
    const draftTitle = this.#bigrams(draft.title);

    return candidates
      .filter((report) => report.traceCode !== draft.traceCode && !report.mergedInto)
      .map((report) => {
        const body = this.#overlap(draftTokens, this.tokens(`${report.title} ${report.body}`));
        const title = this.#overlap(draftTitle, this.#bigrams(report.title));
        let score = body.score * 0.72 + title.score * 0.28;
        if (sameCategory && report.categoryId === sameCategory) score += 0.06;
        return { report, score: Math.min(1, score), shared: body.shared.slice(0, 6) };
      })
      .filter((row) => row.score >= min)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Reporter-facing: only reports they could actually back. */
  suggestForReporter(draft, candidates, options = {}) {
    return this.rank(draft, candidates.filter((r) => r.isPublic), { min: 0.3, limit: 3, ...options })
      .map(({ report, score, shared }) => ({
        traceCode: report.traceCode,
        title: report.title,
        statusLabel: report.statusLabel,
        supportCount: report.supportCount,
        createdAt: report.createdAt,
        confidence: Math.round(score * 100),
        shared,
      }));
  }

  /** Desk-facing: anything on the same desk, public or not. */
  suggestMerges(report, candidates, options = {}) {
    return this.rank(report, candidates, { min: 0.34, limit: 4, sameCategory: report.categoryId, ...options })
      .map(({ report: other, score, shared }) => ({
        traceCode: other.traceCode,
        title: other.title,
        status: other.status,
        statusLabel: other.statusLabel,
        supportCount: other.supportCount,
        createdAt: other.createdAt,
        confidence: Math.round(score * 100),
        shared,
      }));
  }
}
