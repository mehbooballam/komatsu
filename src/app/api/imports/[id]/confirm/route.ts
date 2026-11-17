import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSessionFromRequest, requireRole } from "@/lib/auth/api-helper";
import { processImportBatch } from "@/lib/import/processor";
import { validateRows, type ValidatedRow } from "@/lib/import/validator";
import type { ParsedRow } from "@/lib/import/parser-xlsx";
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

  // raw_payload is keyed by the file's original headers. Map them back to import
  // columns with the batch's saved header mapping, then re-run the same validator
  // used for the preview so values are parsed (ratings → numbers, products →
  // arrays, dates → ISO) exactly as the user saw them.
  const columnMapping: Record<string, ImportColumnName | null> = batch.column_mapping || {};
  const parsedRows: ParsedRow[] = rowsResult.rows.map((r) => {
    const raw: Record<string, string | null> = r.raw_payload || {};
    const mapped: Partial<Record<ImportColumnName, string | null>> = {};
    const presentColumns = new Set<ImportColumnName>();

    for (const [header, value] of Object.entries(raw)) {
      const col = columnMapping[header] ?? null;
      if (!col) continue;
      presentColumns.add(col);
      const trimmed = typeof value === "string" ? value.trim() : value;
      mapped[col] = trimmed === "" || trimmed === undefined ? null : (trimmed as string | null);
    }

    return { rowNumber: r.row_number, raw, mapped, presentColumns };
  });

  const validatedRows: ValidatedRow[] = validateRows(parsedRows).rows;

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
