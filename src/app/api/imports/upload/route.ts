import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { query } from "@/lib/db";
import { canImport, forbidden, getAuth, unauthorized } from "@/lib/auth-helpers";
import { parseXlsx, listWorksheets } from "@/lib/import/parser-xlsx";
import { parseCsv } from "@/lib/import/parser-csv";
import { validateRows } from "@/lib/import/validator";
import { findSavedMapping, mergeWithProfile, rowsFromRaw } from "@/lib/import/mapping";

export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canImport(auth.role)) return forbidden();

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid upload form" }, { status: 400 });
  }
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0 || !file.name || file.name.includes("\0")) {
    return NextResponse.json({ error: "Select a non-empty file with a valid name" }, { status: 400 });
  }

  const ext = path.extname(file.name).toLowerCase();
  if (ext !== ".xlsx" && ext !== ".csv") {
    return NextResponse.json(
      { error: "Unsupported file type. Use .xlsx or .csv" },
      { status: 400 }
    );
  }

  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 50 MB)" }, { status: 413 });
  }

  const worksheetName = formData.get("worksheet");
  if (worksheetName !== null && (typeof worksheetName !== "string" || worksheetName.includes("\0"))) {
    return NextResponse.json({ error: "Invalid worksheet name" }, { status: 400 });
  }

  const headerRowValue = formData.get("headerRow") ?? "1";
  const headerRow = Number(headerRowValue);
  if (typeof headerRowValue !== "string" || !/^\d+$/.test(headerRowValue) || headerRow < 1 || headerRow > 1_048_576) {
    return NextResponse.json({ error: "Invalid header row number" }, { status: 400 });
  }
  if (ext === ".csv" && (worksheetName || headerRow !== 1)) {
    return NextResponse.json({ error: "CSV files use the first row as the header and have no worksheets" }, { status: 400 });
  }

  const reportDate = formData.get("reportDate");
  if (reportDate !== null && reportDate !== "") {
    if (typeof reportDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || reportDate.startsWith("0000")) {
      return NextResponse.json({ error: "Report date must use YYYY-MM-DD" }, { status: 400 });
    }
    const parsedDate = new Date(`${reportDate}T00:00:00Z`);
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== reportDate) {
      return NextResponse.json({ error: "Report date must be a valid calendar date" }, { status: 400 });
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const digest = crypto.createHash("sha256").update(buffer).digest("hex");

  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  const uploadId = crypto.randomUUID();
  const objectKey = `${auth.company_id}/${uploadId}${ext}`;
  const filePath = path.join(uploadDir, objectKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer, { flag: "wx", mode: 0o600 });

  const feedResult = await query(
    `SELECT id FROM feeds WHERE company_id = $1 AND dataset_key = 'daptic-default' LIMIT 1`,
    [auth.company_id]
  );

  let feedId: string;
  if (feedResult.rows.length === 0) {
    const newFeed = await query(
      `INSERT INTO feeds (company_id, provider_name, dataset_key, name)
       VALUES ($1, 'Daptic', 'daptic-default', 'Daptic Alert Feed')
       RETURNING id`,
      [auth.company_id]
    );
    feedId = newFeed.rows[0].id;
  } else {
    feedId = feedResult.rows[0].id;
  }

  const idempotencyKey = `${digest}-${uploadId}`;

  const batchResult = await query(
    `INSERT INTO import_batches (
       company_id, feed_id, uploader_membership_id, input_format,
       original_filename, selected_worksheet, header_row, object_key,
       digest, idempotency_key, status, report_date
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'validating', $11)
     RETURNING id`,
    [
      auth.company_id,
      feedId,
      auth.membership_id,
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
  let worksheets: string[] | undefined;
  try {
    if (ext === ".xlsx") {
      worksheets = listWorksheets(buffer);
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

  // Column mapping: a saved mapping for this file layout if there is one, otherwise from the header names
  const headers = parseResult.headers;
  const profile = await findSavedMapping(auth.company_id, headers);
  const mapping = mergeWithProfile(headers, profile);
  const validation = validateRows(
    rowsFromRaw(parseResult.rows.map((r) => ({ row_number: r.rowNumber, raw_payload: r.raw })), mapping)
  );

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
    `UPDATE import_batches SET status = 'previewing', selected_worksheet = $4,
     column_mapping = $1,
     row_counts = $2,
     file_headers = $5,
     mapping_profile_id = $6
     WHERE id = $3`,
    [
      JSON.stringify(mapping),
      JSON.stringify({
        total: validation.rows.length,
        valid: validation.totalValid,
        invalid: validation.totalInvalid,
        duplicates: validation.totalDuplicates,
      }),
      batchId,
      ext === ".xlsx" ? parseResult.worksheetName : null,
      JSON.stringify(headers),
      profile?.id ?? null,
    ]
  );

  await query(
    `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, after_values)
     VALUES ($1, $2, 'file_uploaded', 'import_batch', $3, $4)`,
    [
      auth.company_id,
      auth.membership_id,
      batchId,
      JSON.stringify({ filename: file.name, format: ext, rows: validation.rows.length }),
    ]
  );

  return NextResponse.json({
    batchId,
    filename: file.name,
    format: ext.replace(".", ""),
    worksheets,
    selectedWorksheet: parseResult.worksheetName,
    headerRow: parseResult.headerRow,
    mappedHeaders: mapping,
    unmappedHeaders: headers.filter((h) => !mapping[h]),
    savedMapping: profile ? { id: profile.id, name: profile.name } : null,
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
