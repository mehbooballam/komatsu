import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit } from "@/lib/auth-helpers";
import { ALERT_UUID, alertNotFound, canAccessAlert } from "@/lib/alerts/access";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  const { id } = await params;
  if (!(await canAccessAlert(auth, id))) return alertNotFound();

  const res = await query(
    `SELECT tl.id, tl.name, tl.color, at2.origin
     FROM alert_tags at2 JOIN tag_labels tl ON tl.id = at2.tag_id AND tl.company_id = at2.company_id
     WHERE at2.alert_id = $1 AND at2.company_id = $2
     ORDER BY tl.name`,
    [id, auth.company_id]
  );

  return NextResponse.json({ tags: res.rows });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();
  const { id } = await params;
  const body = await request.json();
  if (!(await canAccessAlert(auth, id))) return alertNotFound();
  if (typeof body.tag_id !== "string" || !ALERT_UUID.test(body.tag_id)) {
    return NextResponse.json({ error: "tag_id required" }, { status: 400 });
  }
  const tag = await query(`SELECT 1 FROM tag_labels WHERE id = $1 AND company_id = $2`, [body.tag_id, auth.company_id]);
  if (!tag.rowCount) return NextResponse.json({ error: "Tag not found" }, { status: 404 });

  const res = await query(
    `INSERT INTO alert_tags (company_id, alert_id, tag_id, origin)
     VALUES ($1, $2, $3, 'local') ON CONFLICT (alert_id, tag_id) DO NOTHING RETURNING *`,
    [auth.company_id, id, body.tag_id]
  );

  return NextResponse.json({ tag: res.rows[0] || null }, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();
  const { id } = await params;
  if (!(await canAccessAlert(auth, id))) return alertNotFound();
  const { searchParams } = new URL(request.url);
  const tagId = searchParams.get("tag_id");
  if (!tagId || !ALERT_UUID.test(tagId)) return NextResponse.json({ error: "tag_id required" }, { status: 400 });

  await query(`DELETE FROM alert_tags WHERE alert_id = $1 AND tag_id = $2 AND company_id = $3`, [id, tagId, auth.company_id]);

  return NextResponse.json({ success: true });
}
