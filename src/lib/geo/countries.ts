import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";

countries.registerLocale(en);

export interface CountryRecord {
  code: string; // ISO 3166-1 alpha-2
  iso_code: string; // ISO 3166-1 alpha-2
  display_name: string;
}

/** Every ISO 3166-1 country, for seeding the `geographies` table. */
export function allCountries(): CountryRecord[] {
  const names = countries.getNames("en", { select: "official" });
  return Object.entries(names)
    .map(([alpha2, name]) => ({ code: alpha2, iso_code: alpha2, display_name: name }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/** world-atlas TopoJSON ids are ISO 3166-1 numeric codes ("840"); map them to alpha-2 ("US"). */
export function numericToAlpha2(numeric: string | number | undefined): string | undefined {
  if (numeric === undefined || numeric === null || numeric === "") return undefined;
  return countries.numericToAlpha2(String(numeric).padStart(3, "0"));
}

// Common jurisdiction spellings that the ISO name table doesn't resolve.
const ALIASES: Record<string, string> = {
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  "united states of america": "US",
  us: "US",
  uk: "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  "south korea": "KR",
  korea: "KR",
  "republic of korea": "KR",
  "north korea": "KP",
  russia: "RU",
  vietnam: "VN",
  "viet nam": "VN",
  taiwan: "TW",
  iran: "IR",
  syria: "SY",
  laos: "LA",
  bolivia: "BO",
  venezuela: "VE",
  tanzania: "TZ",
  moldova: "MD",
  "czech republic": "CZ",
  czechia: "CZ",
  turkey: "TR",
  turkiye: "TR",
  "türkiye": "TR",
  uae: "AE",
  "the netherlands": "NL",
  holland: "NL",
  "hong kong": "HK",
  macau: "MO",
  "ivory coast": "CI",
  "cote d'ivoire": "CI",
  "democratic republic of the congo": "CD",
  drc: "CD",
  "republic of the congo": "CG",
  brunei: "BN",
  "cape verde": "CV",
  eswatini: "SZ",
  swaziland: "SZ",
  "north macedonia": "MK",
  macedonia: "MK",
  palestine: "PS",
  "vatican city": "VA",
  micronesia: "FM",
};

/**
 * Resolve a free-text jurisdiction (e.g. "United States", "USA; Canada",
 * "Japan / Korea") to the ISO alpha-2 codes it names. Unknown parts
 * (agencies, regions like "EU") are ignored.
 */
export function resolveJurisdiction(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const found = new Set<string>();
  const parts = raw
    .split(/[;,|/\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const rawPart of parts) {
    // "United States (National)" → "United States";
    // "United States - California (State)" → "United States"
    const part = rawPart
      .replace(/\([^)]*\)/g, "")
      .split(/\s+[-–—]\s+/)[0]
      .trim();
    if (!part) continue;
    const key = part.toLowerCase().replace(/\s+/g, " ");
    const alias = ALIASES[key];
    if (alias) {
      found.add(alias);
      continue;
    }
    if (/^[a-z]{2}$/i.test(part) && countries.isValid(part.toUpperCase())) {
      found.add(part.toUpperCase());
      continue;
    }
    if (/^[a-z]{3}$/i.test(part)) {
      const a2 = countries.alpha3ToAlpha2(part.toUpperCase());
      if (a2) {
        found.add(a2);
        continue;
      }
    }
    const byName = countries.getAlpha2Code(part, "en");
    if (byName) found.add(byName);
  }
  return [...found];
}
