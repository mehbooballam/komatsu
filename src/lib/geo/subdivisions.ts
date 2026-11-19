import { resolveJurisdiction } from "./countries";

/**
 * State / province jurisdictions, e.g. "United States - Pennsylvania (State)",
 * "Canada - Quebec (Provincial)", "Australia - New South Wales (State)".
 *
 * As in the regulation risk scorer: a national rule applies to every state of its country,
 * while a state rule applies to that state only — so on the map it paints the state, not the country.
 */

/** Countries whose states/provinces are drawn on the map. */
export const SUBDIVIDED = new Set(["US", "CA", "AU"]);

const SUB_RE = /^(.+?)\s+[-–—]\s+(.+?)\s*\((state|provincial|province|territorial|territory)\)\s*$/i;

export function parseSubdivision(raw: string | null | undefined): { country: string; name: string } | null {
  const m = (raw ?? "").trim().match(SUB_RE);
  if (!m) return null;
  const country = resolveJurisdiction(m[1])[0];
  if (!country) return null;
  return { country, name: m[2].trim() };
}

/** "United States (National)" → "United States"; other labels unchanged. */
export function jurisdictionLabel(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "No jurisdiction";
  return s.replace(/\s*\(national\)\s*$/i, "").trim();
}
