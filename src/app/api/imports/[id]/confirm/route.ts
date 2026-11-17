import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSessionFromRequest, requireRole } from "@/lib/auth/api-helper";
import { processImportBatch } from "@/lib/import/processor";
import type { ValidatedRow } from "@/lib/import/validator";
import type { ImportColumnName } from "@/lib/import/constants";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!requireRole(session, "company_admin", "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const batchResult = await query(
    `SELECT * FROM import_batches WHERE id = $1 AND company_id = $2`,
    [id, session.membership.company_id]
  );

  if (batchResult.rows.length === 0) {
    return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  }

  const batch = batchResult.rows[0];

  if (batch.status !== "previewing") {
    return NextResponse.json(
      { error: `Cannot confirm batch in status: ${batch.status}` },
      { status: 400 }
    );
  }

  await query(`UPDATE import_batches SET status = 'processing', started_at = now() WHERE id = $1`, [id]);

  const rowsResult = await query(
    `SELECT row_number, external_alert_id, raw_payload, validation, state FROM import_rows WHERE batch_id = $1 ORDER BY row_number`,
    [id]
  );

  const validatedRows: ValidatedRow[] = rowsResult.rows.map((r) => {
    const raw = r.raw_payload || {};
    const mapped: Partial<Record<ImportColumnName, string | null>> = {};
    const presentColumns = new Set<ImportColumnName>();

    for (const [key, value] of Object.entries(raw)) {
      const col = key as ImportColumnName;
      presentColumns.add(col);
      mapped[col] = value as string | null;
    }

    const validation = r.validation || { errors: [], warnings: [] };
    const parsed: Partial<Record<ImportColumnName, unknown>> = { ...mapped };

    if (mapped.alert_id) parsed.alert_id = mapped.alert_id;
    if (mapped.title) parsed.title = mapped.title;

    return {
      rowNumber: r.row_number,
      raw,
      mapped,
      presentColumns,
      parsed,
      errors: validation.errors || [],
      warnings: validation.warnings || [],
      isValid: r.state === "valid",
      isDuplicate: false,
    };
  });

  try {
    const result = await processImportBatch(
      id,
      session.membership.company_id,
      batch.feed_id,
      validatedRows,
      batch.update_mode || "preserve"
    );

    return NextResponse.json({
      batchId: id,
      status: "completed",
      counts: result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Import processing failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
