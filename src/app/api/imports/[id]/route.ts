import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/api-helper";

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
    `SELECT ib.*, u.display_name as uploader_name, f.dataset_key, f.provider_name
     FROM import_batches ib
     JOIN memberships m ON m.id = ib.uploader_membership_id
     JOIN user_profiles u ON u.id = m.user_id
     JOIN feeds f ON f.id = ib.feed_id
     WHERE ib.id = $1 AND ib.company_id = $2`,
    [id, session.membership.company_id]
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
