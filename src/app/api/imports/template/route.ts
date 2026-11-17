import { NextRequest, NextResponse } from "next/server";
import { generateXlsxTemplate, generateCsvTemplate } from "@/lib/import/template-generator";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "xlsx";

  if (format === "xlsx") {
    const buffer = generateXlsxTemplate();
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="komatsu_import_template.xlsx"',
      },
    });
  }

  if (format === "csv") {
    const csv = generateCsvTemplate();
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="komatsu_import_template.csv"',
      },
    });
  }

  return NextResponse.json({ error: "Invalid format. Use xlsx or csv." }, { status: 400 });
}
