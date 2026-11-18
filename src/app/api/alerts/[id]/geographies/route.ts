import { NextResponse } from "next/server";
import { ALERT_UUID, alertNotFound, canAccessAlert } from "@/lib/alerts/access";
import { alertCountries, alertCountryCodes, saveManualAlertCountries } from "@/lib/alerts/geography-mapping";
import { canEdit, forbidden, getAuth, unauthorized } from "@/lib/auth-helpers";
import { query, transaction } from "@/lib/db";

function parseCountryCodes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 250 ||
      !value.every((code): code is string => typeof code === "string" && (/^[a-z]{2}$/i.test(code) || /^CONT-[A-Z]{2}$/i.test(code)))) {
    return null;
  }
  return [...new Set(value.map((code) => code.toUpperCase()))].sort();
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();
  const { id } = await params;
  if (!(await canAccessAlert(auth, id))) return alertNotFound();

  const [countries, mappings] = await Promise.all([
    // Continents first (stored as level 'region'), then countries
    query(`SELECT code, display_name, level FROM geographies WHERE level IN ('country', 'region') ORDER BY (level = 'region') DESC, display_name, code`),
    alertCountries(auth.company_id, id),
  ]);
  return NextResponse.json({ countries: countries.rows, ...alertCountryCodes(mappings) });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();
  const { id } = await params;
  if (!ALERT_UUID.test(id)) return alertNotFound();

  const body: { country_codes?: unknown; expected_country_codes?: unknown } | null = await request.json().catch(() => null);
  const countryCodes = parseCountryCodes(body?.country_codes);
  const expectedCodes = body?.expected_country_codes === undefined ? undefined : parseCountryCodes(body.expected_country_codes);
  if (!countryCodes || expectedCodes === null) {
    return NextResponse.json({ error: "Expected lists of country or continent codes." }, { status: 400 });
  }

  const result = await transaction((client) => saveManualAlertCountries(client, auth, id, countryCodes, expectedCodes));
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
