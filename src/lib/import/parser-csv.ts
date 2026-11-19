import { parse } from "csv-parse/sync";
import { normalizeHeader, type ImportColumnName } from "./constants";
import type { ParsedRow, ParseResult } from "./parser-xlsx";

export function parseCsv(buffer: Buffer): ParseResult {
  let content = buffer.toString("utf-8");
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const records: string[][] = parse(content, {
    relax_column_count: true,
    skip_empty_lines: false,
    trim: false,
    quote: '"',
    escape: '"',
    delimiter: ",",
  });

  if (records.length === 0) {
    throw new Error("CSV file is empty");
  }

  const rawHeaders = records[0].map((h) => h.trim());
  const warnings: string[] = [];
  const detectedHeaders: string[] = [];
  const mappedHeaders: Record<string, ImportColumnName | null> = {};
  const unmappedHeaders: string[] = [];
  const duplicateHeaders: string[] = [];
  const seenMapped = new Set<ImportColumnName>();

  const headerColMap: { col: number; rawHeader: string; mapped: ImportColumnName | null }[] = [];
  const seenHeaders = new Set<string>();

  for (let i = 0; i < rawHeaders.length; i++) {
    const rawHeader = rawHeaders[i];
    if (!rawHeader || seenHeaders.has(rawHeader)) continue;
    seenHeaders.add(rawHeader);

    detectedHeaders.push(rawHeader);
    const mapped = normalizeHeader(rawHeader);

    if (mapped) {
      if (seenMapped.has(mapped)) {
        duplicateHeaders.push(rawHeader);
        warnings.push(`Duplicate header mapping: "${rawHeader}" maps to "${mapped}" which was already mapped.`);
        mappedHeaders[rawHeader] = null;
      } else {
        seenMapped.add(mapped);
        mappedHeaders[rawHeader] = mapped;
        headerColMap.push({ col: i, rawHeader, mapped });
      }
    } else {
      unmappedHeaders.push(rawHeader);
      mappedHeaders[rawHeader] = null;
    }
    // Keep the raw value of every column, mapped or not
    if (!headerColMap.some((h) => h.rawHeader === rawHeader)) headerColMap.push({ col: i, rawHeader, mapped: mappedHeaders[rawHeader] });
  }

  const rows: ParsedRow[] = [];
  for (let rowIdx = 1; rowIdx < records.length; rowIdx++) {
    const record = records[rowIdx];
    let isEmptyRow = true;
    const raw: Record<string, string | null> = {};
    const mapped: Partial<Record<ImportColumnName, string | null>> = {};
    const presentColumns = new Set<ImportColumnName>();

    for (const hcm of headerColMap) {
      const value = hcm.col < record.length ? record[hcm.col] : undefined;
      const trimmed = value === undefined ? "" : value.trim();
      raw[hcm.rawHeader] = value === undefined ? null : value;
      if (trimmed !== "") isEmptyRow = false;
      if (!hcm.mapped) continue;
      presentColumns.add(hcm.mapped);
      mapped[hcm.mapped] = trimmed !== "" ? trimmed : null;
    }

    if (isEmptyRow) continue;

    rows.push({
      rowNumber: rowIdx + 1,
      raw,
      mapped,
      presentColumns,
    });
  }

  return {
    rows,
    headers: headerColMap.map((h) => h.rawHeader),
    worksheetName: "CSV",
    headerRow: 1,
    detectedHeaders,
    mappedHeaders,
    unmappedHeaders,
    duplicateHeaders,
    warnings,
  };
}
