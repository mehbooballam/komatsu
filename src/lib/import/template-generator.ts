import * as XLSX from "xlsx";
import { COLUMN_DEFS as ALL_COLUMN_DEFS, IMPORT_COLUMNS, type ColumnDef } from "./constants";

const COLUMN_DEFS: ColumnDef[] = IMPORT_COLUMNS.map((c) => ALL_COLUMN_DEFS.find((d) => d.name === c)).filter((d): d is ColumnDef => !!d);

export function generateXlsxTemplate(): Buffer {
  const wb = XLSX.utils.book_new();

  const alertsData = [IMPORT_COLUMNS.map((c) => c)];
  const alertsWs = XLSX.utils.aoa_to_sheet(alertsData);

  const colWidths = IMPORT_COLUMNS.map((col) => {
    const def = COLUMN_DEFS.find((d) => d.name === col);
    return { wch: Math.max((def?.label.length ?? col.length) + 4, 18) };
  });
  alertsWs["!cols"] = colWidths;

  XLSX.utils.book_append_sheet(wb, alertsWs, "Alerts");

  const defRows = [
    ["Column Name", "Label", "Type", "Required", "Description"],
    ...COLUMN_DEFS.map((d) => [
      d.name,
      d.label,
      d.type,
      d.required ? "Yes" : "No",
      d.description,
    ]),
  ];
  const defWs = XLSX.utils.aoa_to_sheet(defRows);
  defWs["!cols"] = [
    { wch: 30 },
    { wch: 30 },
    { wch: 18 },
    { wch: 10 },
    { wch: 60 },
  ];
  XLSX.utils.book_append_sheet(wb, defWs, "Field definitions");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buf);
}

export function generateCsvTemplate(): string {
  return IMPORT_COLUMNS.join(",") + "\n";
}
