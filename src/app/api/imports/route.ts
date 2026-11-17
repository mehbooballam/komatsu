import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { canImport, forbidden, getAuth, unauthorized } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canImport(auth.role)) return forbidden();

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const requestedLimit = Number(url.searchParams.get("limit") ?? "20");
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    return NextResponse.json({ error: "Page and limit must be positive integers" }, { status: 400 });
  }
  const limit = Math.min(requestedLimit, 100);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    return NextResponse.json({ error: "Page is out of range" }, { status: 400 });
  }

  const countResult = await query(
    `SELECT COUNT(*) FROM import_batches WHERE company_id = $1`,
    [auth.company_id]
  );
  const total = parseInt(countResult.rows[0].count);

  const result = await query(
    `SELECT ib.id, ib.original_filename, ib.input_format, ib.status,
            ib.selected_worksheet, ib.row_counts, ib.created_at,
            ib.completed_at, ib.report_date, ib.error_summary,
            u.display_name as uploader_name,
            f.dataset_key, f.provider_name
     FROM import_batches ib
     JOIN memberships m ON m.id = ib.uploader_membership_id
     JOIN user_profiles u ON u.id = m.user_id
     JOIN feeds f ON f.id = ib.feed_id
     WHERE ib.company_id = $1
     ORDER BY ib.created_at DESC
     LIMIT $2 OFFSET $3`,
    [auth.company_id, limit, offset]
  );

  return NextResponse.json({
    imports: result.rows.map((r) => ({
      id: r.id,
      filename: r.original_filename,
      format: r.input_format,
      worksheet: r.selected_worksheet,
      status: r.status,
      rowCounts: r.row_counts,
      reportDate: r.report_date,
      errorSummary: r.error_summary,
      uploaderName: r.uploader_name,
      dataset: r.dataset_key,
      provider: r.provider_name,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
