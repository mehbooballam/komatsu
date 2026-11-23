import * as XLSX from "xlsx";
import { normalizeHeader, IMPORT_COLUMNS, type ImportColumnName } from "./constants";

export interface ParsedRow {
  rowNumber: number;
  raw: Record<string, string | null>;
  mapped: Partial<Record<ImportColumnName, string | null>>;
  presentColumns: Set<ImportColumnName>;
}

export interface ParseResult {
  rows: ParsedRow[];
  worksheetName: string;
  headerRow: number;
  detectedHeaders: string[];
  mappedHeaders: Record<string, ImportColumnName | null>;
  unmappedHeaders: string[];
  duplicateHeaders: string[];
  warnings: string[];
}

export interface XlsxParseOptions {
  worksheetName?: string;
  headerRow?: number;
}

function excelDateToISO(serial: number, date1904 = false): string {
  const epoch = date1904
    ? new Date(1904, 0, 1)
    : new Date(1899, 11, 30);
  const msPerDay = 86400000;
  const date = new Date(epoch.getTime() + serial * msPerDay);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function cellToString(cell: XLSX.CellObject | undefined, date1904: boolean): string | null {
  if (!cell) return null;
  if (cell.t === "z") return null; // blank

  if (cell.t === "n" && cell.z && /[ymd]/i.test(String(cell.z))) {
    return excelDateToISO(cell.v as number, date1904);
  }

  if (cell.t === "d" && cell.v instanceof Date) {
    const y = cell.v.getFullYear();
    const m = String(cell.v.getMonth() + 1).padStart(2, "0");
    const d = String(cell.v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  if (cell.w !== undefined) return String(cell.w);
  if (cell.v !== undefined) return String(cell.v);
  return null;
}

export function parseXlsx(
  buffer: Buffer,
  options: XlsxParseOptions = {}
): ParseResult {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    cellNF: true,
    cellText: true,
    raw: false,
  });

  const date1904 = workbook.Workbook?.WBProps?.date1904 ?? false;

  const sheetName =
    options.worksheetName ??
    (workbook.SheetNames.includes("Alerts")
      ? "Alerts"
      : workbook.SheetNames[0]);

  if (!sheetName || !workbook.SheetNames.includes(sheetName)) {
    throw new Error(
      `Worksheet "${sheetName}" not found. Available: ${workbook.SheetNames.join(", ")}`
    );
  }

  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const headerRowIdx = (options.headerRow ?? 1) - 1;

  const warnings: string[] = [];
  const detectedHeaders: string[] = [];
  const mappedHeaders: Record<string, ImportColumnName | null> = {};
  const unmappedHeaders: string[] = [];
  const duplicateHeaders: string[] = [];
  const seenMapped = new Set<ImportColumnName>();

  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddr = XLSX.utils.encode_cell({ r: headerRowIdx, c: col });
    const cell = sheet[cellAddr];
    const rawHeader = cellToString(cell, date1904)?.trim() ?? "";
    if (!rawHeader) continue;

    detectedHeaders.push(rawHeader);
    const mapped = normalizeHeader(rawHeader);

    if (mapped === "skip") {
      mappedHeaders[rawHeader] = null;
    } else if (mapped) {
      if (seenMapped.has(mapped)) {
        duplicateHeaders.push(rawHeader);
        warnings.push(`Duplicate header mapping: "${rawHeader}" maps to "${mapped}" which was already mapped.`);
        mappedHeaders[rawHeader] = null;
      } else {
        seenMapped.add(mapped);
        mappedHeaders[rawHeader] = mapped;
      }
    } else {
      unmappedHeaders.push(rawHeader);
      mappedHeaders[rawHeader] = null;
    }
  }

  if (duplicateHeaders.length > 0) {
    warnings.push(`Duplicate headers detected: ${duplicateHeaders.join(", ")}`);
  }

  const headerColMap: { col: number; rawHeader: string; mapped: ImportColumnName }[] = [];
  let colIdx = 0;
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddr = XLSX.utils.encode_cell({ r: headerRowIdx, c: col });
    const cell = sheet[cellAddr];
    const rawHeader = cellToString(cell, date1904)?.trim() ?? "";
    if (!rawHeader) continue;

    const mapped = mappedHeaders[rawHeader];
    if (mapped) {
      headerColMap.push({ col, rawHeader, mapped });
    }
    colIdx++;
  }

  const rows: ParsedRow[] = [];
  for (let row = headerRowIdx + 1; row <= range.e.r; row++) {
    let isEmptyRow = true;
    const raw: Record<string, string | null> = {};
    const mapped: Partial<Record<ImportColumnName, string | null>> = {};
    const presentColumns = new Set<ImportColumnName>();

    for (const hcm of headerColMap) {
      const cellAddr = XLSX.utils.encode_cell({ r: row, c: hcm.col });
      const cell = sheet[cellAddr];
      const value = cellToString(cell, date1904);

      raw[hcm.rawHeader] = value;
      presentColumns.add(hcm.mapped);

      if (value !== null && value.trim() !== "") {
        isEmptyRow = false;
        mapped[hcm.mapped] = value.trim();
      } else {
        mapped[hcm.mapped] = null;
      }
    }

    if (isEmptyRow) continue;

    rows.push({
      rowNumber: row + 1,
      raw,
      mapped,
      presentColumns,
    });
  }

  return {
    rows,
    worksheetName: sheetName,
    headerRow: headerRowIdx + 1,
    detectedHeaders,
    mappedHeaders,
    unmappedHeaders,
    duplicateHeaders,
    warnings,
  };
}

export function listWorksheets(buffer: Buffer): string[] {
  const workbook = XLSX.read(buffer, { type: "buffer", bookSheets: true });
  return workbook.SheetNames;
}
