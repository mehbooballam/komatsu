import { COLUMN_DEFS, IMPORT_COLUMNS, parseHumanReview, type ImportColumnName } from "./constants";
import { normalizeConfidence } from "@/lib/scoring/confidence";
import { parseDate } from "./validator";

/**
 * Alert uniqueness by content: compares alerts column by column and gives a match percentage.
 * Pure functions (no database), so the same rules run in the preview and when the import is confirmed.
 *
 * Every column takes part except the alert ID. A column counts when both sides know it (both files
 * had it) and at least one of them has a value: equal values score 100%, a value on one side only 0%.
 * Descriptive columns weigh more than ratings, because unrelated alerts often share the same rating,
 * confidence or status.
 */

/**
 * Rows at or above this match another alert and need a decision before they are imported (adjustable
 * per import). Calibrated on 109 real alerts: unrelated ones score under 40%, separate notices with
 * the same title 49–65%, and the one reworded copy of the same page 70%.
 */
export const MATCH_THRESHOLD = 70;
/** Matches listed per row. */
export const MAX_MATCHES = 5;
/** Existing alerts compared in full per row (picked by shared words, title or link). */
const SHORTLIST = 25;

export type Content = Partial<Record<ImportColumnName, string | null>>;

export interface ColumnMatch {
  column: ImportColumnName;
  label: string;
  /** 0–100 */
  score: number;
  incoming: string | null;
  existing: string | null;
}

export interface ContentMatch {
  /** 0–100, rounded down: 100 only when every compared column is the same */
  score: number;
  compared: number;
  identical: number;
  columns: ColumnMatch[];
}

const WEIGHTS: Partial<Record<ImportColumnName, number>> = {
  title: 10,
  overview: 8,
  summary: 8,
  link: 8,
  jurisdiction: 4,
  agency_name: 4,
  published_on: 4,
  status_summary: 4,
  status_details: 4,
  timing_summary: 4,
  timing_details: 4,
  change_summary: 4,
  change_details: 4,
  source_context_summary: 4,
  source_context_details: 4,
  topic_match: 3,
  product: 3,
  key_dates: 3,
  compliance_deadline: 3,
  status: 2,
  timing: 2,
  change_type: 2,
  source: 2,
  source_context: 2,
  date_relevance: 2,
  deadline_description: 2,
  relevance: 2,
  market_access_risk_rationale: 2,
  cost_to_implement_rationale: 2,
  human_resources_rationale: 2,
  urgency_rationale: 2,
};
const weightOf = (c: ImportColumnName) => WEIGHTS[c] ?? 1;

const COMPARED = IMPORT_COLUMNS.filter((c) => c !== "alert_id");
const LABELS = new Map(COLUMN_DEFS.map((d) => [d.name, d.label]));
const TYPES = new Map(COLUMN_DEFS.map((d) => [d.name, d.type]));

/* ---------- Normalising ---------- */

const text = (v: string) => v.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const splitWords = (v: string) => text(v).split(" ").filter(Boolean);
// The same values are compared many times in one run
const wordCache = new Map<string, string[]>();
function words(v: string): string[] {
  let w = wordCache.get(v);
  if (!w) {
    if (wordCache.size > 20000) wordCache.clear();
    wordCache.set(v, (w = splitWords(v)));
  }
  return w;
}

function normalizeUrl(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/#.*$/, "")
    .replace(/([?&])(utm_[^=&]*|fbclid|gclid)=[^&]*/g, "$1")
    .replace(/[?&]+$/, "")
    .replace(/\/+$/, "");
}

/** Dice coefficient of two lists, counting repeats. */
function dice(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const counts = new Map<string, number>();
  for (const w of a) counts.set(w, (counts.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of b) {
    const n = counts.get(w) ?? 0;
    if (n > 0) {
      common++;
      counts.set(w, n - 1);
    }
  }
  return (2 * common) / (a.length + b.length);
}

const pairs = (w: string[]) => w.slice(1).map((x, i) => `${w[i]} ${x}`);

function textSimilarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.length || !wb.length) return a.trim() === b.trim() ? 1 : 0;
  if (wa.join(" ") === wb.join(" ")) return 1;
  // Shared words and shared word pairs, so the same words in another order is not "identical"
  const single = dice(wa, wb);
  if (wa.length < 2 || wb.length < 2) return single * 0.99;
  return Math.min(0.99, (single + dice(pairs(wa), pairs(wb))) / 2);
}

function listSimilarity(a: string, b: string, sep: RegExp): number {
  const set = (v: string) => [...new Set(v.split(sep).map(text).filter(Boolean))];
  return dice(set(a), set(b));
}

