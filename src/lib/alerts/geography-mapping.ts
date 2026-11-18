import type { PoolClient } from "pg";
import { alertScopeSql } from "@/lib/alerts/access";
import type { AuthContext } from "@/lib/auth-helpers";
import { query } from "@/lib/db";

type AlertCountry = {
  code: string;
  display_name: string;
  state: "mapped" | "confirmed";
  source_evidence: string | null;
};

const MANUAL_COUNTRY_EVIDENCE = "manual";

function isManual(mapping: AlertCountry) {
  return mapping.state === "confirmed" && mapping.source_evidence === MANUAL_COUNTRY_EVIDENCE;
}

export function alertCountryCodes(mappings: AlertCountry[]) {
  return {
    manual_codes: mappings.filter(isManual).map((mapping) => mapping.code).sort(),
    automatic_codes: mappings.filter((mapping) => !isManual(mapping)).map((mapping) => mapping.code).sort(),
  };
}

export async function alertCountries(companyId: string, alertId: string, runQuery = query): Promise<AlertCountry[]> {
  const result = await runQuery(
    `SELECT g.code, g.display_name, ag.state, ag.source_evidence
     FROM alert_geographies ag JOIN geographies g ON g.id = ag.geography_id
     WHERE ag.company_id = $1 AND ag.alert_id = $2 AND ag.state <> 'rejected' AND g.level IN ('country', 'region')
     ORDER BY g.level DESC, g.display_name, g.code`,
    [companyId, alertId]
  );
  return result.rows;
}

export async function saveManualAlertCountries(
  client: PoolClient,
  auth: AuthContext,
  alertId: string,
  countryCodes: string[],
  expectedCodes?: string[],
) {
  const { company_id: companyId, membership_id: memberId } = auth;
  const alertParams = [companyId, alertId];
  const scope = alertScopeSql(auth, alertParams);

  // Serialize manual edits on this alert without blocking foreign-key checks from imports.
  const alert = await client.query(
    `SELECT a.id FROM alerts a
     WHERE a.company_id = $1 AND a.id = $2 AND a.archived_at IS NULL AND ${scope}
     FOR NO KEY UPDATE OF a`,
    alertParams
  );
  if (!alert.rowCount) return { error: "Alert not found", status: 404 } as const;

  const runQuery: typeof query = (sql, params) => client.query(sql, params);
  const before = await alertCountries(companyId, alertId, runQuery);
  const { manual_codes: currentCodes } = alertCountryCodes(before);
  if (expectedCodes && (expectedCodes.length !== currentCodes.length || expectedCodes.some((code, index) => code !== currentCodes[index]))) {
    return { error: "This alert's country mapping changed. Reopen the picker to see the latest selection.", status: 409 } as const;
  }

  const countries = await client.query<{ id: string }>(
    `SELECT id FROM geographies WHERE level IN ('country', 'region') AND code = ANY($1::text[])`,
    [countryCodes]
  );
  if (countries.rows.length !== countryCodes.length) return { error: "Select continents or countries from the list.", status: 400 } as const;

  const geographyIds = countries.rows.map((row) => row.id);
  const removed = await client.query(
    `DELETE FROM alert_geographies ag USING geographies g
     WHERE ag.geography_id = g.id AND g.level IN ('country', 'region')
       AND ag.company_id = $1 AND ag.alert_id = $2 AND ag.state = 'confirmed'
       AND ag.source_evidence = $3 AND NOT (ag.geography_id = ANY($4::uuid[]))`,
    [companyId, alertId, MANUAL_COUNTRY_EVIDENCE, geographyIds]
  );
  const added = await client.query(
    `INSERT INTO alert_geographies (company_id, alert_id, geography_id, state, source_evidence, confirmed_by, confirmed_at)
     SELECT $1, $2, g.id, 'confirmed', $3, $4, now()
     FROM geographies g WHERE g.id = ANY($5::uuid[])
     ON CONFLICT (alert_id, geography_id) DO UPDATE
     SET state = EXCLUDED.state, source_evidence = EXCLUDED.source_evidence,
         confirmed_by = EXCLUDED.confirmed_by, confirmed_at = EXCLUDED.confirmed_at
     WHERE alert_geographies.company_id = EXCLUDED.company_id AND alert_geographies.state = 'rejected'`,
    [companyId, alertId, MANUAL_COUNTRY_EVIDENCE, memberId, geographyIds]
  );

  const after = await alertCountries(companyId, alertId, runQuery);
  if (removed.rowCount || added.rowCount) {
    await client.query(
      `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, before_values, after_values)
       VALUES ($1, $2, 'geography_mapping_updated', 'alert', $3, $4, $5)`,
      [
        companyId, memberId, alertId,
        JSON.stringify({ countries: before.map((mapping) => mapping.display_name) }),
        JSON.stringify({ countries: after.map((mapping) => mapping.display_name) }),
      ]
    );
  }
  return { geographies: after, ...alertCountryCodes(after) };
}
