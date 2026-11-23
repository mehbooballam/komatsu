import { resolveJurisdiction } from "@/lib/geo/countries";
import { IDENTIFIER_LABELS, VERSION_LABELS, type IdentifierKind, type VersionType } from "./labels";

export { IDENTIFIER_LABELS, VERSION_LABELS, type IdentifierKind, type VersionType };

/**
 * Public identifiers that tie the versions of one regulatory action together.
 *  rin      — US Regulation Identifier Number (2070-AK67): same RIN = same action
 *  docket   — regulations.gov docket (EPA-HQ-OPPT-2025-0100): same docket = same proceeding
 *  bill     — legislative bill number (SB 1215, HF 2310), scoped to its jurisdiction
 *  tracking — state agency tracking number (CA OAL Z-2023-0912-01, WA WSR 23-14-008)
 *  wto      — WTO TBT notification (G/TBT/N/USA/2289); addenda and revisions share it
 *  cfr      — CFR part (40 CFR 751): same part usually = same family
 */

export interface Identifier {
  kind: IdentifierKind;
  value: string;
}


/** Identifiers that mean "same regulatory action" (Step 1, exact match). */
export const ACTION_IDENTIFIERS: IdentifierKind[] = ["rin", "docket", "bill", "tracking", "wto"];

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

/**
 * "United States - California (State)" → "US-CA", "United States (National)" → "US",
 * "European Union" → "EU". News aggregators ("ChemLinked", "EPing") are not jurisdictions → null.
 */
export function jurisdictionCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (/european union|\beu\b/i.test(text)) return "EU";
  const sub = text.match(/^(.+?)\s+[-–—]\s+(.+?)(?:\s*\(.*\))?$/);
  const countries = resolveJurisdiction(text);
  if (countries.length !== 1) return null;
  const country = countries[0];
  if (country === "US" && sub) {
    const state = US_STATES[sub[2].trim().toLowerCase()];
    if (state) return `US-${state}`;
  }
  return country;
}

const AGENCY_CODES: Array<[RegExp, string]> = [
  [/environmental protection agency|\bu\.?s\.? epa\b|^epa$/i, "EPA"],
  [/california air resources board|\bcarb\b/i, "CARB"],
  [/department of toxic substances control|\bdtsc\b/i, "DTSC"],
  [/washington (state )?department of ecology/i, "ECOLOGY"],
  [/minnesota pollution control agency|\bmpca\b/i, "MPCA"],
  [/food and drug administration|\bfda\b/i, "FDA"],
  [/consumer product safety commission|\bcpsc\b/i, "CPSC"],
  [/occupational safety and health administration|\bosha\b/i, "OSHA"],
  [/department of transportation|\bdot\b|phmsa/i, "DOT"],
  [/european chemicals agency|\becha\b/i, "ECHA"],
  [/european commission/i, "EC"],
  [/office of environmental health hazard assessment|\boehha\b/i, "OEHHA"],
  [/department of commerce|bureau of industry and security|\bbis\b/i, "DOC"],
  [/department of energy|\bdoe\b/i, "DOE"],
  [/foreign assets control|\bofac\b/i, "OFAC"],
  [/trade representative|\bustr\b/i, "USTR"],
  [/customs and border|\bcbp\b/i, "CBP"],
];

const SMALL_WORDS = new Set(["of", "the", "and", "for", "on", "in", "de", "la", "le", "des", "du", "y", "et", "&"]);

/** A short, stable code for the issuing authority: known acronyms, else the initials of its English name. */
export function agencyCode(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  // Many feeds write "Local name(English name)": prefer the English part
  const english = name.match(/\(([^)]+)\)\s*$/)?.[1] ?? name;
  for (const [re, code] of AGENCY_CODES) if (re.test(english) || re.test(name)) return code;
  const words = english.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w && !SMALL_WORDS.has(w.toLowerCase()));
  if (words.length === 0) return null;
  if (words.length === 1) return words[0].toUpperCase().slice(0, 12);
  return words.map((w) => w[0].toUpperCase()).join("").slice(0, 10);
}

