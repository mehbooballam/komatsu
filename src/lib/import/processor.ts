import crypto from "crypto";
import { query, getClient } from "@/lib/db";
import {
  RECOMMENDATION_MAP,
  FACTOR_KEY_MAP,
  RATIONALE_COLUMNS,
  FACTOR_COLUMNS,
  type ImportColumnName,
} from "./constants";
import type { ValidatedRow } from "./validator";
import { resolveJurisdiction } from "@/lib/geo/countries";
import { getAsOfDate, recalculateAlert } from "@/lib/scoring/recalculate";
import { matchImportedProducts, type ProductMatchResult } from "./product-matching";

export interface ProcessResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  invalid: number;
  conflicts: number;
  errors: { rowNumber: number; message: string }[];
  /** Products matched from the file's Product column (suggested links; nothing is created). */
  products?: ProductMatchResult;
}

function computeRowHash(mapped: Partial<Record<ImportColumnName, string | null>>): string {
  const hash = crypto.createHash("sha256");
  const keys = Object.keys(mapped).sort();
  for (const key of keys) {
    const val = mapped[key as ImportColumnName];
    hash.update(`${key}:${val ?? ""}\n`);
  }
  return hash.digest("hex");
}

function mapRecommendation(raw: string | null): string {
  if (!raw) return "unreviewed";
  const normalized = raw.toLowerCase().trim().replace(/[\s-]+/g, "_");
  return RECOMMENDATION_MAP[normalized] ?? "unreviewed";
}

export async function processImportBatch(
  batchId: string,
  companyId: string,
  feedId: string,
  rows: ValidatedRow[],
  updateMode: "preserve" | "replace" = "preserve"
): Promise<ProcessResult> {
  const result: ProcessResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    invalid: 0,
    conflicts: 0,
    errors: [],
  };

  const processableRows = rows
    .filter((r) => r.isValid)
    .filter((r) => !r.isDuplicate);

  const skippedDups = rows.filter((r) => r.isDuplicate);
  result.skipped += skippedDups.length;
  result.conflicts += skippedDups.length;
  result.invalid += rows.filter((r) => !r.isValid).length;

  const touchedAlertIds: string[] = [];
  const client = await getClient();
  try {
    await client.query("BEGIN");

    for (const row of processableRows) {
      // Savepoint per row: a failing row is rolled back on its own instead of
      // aborting the whole transaction for every row after it.
      await client.query("SAVEPOINT import_row");
      try {
        const alertId = row.parsed.alert_id as string;
        const rowHash = computeRowHash(row.mapped);

        const existingResult = await client.query(
          `SELECT a.id, a.current_source_revision_id, a.record_version,
                  asr.row_hash
           FROM alerts a
           LEFT JOIN alert_source_revisions asr ON asr.id = a.current_source_revision_id
           WHERE a.company_id = $1 AND a.feed_id = $2 AND a.external_alert_id = $3`,
          [companyId, feedId, alertId]
        );

        await client.query(
          `UPDATE import_rows SET row_hash = $1, external_alert_id = $2
           WHERE batch_id = $3 AND row_number = $4`,
          [rowHash, alertId, batchId, row.rowNumber]
        );

        if (existingResult.rows.length === 0) {
          const newAlertId = await createAlert(client, companyId, feedId, row, batchId, rowHash);
          await client.query(
            `UPDATE import_rows SET state = 'created', alert_id = $1 WHERE batch_id = $2 AND row_number = $3`,
            [newAlertId, batchId, row.rowNumber]
          );
          result.created++;
          touchedAlertIds.push(newAlertId);
        } else {
          const existing = existingResult.rows[0];
          if (existing.row_hash === rowHash) {
            await client.query(
              `UPDATE import_rows SET state = 'unchanged', alert_id = $1 WHERE batch_id = $2 AND row_number = $3`,
              [existing.id, batchId, row.rowNumber]
            );
            result.unchanged++;
          } else {
            await updateAlert(client, companyId, feedId, existing, row, batchId, rowHash, updateMode);
            await client.query(
              `UPDATE import_rows SET state = 'updated', alert_id = $1 WHERE batch_id = $2 AND row_number = $3`,
              [existing.id, batchId, row.rowNumber]
            );
            result.updated++;
            touchedAlertIds.push(existing.id);
          }
        }
        await client.query("RELEASE SAVEPOINT import_row");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT import_row");
        console.error(`Import row ${row.rowNumber} failed:`, err);
        await client.query(
          `UPDATE import_rows SET state = 'invalid' WHERE batch_id = $1 AND row_number = $2`,
          [batchId, row.rowNumber]
        );
        result.errors.push({
          rowNumber: row.rowNumber,
          message: err instanceof Error ? err.message : "Unknown error",
        });
        result.skipped++;
      }
    }

    await client.query(
      `UPDATE import_batches SET status = 'completed', completed_at = now(),
              row_counts = $1 WHERE id = $2`,
      [JSON.stringify(result), batchId]
    );

    await client.query(
      `INSERT INTO audit_events (company_id, actor_system, action, entity_type, entity_id, after_values)
       VALUES ($1, 'import', 'import_completed', 'import_batch', $2, $3)`,
      [companyId, batchId, JSON.stringify(result)]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");

    await query(
      `UPDATE import_batches SET status = 'failed', error_summary = $1, completed_at = now() WHERE id = $2`,
      [JSON.stringify({ message: err instanceof Error ? err.message : "Unknown error" }), batchId]
    );

    throw err;
  } finally {
    client.release();
  }

  await postProcessAlerts(companyId, touchedAlertIds, result);

  return result;
}

