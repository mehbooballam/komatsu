import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";

export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();

  const res = await query(
    `SELECT tl.*, (SELECT COUNT(*) FROM alert_tags at2 WHERE at2.tag_id = tl.id) as usage_count
     FROM tag_labels tl WHERE tl.company_id = $1 ORDER BY tl.name`,
    [auth.company_id]
  );

  return NextResponse.json({ tags: res.rows });
}

export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  if (!canEdit(auth.role)) return forbidden();

  const body = await request.json();
  const { name, color } = body;
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const normalized = name.trim().toLowerCase().replace(/\s+/g, "-");

  const res = await query(
    `INSERT INTO tag_labels (company_id, name, normalized_name, color)
     VALUES ($1, $2, $3, $4) ON CONFLICT (company_id, normalized_name) DO NOTHING RETURNING *`,
    [auth.company_id, name.trim(), normalized, color || "#6b7280"]
  );

  if (res.rows.length === 0) return NextResponse.json({ error: "Tag already exists" }, { status: 409 });

  return NextResponse.json({ tag: res.rows[0] }, { status: 201 });
}
