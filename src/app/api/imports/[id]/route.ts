import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { canImport, forbidden, getAuth, unauthorized } from "@/lib/auth-helpers";
import path from "path";
import { unlink } from "fs/promises";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canImport(auth.role)) return forbidden();

  const { id } = await params;

  const batchResult = await query(
    `SELECT ib.*, u.display_name as uploader_name, f.dataset_key, f.provider_name
     FROM import_batches ib
     JOIN memberships m ON m.id = ib.uploader_membership_id
     JOIN user_profiles u ON u.id = m.user_id
     JOIN feeds f ON f.id = ib.feed_id
     WHERE ib.id = $1 AND ib.company_id = $2`,
    [id, auth.company_id]
  );

  if (batchResult.rows.length === 0) {
    return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  }

  const batch = batchResult.rows[0];

  const rowsResult = await query(
    `SELECT ir.row_number, ir.external_alert_id, ir.row_hash, ir.raw_payload,
            ir.validation, ir.state, ir.alert_id
     FROM import_rows ir
     WHERE ir.batch_id = $1
     ORDER BY ir.row_number`,
    [id]
  );

  return NextResponse.json({
    batch: {
      id: batch.id,
      filename: batch.original_filename,
      format: batch.input_format,
      worksheet: batch.selected_worksheet,
      headerRow: batch.header_row,
      status: batch.status,
      columnMapping: batch.column_mapping,
      updateMode: batch.update_mode,
      reportDate: batch.report_date,
      rowCounts: batch.row_counts,
      errorSummary: batch.error_summary,
      uploaderName: batch.uploader_name,
      dataset: batch.dataset_key,
      provider: batch.provider_name,
      createdAt: batch.created_at,
      startedAt: batch.started_at,
      completedAt: batch.completed_at,
    },
    rows: rowsResult.rows.map((r) => ({
      rowNumber: r.row_number,
      alertId: r.external_alert_id,
      hash: r.row_hash,
      state: r.state,
      linkedAlertId: r.alert_id,
      validation: r.validation,
      raw: r.raw_payload,
    })),
  });
}

/**
 * DELETE — cancel an import that has not been processed (previewing or failed):
 * removes the batch, its rows and the uploaded file. Imports that already ran stay in the history.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canImport(auth.role)) return forbidden();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });

  const res = await query(
    `SELECT id, status, original_filename, object_key FROM import_batches WHERE id = $1 AND company_id = $2`,
    [id, auth.company_id]
  );
  const batch = res.rows[0];
  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  if (!["previewing", "validating", "uploading", "failed", "cancelled"].includes(batch.status)) {
    return NextResponse.json({ error: `An import that is ${batch.status} can't be cancelled` }, { status: 409 });
  }

  await query(`DELETE FROM import_rows WHERE batch_id = $1`, [id]);
  await query(`DELETE FROM import_batches WHERE id = $1 AND company_id = $2`, [id, auth.company_id]);
  if (batch.object_key) {
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || (process.env.VERCEL ? "/tmp/uploads" : "./uploads"));
    const filePath = path.resolve(uploadDir, batch.object_key);
    if (filePath.startsWith(uploadDir + path.sep)) await unlink(filePath).catch(() => {});
  }
  await query(
    `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, before_values)
     VALUES ($1, $2, 'import_cancelled', 'import_batch', $3, $4)`,
    [auth.company_id, auth.membership_id, id, JSON.stringify({ filename: batch.original_filename, status: batch.status })]
  );
  return NextResponse.json({ ok: true });
}