/**
 * After the import commits: map each alert's jurisdiction to countries (so it
 * appears on the heat map) and compute its risk score (so it gets a priority
 * band). Failures here are reported per row but never undo the import.
 */
async function postProcessAlerts(companyId: string, alertIds: string[], result: ProcessResult) {
  if (alertIds.length === 0) return;

  const companyRes = await query(`SELECT time_zone FROM companies WHERE id = $1`, [companyId]);
  const asOfDate = getAsOfDate(companyRes.rows[0]?.time_zone || "UTC");

  const geoRes = await query(`SELECT id, code FROM geographies WHERE level = 'country'`);
  const geoIdByCode = new Map<string, string>(geoRes.rows.map((g) => [g.code, g.id]));

  for (const alertId of alertIds) {
    try {
      const alertRes = await query(`SELECT jurisdiction_raw FROM alerts WHERE id = $1`, [alertId]);
      const codes = resolveJurisdiction(alertRes.rows[0]?.jurisdiction_raw);
      for (const code of codes) {
        const geographyId = geoIdByCode.get(code);
        if (!geographyId) continue;
        await query(
          `INSERT INTO alert_geographies (company_id, alert_id, geography_id, state, source_evidence)
           SELECT $1, $2, $3, 'mapped', 'Import: jurisdiction'
           WHERE NOT EXISTS (
             SELECT 1 FROM alert_geographies WHERE alert_id = $2 AND geography_id = $3
           )`,
          [companyId, alertId, geographyId]
        );
      }
      await recalculateAlert(alertId, companyId, asOfDate, "import");
    } catch (err) {
      console.error(`Post-import processing failed for alert ${alertId}:`, err);
      result.errors.push({
        rowNumber: 0,
        message: `Alert saved, but mapping/scoring failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  }

  // Suggest products from the inventory that match the file's Product column
  try {
    result.products = await matchImportedProducts(companyId, alertIds);
  } catch (err) {
    console.error("Product matching after import failed:", err);
    result.errors.push({ rowNumber: 0, message: "Alerts saved, but matching products to the inventory failed." });
  }
}

async function createAlert(
  client: Awaited<ReturnType<typeof getClient>>,
  companyId: string,
  feedId: string,
  row: ValidatedRow,
  batchId: string,
  rowHash: string
): Promise<string> {
  const p = row.parsed;

  const alertResult = await client.query(
    `INSERT INTO alerts (
       company_id, feed_id, external_alert_id, title, overview, summary, relevance,
       published_on, stage, recommendation, change_type, timing_raw, product_raw,
       jurisdiction_raw, agency_name, source_name, source_url, topic_match,
       provider_review_state, local_state
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'new')
     RETURNING id`,
    [
      companyId,
      feedId,
      p.alert_id,
      p.title,
      p.overview || null,
      p.summary || null,
      p.relevance || null,
      p.published_on || null,
      p.status || null,
      p.category_algorithm_defined || null,
      p.change_type || null,
      p.timing || null,
      Array.isArray(p.product) ? (p.product as string[]).join("; ") : (p.product as string) || null,
      p.jurisdiction || null,
      p.agency_name || null,
      p.source || null,
      p.link || null,
      Array.isArray(p.topic_match) ? (p.topic_match as string[]).join(" | ") : (p.topic_match as string) || null,
      mapRecommendation(p.category_algorithm_defined as string | null),
    ]
  );

  const newAlertId = alertResult.rows[0].id;

  const importRowResult = await client.query(
    `SELECT id FROM import_rows WHERE batch_id = $1 AND row_number = $2`,
    [batchId, row.rowNumber]
  );
  const importRowId = importRowResult.rows[0]?.id;

  const sourcePayload: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row.mapped)) {
    if (val !== undefined) sourcePayload[key] = val;
  }

  const revResult = await client.query(
    `INSERT INTO alert_source_revisions (
       company_id, alert_id, import_row_id, version_number, row_hash, source_payload, effective_source_fields
     ) VALUES ($1, $2, $3, 1, $4, $5, $5)
     RETURNING id`,
    [companyId, newAlertId, importRowId, rowHash, JSON.stringify(sourcePayload)]
  );
  const revisionId = revResult.rows[0].id;

  await client.query(
    `UPDATE alerts SET current_source_revision_id = $1 WHERE id = $2`,
    [revisionId, newAlertId]
  );

  for (const col of FACTOR_COLUMNS) {
    const rawVal = row.mapped[col];
    const parsedVal = p[col] as number | undefined;
    const factorKey = FACTOR_KEY_MAP[col];
    const rationaleCol = RATIONALE_COLUMNS[factorKey];
    const rationale = p[rationaleCol] as string | null | undefined;

    if (rawVal !== null && rawVal !== undefined) {
      await client.query(
        `INSERT INTO source_factor_ratings (company_id, alert_source_revision_id, factor_key, original_value, parsed_value, rationale)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [companyId, revisionId, factorKey, rawVal, parsedVal ?? null, rationale ?? null]
      );
    }
  }

  if (p.deadline_date && typeof p.deadline_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.deadline_date)) {
    await client.query(
      `INSERT INTO alert_deadlines (company_id, alert_id, kind, date_value, applies_to, verification_state, origin)
       VALUES ($1, $2, 'unknown', $3, NULL, 'unverified', 'import')`,
      [companyId, newAlertId, p.deadline_date]
    );
  }

  if (Array.isArray(p.topic_match)) {
    for (const topic of p.topic_match as string[]) {
      const normalizedKey = topic.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      await client.query(
        `INSERT INTO alert_topics (company_id, alert_id, normalized_key, source_label)
         VALUES ($1, $2, $3, $4) ON CONFLICT (alert_id, normalized_key) DO NOTHING`,
        [companyId, newAlertId, normalizedKey, topic]
      );
    }
  }

  await client.query(
    `INSERT INTO alert_active_projections (company_id, alert_id, is_active)
     VALUES ($1, $2, TRUE)
     ON CONFLICT (company_id, alert_id) DO NOTHING`,
    [companyId, newAlertId]
  );

  return newAlertId;
}

