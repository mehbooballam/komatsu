import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { canImport, forbidden, getAuth, unauthorized } from "@/lib/auth-helpers";
import { processImportBatch } from "@/lib/import/processor";
import { validateRows, type ValidatedRow } from "@/lib/import/validator";
import type { ParsedRow } from "@/lib/import/parser-xlsx";
import type { ImportColumnName } from "@/lib/import/constants";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canImport(auth.role)) return forbidden();

  const { id } = await params;

  // Claim the batch and check its state in one statement so concurrent confirmations
  // cannot both start processing it.
  const claimed = await query(
    `UPDATE import_batches SET status = 'processing', started_at = now()
     WHERE id = $1 AND company_id = $2 AND status = 'previewing'
     RETURNING feed_id, update_mode, column_mapping`,
    [id, auth.company_id]
  );
  const batch = claimed.rows[0];
  if (!batch) {
    const current = await query(
      `SELECT status FROM import_batches WHERE id = $1 AND company_id = $2`,
      [id, auth.company_id]
    );
    if (!current.rows[0]) {
      return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: `Cannot confirm batch in status: ${current.rows[0].status}` },
      { status: 409 }
    );
  }

  try {
    const rowsResult = await query(
      `SELECT row_number, raw_payload FROM import_rows WHERE batch_id = $1 ORDER BY row_number`,
      [id]
    );

    // Restore the saved column mapping and use the same validation as the preview.
    const columnMapping: Record<string, ImportColumnName | null> = batch.column_mapping || {};
    const parsedRows: ParsedRow[] = rowsResult.rows.map((r) => {
      const raw: Record<string, string | null> = r.raw_payload || {};
      const mapped: Partial<Record<ImportColumnName, string | null>> = {};
      const presentColumns = new Set<ImportColumnName>();

      for (const [header, value] of Object.entries(raw)) {
        if (!Object.hasOwn(columnMapping, header)) continue;
        const col = columnMapping[header];
        if (!col) continue;
        presentColumns.add(col);
        mapped[col] = typeof value === "string" ? value.trim() || null : value ?? null;
      }

      return { rowNumber: r.row_number, raw, mapped, presentColumns };
    });

    const validatedRows: ValidatedRow[] = validateRows(parsedRows).rows;
    const result = await processImportBatch(
      id,
      auth.company_id,
      batch.feed_id,
      validatedRows,
      batch.update_mode || "preserve"
    );

    return NextResponse.json({
      batchId: id,
      status: "completed",
      counts: result,
    });
  } catch (error) {
    console.error("Import processing failed:", error);
    // Processing can fail before the processor starts its transaction.
    await query(
      `UPDATE import_batches SET status = 'failed', completed_at = now(), error_summary = $3
       WHERE id = $1 AND company_id = $2 AND status = 'processing'`,
      [id, auth.company_id, JSON.stringify({ message: "Import processing failed" })]
    ).catch((statusError: unknown) => console.error("Could not update import status:", statusError));
    return NextResponse.json({ error: "Import processing failed" }, { status: 500 });
  }
}
