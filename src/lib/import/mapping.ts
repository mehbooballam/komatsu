import crypto from "crypto";
import { query } from "@/lib/db";
import {
  COLUMN_DEFS,
  COLUMN_STORAGE,
  IMPORT_COLUMNS,
  LEGACY_COLUMNS,
  NOT_IMPORTED,
  isV1WasColumn,
  aliasTarget,
  normalizeHeader,
  type ImportColumnName,
} from "./constants";
import type { ParsedRow } from "./parser-xlsx";
import { validateRows, type ValidationResult } from "./validator";

/** { file header → import field, or null = not imported } */
export type ColumnMapping = Record<string, ImportColumnName | null>;

export interface MappingProfile {
  id: string;
  name: string;
  headers: string[];
  mapping: ColumnMapping;
  updated_at: string;
  last_used_at: string | null;
}

const norm = (h: string) => h.toLowerCase().trim().replace(/\s+/g, " ");

/** Same set of columns (order and case ignored) → same signature. */
export function headerSignature(headers: string[]): string {
  const key = [...new Set(headers.map(norm))].sort().join("\n");
  return crypto.createHash("sha256").update(key).digest("hex");
}

/** Mapping from header names alone (aliases); a field is used once, first column wins. */
export function autoMapping(headers: string[]): ColumnMapping {
  const out: ColumnMapping = {};
  const used = new Set<ImportColumnName>();
  for (const h of headers) {
    const col = normalizeHeader(h);
    if (col && !used.has(col)) {
      out[h] = col;
      used.add(col);
    } else {
      out[h] = null;
    }
  }
  return out;
}

/** Fields that can be chosen as a mapping target. */
export const MAPPABLE = new Set<ImportColumnName>(IMPORT_COLUMNS.filter((c) => !NOT_IMPORTED.has(c)));

/** Problems that block the import (empty = the mapping is usable). */
export function mappingProblems(mapping: ColumnMapping): string[] {
  const problems: string[] = [];
  const seen = new Map<ImportColumnName, string>();
  for (const [header, col] of Object.entries(mapping)) {
    if (!col) continue;
    if (!MAPPABLE.has(col)) {
      problems.push(`“${header}” is mapped to ${col}, which can't be imported.`);
      continue;
    }
    const other = seen.get(col);
    if (other) problems.push(`“${other}” and “${header}” are both mapped to ${labelOf(col)}.`);
    else seen.set(col, header);
  }
  for (const req of COLUMN_DEFS.filter((d) => d.required)) {
    if (!seen.has(req.name)) problems.push(`Map a column to ${req.label} — it is required.`);
  }
  return problems;
}

export function labelOf(col: ImportColumnName) {
  return COLUMN_DEFS.find((d) => d.name === col)?.label ?? col;
}

/** Keep only known headers and valid targets. */
export function cleanMapping(input: unknown, headers: string[]): ColumnMapping {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const out: ColumnMapping = {};
  for (const h of headers) {
    const v = src[h];
    out[h] = typeof v === "string" && (IMPORT_COLUMNS as readonly string[]).includes(v) ? (v as ImportColumnName) : null;
  }
  return out;
}

/** Rebuild parsed rows from the stored raw values with a (new) mapping. */
export function rowsFromRaw(
  raws: Array<{ row_number: number; raw_payload: Record<string, string | null> | null }>,
  mapping: ColumnMapping
): ParsedRow[] {
  return raws.map((r) => {
    const raw = r.raw_payload || {};
    const mapped: ParsedRow["mapped"] = {};
    const presentColumns = new Set<ImportColumnName>();
    for (const [header, col] of Object.entries(mapping)) {
      if (!col) continue;
      presentColumns.add(col);
      const value = raw[header];
      mapped[col] = typeof value === "string" ? value.trim() || null : value ?? null;
    }
    return { rowNumber: r.row_number, raw, mapped, presentColumns };
  });
}