async function updateAlert(
  client: Awaited<ReturnType<typeof getClient>>,
  companyId: string,
  feedId: string,
  existing: { id: string; current_source_revision_id: string; record_version: number },
  row: ValidatedRow,
  batchId: string,
  rowHash: string,
  updateMode: "preserve" | "replace"
): Promise<void> {
  const p = row.parsed;
  const alertId = existing.id;

  const versionResult = await client.query(
    `SELECT COALESCE(MAX(version_number), 0) + 1 as next_version FROM alert_source_revisions WHERE alert_id = $1`,
    [alertId]
  );
  const nextVersion = versionResult.rows[0].next_version;

  const importRowResult = await client.query(
    `SELECT id FROM import_rows WHERE batch_id = $1 AND row_number = $2`,
    [batchId, row.rowNumber]
  );
  const importRowId = importRowResult.rows[0]?.id;

  const sourcePayload: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row.mapped)) {
    if (val !== undefined) sourcePayload[key] = val;
  }

  const revResult = await client.query(
    `INSERT INTO alert_source_revisions (
       company_id, alert_id, import_row_id, version_number, row_hash, source_payload, effective_source_fields
     ) VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING id`,
    [companyId, alertId, importRowId, nextVersion, rowHash, JSON.stringify(sourcePayload)]
  );
  const revisionId = revResult.rows[0].id;

  const sourceUpdates: string[] = [];
  const sourceValues: unknown[] = [];
  let paramIdx = 1;

  const sourceFields: { dbCol: string; parsed: ImportColumnName }[] = [
    { dbCol: "title", parsed: "title" },
    { dbCol: "overview", parsed: "overview" },
    { dbCol: "summary", parsed: "summary" },
    { dbCol: "relevance", parsed: "relevance" },
    { dbCol: "stage", parsed: "status" },
    { dbCol: "recommendation", parsed: "category_algorithm_defined" },
    { dbCol: "change_type", parsed: "change_type" },
    { dbCol: "timing_raw", parsed: "timing" },
    { dbCol: "jurisdiction_raw", parsed: "jurisdiction" },
    { dbCol: "agency_name", parsed: "agency_name" },
    { dbCol: "source_name", parsed: "source" },
    { dbCol: "source_url", parsed: "link" },
  ];

  for (const field of sourceFields) {
    const isPresent = row.presentColumns.has(field.parsed);
    if (!isPresent) continue;

    const val = p[field.parsed] as string | null | undefined;
    if (updateMode === "preserve" && (val === null || val === undefined)) {
      continue;
    }

    sourceUpdates.push(`${field.dbCol} = $${paramIdx}`);
    sourceValues.push(val ?? null);
    paramIdx++;
  }

  if (row.presentColumns.has("published_on")) {
    const val = p.published_on as string | null | undefined;
    if (val || updateMode === "replace") {
      sourceUpdates.push(`published_on = $${paramIdx}`);
      sourceValues.push(val || null);
      paramIdx++;
    }
  }

  if (row.presentColumns.has("product")) {
    const products = p.product;
    const productStr = Array.isArray(products) ? products.join("; ") : (products as string) || null;
    if (productStr || updateMode === "replace") {
      sourceUpdates.push(`product_raw = $${paramIdx}`);
      sourceValues.push(productStr);
      paramIdx++;
    }
  }

  if (row.presentColumns.has("topic_match")) {
    const topics = p.topic_match;
    const topicStr = Array.isArray(topics) ? topics.join(" | ") : (topics as string) || null;
    if (topicStr || updateMode === "replace") {
      sourceUpdates.push(`topic_match = $${paramIdx}`);
      sourceValues.push(topicStr);
      paramIdx++;
    }
  }

  if (row.presentColumns.has("category_algorithm_defined") && p.category_algorithm_defined) {
    sourceUpdates.push(`provider_review_state = $${paramIdx}`);
    sourceValues.push(mapRecommendation(p.category_algorithm_defined as string));
    paramIdx++;
  }

  sourceUpdates.push(`current_source_revision_id = $${paramIdx}`);
  sourceValues.push(revisionId);
  paramIdx++;

  sourceUpdates.push(`record_version = record_version + 1`);

  sourceValues.push(alertId);
  await client.query(
    `UPDATE alerts SET ${sourceUpdates.join(", ")} WHERE id = $${paramIdx}`,
    sourceValues
  );

  for (const col of FACTOR_COLUMNS) {
    const rawVal = row.mapped[col];
    const parsedVal = p[col] as number | undefined;
    const factorKey = FACTOR_KEY_MAP[col];
    const rationaleCol = RATIONALE_COLUMNS[factorKey];
    const rationale = p[rationaleCol] as string | null | undefined;

    if (rawVal !== null && rawVal !== undefined) {
      await client.query(
        `INSERT INTO source_factor_ratings (company_id, alert_source_revision_id, factor_key, original_value, parsed_value, rationale)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [companyId, revisionId, factorKey, rawVal, parsedVal ?? null, rationale ?? null]
      );
    }
  }

  if (p.deadline_date && typeof p.deadline_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.deadline_date)) {
    const existingDeadline = await client.query(
      `SELECT id FROM alert_deadlines WHERE alert_id = $1 AND date_value = $2 AND lifecycle_state = 'outstanding'`,
      [alertId, p.deadline_date]
    );
    if (existingDeadline.rows.length === 0) {
      await client.query(
        `INSERT INTO alert_deadlines (company_id, alert_id, kind, date_value, applies_to, verification_state, origin)
         VALUES ($1, $2, 'unknown', $3, NULL, 'unverified', 'import')`,
        [companyId, alertId, p.deadline_date]
      );
    }
  }

  if (Array.isArray(p.topic_match)) {
    for (const topic of p.topic_match as string[]) {
      const normalizedKey = topic.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      await client.query(
        `INSERT INTO alert_topics (company_id, alert_id, normalized_key, source_label)
         VALUES ($1, $2, $3, $4) ON CONFLICT (alert_id, normalized_key) DO NOTHING`,
        [companyId, alertId, normalizedKey, topic]
      );
    }
  }

  await client.query(
    `INSERT INTO audit_events (company_id, actor_system, action, entity_type, entity_id, after_values)
     VALUES ($1, 'import', 'alert_updated', 'alert', $2, $3)`,
    [companyId, alertId, JSON.stringify({ source_revision: nextVersion, row_hash: rowHash })]
  );
}
