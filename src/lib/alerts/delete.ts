import { getClient } from "@/lib/db";

/**
 * Permanently delete alerts and everything that hangs off them (scores, deadlines,
 * source revisions, links, projections). Pass `alertIds = null` to delete every
 * alert in the company; `includeImports` also clears import history.
 * Runs in one transaction: either everything is removed or nothing is.
 */
export async function deleteAlerts(
  companyId: string,
  alertIds: string[] | null,
  opts: { includeImports?: boolean } = {}
): Promise<number> {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const idsRes = alertIds
      ? await client.query(`SELECT id FROM alerts WHERE company_id = $1 AND id = ANY($2::uuid[])`, [companyId, alertIds])
      : await client.query(`SELECT id FROM alerts WHERE company_id = $1`, [companyId]);
    const ids: string[] = idsRes.rows.map((r) => r.id);

    if (ids.length > 0) {
      const p = [ids];
      const del = (sql: string) => client.query(sql, p);

      await del(`UPDATE alerts SET current_source_revision_id = NULL WHERE id = ANY($1::uuid[])`);
      await del(`DELETE FROM alert_active_projections WHERE alert_id = ANY($1::uuid[])`);
      await del(`DELETE FROM score_assessments WHERE alert_id = ANY($1::uuid[])`);
      await del(`DELETE FROM implementation_forecasts WHERE alert_id = ANY($1::uuid[])`);
      await del(`UPDATE alert_deadlines SET supersedes_id = NULL WHERE alert_id = ANY($1::uuid[])`);
      await del(`DELETE FROM alert_deadlines WHERE alert_id = ANY($1::uuid[])`);
      await del(`DELETE FROM score_overrides WHERE alert_id = ANY($1::uuid[])`);
      await del(
        `DELETE FROM source_factor_ratings WHERE alert_source_revision_id IN
           (SELECT id FROM alert_source_revisions WHERE alert_id = ANY($1::uuid[]))`
      );
      await del(`DELETE FROM alert_source_revisions WHERE alert_id = ANY($1::uuid[])`);
      await del(`DELETE FROM suggestions WHERE review_run_id IN (SELECT id FROM review_runs WHERE alert_id = ANY($1::uuid[]))`);
      await del(`DELETE FROM review_runs WHERE alert_id = ANY($1::uuid[])`);
      for (const table of [
        "alert_field_overrides",
        "alert_scopes",
        "alert_topics",
        "alert_tags",
        "alert_group_links",
        "alert_geographies",
        "alert_product_links",
        "alert_notes",
        "assignment_events",
      ]) {
        await del(`DELETE FROM ${table} WHERE alert_id = ANY($1::uuid[])`);
      }
      await del(`UPDATE import_rows SET alert_id = NULL WHERE alert_id = ANY($1::uuid[])`);
      await del(`DELETE FROM alerts WHERE id = ANY($1::uuid[])`);
    }

    if (opts.includeImports) {
      await client.query(
        `DELETE FROM suggestions WHERE evidence_id IN (
           SELECT id FROM evidence_refs WHERE import_row_id IN (
             SELECT ir.id FROM import_rows ir JOIN import_batches ib ON ib.id = ir.batch_id WHERE ib.company_id = $1))`,
        [companyId]
      );
      await client.query(
        `UPDATE score_overrides SET evidence_id = NULL WHERE evidence_id IN (
           SELECT id FROM evidence_refs WHERE import_row_id IN (
             SELECT ir.id FROM import_rows ir JOIN import_batches ib ON ib.id = ir.batch_id WHERE ib.company_id = $1))`,
        [companyId]
      );
      await client.query(
        `DELETE FROM evidence_refs WHERE import_row_id IN (
           SELECT ir.id FROM import_rows ir JOIN import_batches ib ON ib.id = ir.batch_id WHERE ib.company_id = $1)`,
        [companyId]
      );
      await client.query(
        `DELETE FROM import_rows WHERE batch_id IN (SELECT id FROM import_batches WHERE company_id = $1)`,
        [companyId]
      );
      await client.query(`DELETE FROM import_batches WHERE company_id = $1`, [companyId]);
    }

    await client.query("COMMIT");
    return ids.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