/** Similarity of two filled values of one column, 0–1. */
function valueSimilarity(col: ImportColumnName, a: string, b: string): number {
  if (a === b) return 1;
  if (col === "link") return normalizeUrl(a) === normalizeUrl(b) ? 1 : 0;
  if (col === "needs_human_review") {
    const ra = parseHumanReview(a);
    const rb = parseHumanReview(b);
    if (!!ra?.flag !== !!rb?.flag) return 0;
    return ra?.reason && rb?.reason ? textSimilarity(ra.reason, rb.reason) : 1;
  }
  if (col.endsWith("_confidence")) return (normalizeConfidence(a) ?? text(a)) === (normalizeConfidence(b) ?? text(b)) ? 1 : 0;
  switch (TYPES.get(col)) {
    case "integer":
      return Number(a) === Number(b) ? 1 : 0;
    case "date":
      return parseDate(a).date === parseDate(b).date ? 1 : 0;
    case "multi_pipe":
      return listSimilarity(a, b, /\|/);
    case "multi_semicolon":
      return listSimilarity(a, b, /;/);
    default:
      return textSimilarity(a, b);
  }
}

const filled = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);

/* ---------- Comparing ---------- */

/** Compares two alerts on every column both sides know. */
export function compareContent(incoming: Content, existing: Content): ContentMatch {
  const columns: ColumnMatch[] = [];
  let total = 0;
  let weight = 0;
  let identical = 0;
  for (const col of COMPARED) {
    if (!(col in incoming) || !(col in existing)) continue;
    const a = filled(incoming[col]);
    const b = filled(existing[col]);
    if (!a && !b) continue;
    const sim = a && b ? valueSimilarity(col, a, b) : 0;
    const w = weightOf(col);
    total += sim * w;
    weight += w;
    if (sim === 1) identical++;
    columns.push({ column: col, label: LABELS.get(col) ?? col, score: sim === 1 ? 100 : Math.floor(sim * 100), incoming: a, existing: b });
  }
  const score = weight === 0 ? 0 : identical === columns.length ? 100 : Math.min(99, Math.floor((100 * total) / weight));
  return { score, compared: columns.length, identical, columns };
}

/* ---------- Finding candidates ---------- */

export interface Candidate {
  key: string;
  content: Content;
}

/**
 * Index for finding which alerts are worth comparing in full. Alerts sharing a title or link are
 * always compared; the rest are ranked by the (rare) words they share.
 */
export class ContentIndex {
  private docs: Candidate[] = [];
  private byWord = new Map<string, number[]>();
  private byTitle = new Map<string, number[]>();
  private byLink = new Map<string, number[]>();

  private static wordsOf(c: Content): Set<string> {
    return new Set(
      [c.title, c.overview, c.summary, c.change_summary, c.agency_name]
        .flatMap((v) => (v ? words(v) : []))
        .filter((w) => w.length >= 3)
    );
  }

  add(candidate: Candidate) {
    const i = this.docs.push(candidate) - 1;
    const push = (m: Map<string, number[]>, k: string) => (m.get(k)?.push(i) ?? m.set(k, [i]));
    for (const w of ContentIndex.wordsOf(candidate.content)) push(this.byWord, w);
    const title = candidate.content.title && text(candidate.content.title);
    if (title) push(this.byTitle, title);
    const link = candidate.content.link && normalizeUrl(candidate.content.link);
    if (link) push(this.byLink, link);
  }

  /** Alerts matching at or above the threshold, best first. */
  find(content: Content, threshold = MATCH_THRESHOLD): Array<{ key: string; match: ContentMatch }> {
    if (!this.docs.length) return [];
    const rank = new Map<number, number>();
    for (const w of ContentIndex.wordsOf(content)) {
      const list = this.byWord.get(w);
      if (!list) continue;
      const idf = Math.log(1 + this.docs.length / list.length);
      for (const i of list) rank.set(i, (rank.get(i) ?? 0) + idf);
    }
    const short = new Set([...rank.entries()].sort((a, b) => b[1] - a[1]).slice(0, SHORTLIST).map(([i]) => i));
    const title = content.title && text(content.title);
    const link = content.link && normalizeUrl(content.link);
    for (const i of (title && this.byTitle.get(title)) || []) short.add(i);
    for (const i of (link && this.byLink.get(link)) || []) short.add(i);

    return [...short]
      .map((i) => ({ key: this.docs[i].key, match: compareContent(content, this.docs[i].content) }))
      .filter((m) => m.match.score >= threshold)
      .sort((a, b) => b.match.score - a.match.score);
  }
}
