import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSessionFromRequest, requireRole } from "@/lib/auth/api-helper";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const batchResult = await query(
    `SELECT ib.*, f.dataset_key, f.provider_name
     FROM import_batches ib
     JOIN feeds f ON f.id = ib.feed_id
     WHERE ib.id = $1 AND ib.company_id = $2`,
    [id, session.membership.company_id]
  );

  if (batchResult.rows.length === 0) {
    return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  }

  const batch = batchResult.rows[0];

  const rowsResult = await query(
    `SELECT ir.row_number, ir.external_alert_id, ir.raw_payload, ir.validation, ir.state,
            CASE WHEN a.id IS NOT NULL THEN 'existing' ELSE 'new' END as alert_status,
            a.title as existing_title
     FROM import_rows ir
     LEFT JOIN alerts a ON a.company_id = $2 AND a.feed_id = $3 AND a.external_alert_id = ir.external_alert_id
     WHERE ir.batch_id = $1
     ORDER BY ir.row_number`,
    [id, session.membership.company_id, batch.feed_id]
  );

  const rows = rowsResult.rows.map((r) => ({
    rowNumber: r.row_number,
    alertId: r.external_alert_id,
    state: r.state,
    alertStatus: r.alert_status,
    existingTitle: r.existing_title,
    errors: r.validation?.errors || [],
    warnings: r.validation?.warnings || [],
    raw: r.raw_payload,
  }));

  const newCount = rows.filter((r) => r.alertStatus === "new" && r.state === "valid").length;
  const updateCount = rows.filter((r) => r.alertStatus === "existing" && r.state === "valid").length;

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
      dataset: batch.dataset_key,
      provider: batch.provider_name,
    },
    counts: {
      ...batch.row_counts,
      new: newCount,
      update: updateCount,
    },
    rows,
  });
}