/** Pulls the public identifiers out of an alert's title, text and source link. */
export function extractIdentifiers(text: string, jurisdiction: string | null, agency: string | null = null): Identifier[] {
  const out = new Map<string, Identifier>();
  const add = (kind: IdentifierKind, value: string) => out.set(`${kind}:${value}`, { kind, value });

  // EPA significant-new-use rule numbers in titles, e.g. "(25-3.5e)", "(23-1.M)"
  if (agency === "EPA") {
    const title = text.split("\n")[0];
    for (const m of title.matchAll(/\((\d{2}-\d{1,2}(?:\.[0-9A-Za-z]{1,3})?)\)/g)) add("tracking", `EPA ${m[1]}`);
  }

  for (const m of text.matchAll(/\bRIN[:\s#]*(\d{4}-[A-Z]{2}\d{2})\b/gi)) add("rin", m[1].toUpperCase());
  for (const m of text.matchAll(/\b(\d{4}-A[A-Z]\d{2})\b/g)) add("rin", m[1]);

  // Agency-…-YYYY-NNNN (EPA-HQ-OPPT-2025-0100, FDA-2023-N-1234, EPA-R09-OAR-2024-0012)
  for (const m of text.matchAll(/\b([A-Z]{2,6}(?:-[A-Z0-9]{1,6}){0,3}-(?:19|20)\d{2}-(?:[A-Z]-)?\d{3,5})\b/g)) {
    if (!/^(?:WSR|Z)-/.test(m[1])) add("docket", m[1]);
  }

  for (const m of text.matchAll(/\b(\d{1,2})\s*C\.?F\.?R\.?\s*(?:Parts?|pt\.?|§+)?\s*(\d{1,4})/gi)) add("cfr", `${m[1]} CFR ${m[2]}`);

  for (const m of text.matchAll(/\bG\/TBT\/N\/([A-Z]{3})\/(\d+)/g)) add("wto", `G/TBT/N/${m[1]}/${m[2]}`);

  for (const m of text.matchAll(/\bWSR\s*(\d{2}-\d{2}-\d{3})\b/gi)) add("tracking", `WSR ${m[1]}`);
  for (const m of text.matchAll(/\b(Z-?\d{4}-\d{4}-\d{2})\b/g)) add("tracking", m[1].replace(/^Z(?!-)/, "Z-"));

  // Bill numbers only mean something inside a jurisdiction (SB 1215 in California ≠ SB 1215 in Texas)
  if (jurisdiction) {
    // A space or period is required before the number, so formulas like SF6 or HF don't read as bills
    for (const m of text.matchAll(/\b(S\.?B|A\.?B|H\.?B|H\.?F|S\.?F|L\.?D|H\.?R|A|S)(?:\.\s?|\s)(\d{1,5})\b(?!\s*(?:CFR|%|mg|ppm))/g)) {
      const prefix = m[1].replace(/\./g, "").toUpperCase();
      if ((prefix === "A" || prefix === "S") && !/\b(?:Assembly|Senate)\s+Bill/i.test(text)) continue;
      add("bill", `${jurisdiction} ${prefix} ${Number(m[2])}`);
    }
    for (const m of text.matchAll(/\b(Senate|Assembly|House)\s+(?:File|Bill)\s+(?:No\.?\s*)?(\d{1,5})\b/gi)) {
      const p = m[1].toLowerCase() === "senate" ? "SB" : m[1].toLowerCase() === "assembly" ? "AB" : "HB";
      add("bill", `${jurisdiction} ${p} ${Number(m[2])}`);
    }
  }
  return [...out.values()];
}

/**
 * True when two alerts carry different identifiers of the same kind (e.g. two different dockets),
 * which means they are different actions however alike their titles are.
 */
export function identifiersConflict(a: Identifier[], b: Identifier[]): boolean {
  for (const kind of ACTION_IDENTIFIERS) {
    const av = a.filter((i) => i.kind === kind).map((i) => i.value);
    const bv = b.filter((i) => i.kind === kind).map((i) => i.value);
    if (av.length && bv.length && !av.some((v) => bv.includes(v))) return true;
  }
  return false;
}

/** Level 3: which kind of version of the action this alert is. */


export function versionType(title: string, stage: string | null): VersionType {
  const t = title.toLowerCase();
  const s = (stage || "").toLowerCase();
  if (/\bcorrect(ion|ing)\b|\berrat/.test(t)) return "correction";
  if (/supplemental (notice|proposal|proposed)/.test(t)) return "supplemental_proposal";
  if (/guidance|enforcement|faq|q&a|questions/.test(t)) return "enforcement_guidance";
  if (/\bamend(ment|ing|s|ed)?\b/.test(t)) return "amendment";
  if (/draft|propos|consultation/.test(s) || /\bpropos(ed|al|es)\b|draft|consultation/.test(t)) return "proposed_rule";
  if (/final/.test(s) || /final rule/.test(t)) return "final_rule";
  return "notice";
}

const STOP = new Set([
  "the", "and", "for", "with", "from", "under", "into", "onto", "that", "this", "these", "those", "are", "was", "were",
  "will", "new", "its", "their", "about", "regarding", "notice", "rule", "rules", "update", "updates", "proposed",
  "proposes", "final", "draft", "amendment", "amendments", "amending", "version", "certain", "on", "of", "to", "in",
  "a", "an", "by", "as", "at", "or", "is", "be", "has", "have",
]);

/** Subject words of a title, for the Step 3 similarity check. */
export function subjectWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
  );
}

/** Dice coefficient of two word sets, 0–1. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return (2 * common) / (a.size + b.size);
}

/** Upper-case key segment: "AIM Act" → "AIM_ACT". */
export function keySegment(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 40);
}
