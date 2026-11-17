import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { query } from "@/lib/db";
import { getSessionFromRequest, requireRole } from "@/lib/auth/api-helper";
import { parseXlsx, listWorksheets } from "@/lib/import/parser-xlsx";
import { parseCsv } from "@/lib/import/parser-csv";
import { validateRows } from "@/lib/import/validator";

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!requireRole(session, "company_admin", "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const worksheetName = formData.get("worksheet") as string | null;
  const headerRow = parseInt(formData.get("headerRow") as string) || 1;
  const reportDate = formData.get("reportDate") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const ext = path.extname(file.name).toLowerCase();
  if (ext !== ".xlsx" && ext !== ".csv") {
    return NextResponse.json(
      { error: "Unsupported file type. Use .xlsx or .csv" },
      { status: 400 }
    );
  }

  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const digest = crypto.createHash("sha256").update(buffer).digest("hex");

  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  await mkdir(uploadDir, { recursive: true });

  const objectKey = `${session.membership.company_id}/${Date.now()}-${file.name}`;
  const filePath = path.join(uploadDir, objectKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);

  const feedResult = await query(
    `SELECT id FROM feeds WHERE company_id = $1 AND dataset_key = 'daptic-default' LIMIT 1`,
    [session.membership.company_id]
  );

  let feedId: string;
  if (feedResult.rows.length === 0) {
    const newFeed = await query(
      `INSERT INTO feeds (company_id, provider_name, dataset_key, name)
       VALUES ($1, 'Daptic', 'daptic-default', 'Daptic Alert Feed')
       RETURNING id`,
      [session.membership.company_id]
    );
    feedId = newFeed.rows[0].id;
  } else {
    feedId = feedResult.rows[0].id;
  }

  const idempotencyKey = `${digest}-${Date.now()}`;

  const batchResult = await query(
    `INSERT INTO import_batches (
       company_id, feed_id, uploader_membership_id, input_format,
       original_filename, selected_worksheet, header_row, object_key,
       digest, idempotency_key, status, report_date
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'validating', $11)
     RETURNING id`,
    [
      session.membership.company_id,
      feedId,
      session.membership.id,
      ext.replace(".", ""),
      file.name,
      worksheetName || null,
      headerRow,
      objectKey,
      digest,
      idempotencyKey,
      reportDate || null,
    ]
  );

  const batchId = batchResult.rows[0].id;

  let parseResult;
  try {
    if (ext === ".xlsx") {
      const sheets = listWorksheets(buffer);
      parseResult = parseXlsx(buffer, {
        worksheetName: worksheetName || undefined,
        headerRow,
      });
    } else {
      parseResult = parseCsv(buffer);
    }
  } catch (err) {
    await query(`UPDATE import_batches SET status = 'failed', error_summary = $1 WHERE id = $2`, [
      JSON.stringify({ message: err instanceof Error ? err.message : "Parse error" }),
      batchId,
    ]);
    return NextResponse.json(
      { error: "Failed to parse file", details: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 }
    );
  }

  const validation = validateRows(parseResult.rows);

  for (const row of validation.rows) {
    await query(
      `INSERT INTO import_rows (batch_id, row_number, external_alert_id, raw_payload, validation, state)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        batchId,
        row.rowNumber,
        (row.parsed.alert_id as string) || null,
        JSON.stringify(row.raw),
        JSON.stringify({ errors: row.errors, warnings: row.warnings }),
        row.isValid ? "valid" : "invalid",
      ]
    );
  }

  await query(
    `UPDATE import_batches SET status = 'previewing',
     column_mapping = $1,
     row_counts = $2
     WHERE id = $3`,
    [
      JSON.stringify(parseResult.mappedHeaders),
      JSON.stringify({
        total: validation.rows.length,
        valid: validation.totalValid,
        invalid: validation.totalInvalid,
        duplicates: validation.totalDuplicates,
      }),
      batchId,
    ]
  );

  await query(
    `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, after_values)
     VALUES ($1, $2, 'file_uploaded', 'import_batch', $3, $4)`,
    [
      session.membership.company_id,
      session.membership.id,
      batchId,
      JSON.stringify({ filename: file.name, format: ext, rows: validation.rows.length }),
    ]
  );

  const worksheets = ext === ".xlsx" ? listWorksheets(buffer) : undefined;

  return NextResponse.json({
    batchId,
    filename: file.name,
    format: ext.replace(".", ""),
    worksheets,
    selectedWorksheet: parseResult.worksheetName,
    headerRow: parseResult.headerRow,
    mappedHeaders: parseResult.mappedHeaders,
    unmappedHeaders: parseResult.unmappedHeaders,
    warnings: parseResult.warnings,
    counts: {
      total: validation.rows.length,
      valid: validation.totalValid,
      invalid: validation.totalInvalid,
      duplicates: validation.totalDuplicates,
    },
    fieldErrors: validation.fieldErrors,
    sampleRows: validation.rows.slice(0, 5).map((r) => ({
      rowNumber: r.rowNumber,
      alertId: r.parsed.alert_id,
      title: r.parsed.title,
      isValid: r.isValid,
      errors: r.errors,
      warnings: r.warnings,
    })),
  });
}
