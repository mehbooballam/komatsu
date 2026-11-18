/**
 * Continent for each ISO 3166-1 alpha-2 country code (UN geoscheme, with the
 * Americas split into North and South America; Russia and Türkiye in Europe).
 * Used to filter alerts by continent ("continent:EU" in the geography filter).
 */

export const CONTINENTS = [
  { code: "AF", name: "Africa" },
  { code: "AS", name: "Asia" },
  { code: "EU", name: "Europe" },
  { code: "NA", name: "North America" },
  { code: "SA", name: "South America" },
  { code: "OC", name: "Oceania" },
  { code: "AN", name: "Antarctica" },
] as const;

export type ContinentCode = (typeof CONTINENTS)[number]["code"];

const MEMBERS: Record<ContinentCode, string> = {
  AF: "DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW",
  AS: "AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KW KG LA LB MO MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TM AE UZ VN YE IO",
  EU: "AX AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG VA HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH TR UA GB",
  NA: "AI AG AW BS BB BZ BM BQ VG CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA PR BL KN LC MF PM VC SX TT TC US VI UM",
  SA: "AR BO BR CL CO EC FK GF GY PY PE SR UY VE GS BV",
  OC: "AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF CX CC HM",
  AN: "AQ TF",
};

const BY_COUNTRY = new Map<string, ContinentCode>();
for (const [continent, list] of Object.entries(MEMBERS) as Array<[ContinentCode, string]>) {
  for (const code of list.split(" ")) BY_COUNTRY.set(code, continent);
}

/** Continent of a country code, or null when unknown. */
export function continentOf(countryCode: string | null | undefined): ContinentCode | null {
  return countryCode ? BY_COUNTRY.get(countryCode.toUpperCase()) ?? null : null;
}

/** All country codes in a continent. */
export function countriesIn(continent: string): string[] {
  const list = MEMBERS[continent as ContinentCode];
  return list ? list.split(" ") : [];
}

/** Filter values for continents look like "continent:EU". */
export const CONTINENT_PREFIX = "continent:";

/**
 * Alerts can also be mapped to a whole continent. Those are stored as geographies
 * with level "region" and code "CONT-EU" (see migration 004_continents.sql).
 */
export const CONTINENT_GEO_PREFIX = "CONT-";
export const continentGeoCode = (continent: string) => `${CONTINENT_GEO_PREFIX}${continent}`;
export const isContinentGeoCode = (code: string) => /^CONT-[A-Z]{2}$/.test(code);

/** Continent of either a country code ("FR") or a continent geography code ("CONT-EU"). */
export function continentOfGeography(code: string | null | undefined): ContinentCode | null {
  if (!code) return null;
  if (isContinentGeoCode(code)) {
    const c = code.slice(CONTINENT_GEO_PREFIX.length) as ContinentCode;
    return c in MEMBERS ? c : null;
  }
  return continentOf(code);
}