/** Saved mapping for these headers: exact column set first, otherwise the closest one covering ≥ 80% of the file's columns. */
export async function findSavedMapping(companyId: string, headers: string[]): Promise<MappingProfile | null> {
  const res = await query(
    `SELECT id, name, headers, signature, mapping, updated_at, last_used_at
     FROM import_mapping_profiles WHERE company_id = $1`,
    [companyId]
  );
  if (!res.rows.length) return null;
  const sig = headerSignature(headers);
  const exact = res.rows.find((r) => r.signature === sig);
  if (exact) return exact;
  const mine = new Set(headers.map(norm));
  let best: { row: MappingProfile; score: number } | null = null;
  for (const r of res.rows) {
    const theirs = new Set<string>((r.headers as string[]).map(norm));
    const shared = [...mine].filter((h) => theirs.has(h)).length;
    const score = shared / Math.max(mine.size, theirs.size);
    if (score >= 0.8 && (!best || score > best.score)) best = { row: r, score };
  }
  return best?.row ?? null;
}

/** Saved choices for headers the profile knows; automatic mapping for any new header. */
export function mergeWithProfile(headers: string[], profile: MappingProfile | null): ColumnMapping {
  const auto = autoMapping(headers);
  if (!profile) return auto;
  const saved = new Map(Object.entries(profile.mapping || {}).map(([h, c]) => [norm(h), c]));
  const out: ColumnMapping = {};
  const used = new Set<ImportColumnName>();
  // Saved choices first, so an automatic guess never takes a field the saved mapping uses
  for (const h of headers) {
    if (!saved.has(norm(h))) continue;
    const c = saved.get(norm(h)) as ImportColumnName | null;
    out[h] = c && MAPPABLE.has(c) && !used.has(c) ? c : null;
    if (out[h]) used.add(out[h]!);
  }
  for (const h of headers) {
    if (h in out) continue;
    const c = auto[h];
    out[h] = c && !used.has(c) ? c : null;
    if (out[h]) used.add(out[h]!);
  }
  return out;
}

/** Re-validates a batch's rows with its mapping and saves the results (preview counts and errors). */
export async function revalidateBatch(batchId: string, mapping: ColumnMapping): Promise<ValidationResult> {
  const rowsRes = await query(
    `SELECT row_number, raw_payload FROM import_rows WHERE batch_id = $1 ORDER BY row_number`,
    [batchId]
  );
  const validation = validateRows(rowsFromRaw(rowsRes.rows, mapping));
  // One statement for all rows
  await query(
    `UPDATE import_rows ir SET
       external_alert_id = v.external_alert_id,
       validation = v.validation,
       state = v.state::import_row_state
     FROM jsonb_to_recordset($2::jsonb) AS v(row_number int, external_alert_id text, validation jsonb, state text)
     WHERE ir.batch_id = $1 AND ir.row_number = v.row_number`,
    [
      batchId,
      JSON.stringify(
        validation.rows.map((r) => ({
          row_number: r.rowNumber,
          external_alert_id: (r.parsed.alert_id as string) || null,
          validation: { errors: r.errors, warnings: r.warnings },
          state: r.isValid ? "valid" : "invalid",
        }))
      ),
    ]
  );
  await query(
    `UPDATE import_batches SET column_mapping = $2, row_counts = $3 WHERE id = $1`,
    [
      batchId,
      JSON.stringify(mapping),
      JSON.stringify({
        total: validation.rows.length,
        valid: validation.totalValid,
        invalid: validation.totalInvalid,
        duplicates: validation.totalDuplicates,
      }),
    ]
  );
  return validation;
}

/** Field list for the mapping picker: label, type, where it is stored, and whether it can be chosen. */
export function mappingTargets() {
  return COLUMN_DEFS.map((d) => ({
    name: d.name,
    label: d.label,
    type: d.type,
    required: d.required,
    description: d.description,
    stored: COLUMN_STORAGE[d.name],
    legacy: LEGACY_COLUMNS.has(d.name),
    disabled: NOT_IMPORTED.has(d.name),
  }));
}

/** Why a header is not mapped automatically, when there is a reason worth showing. */
export function skipReason(header: string): string | null {
  const t = aliasTarget(header);
  if (isV1WasColumn(header)) return "Old v1 snapshot column — not imported";
  if (t && NOT_IMPORTED.has(t)) return "Not imported";
  return null;
}

/** Headers of a stored batch in file order (older batches only have the mapping keys). */
export function batchHeaders(batch: { file_headers?: unknown; column_mapping?: unknown }): string[] {
  if (Array.isArray(batch.file_headers)) return batch.file_headers.filter((h): h is string => typeof h === "string");
  return Object.keys((batch.column_mapping as Record<string, unknown>) || {});
}
