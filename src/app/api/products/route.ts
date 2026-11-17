import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent } from "@/lib/auth-helpers";

export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();

  const families = await query(
    `SELECT pf.*,
            (SELECT json_agg(json_build_object('id', p.id, 'model_code', p.model_code, 'name', p.name, 'description', p.description, 'is_active', p.is_active)
             ORDER BY p.name)
             FROM products p WHERE p.family_id = pf.id) as products
     FROM product_families pf
     WHERE pf.company_id = $1
     ORDER BY pf.name`,
    [auth.company_id]
  );

  return NextResponse.json({ families: families.rows });
}

export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();

  const body = await request.json();
  const { name, description } = body;

  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const existing = await query(
    `SELECT id FROM product_families WHERE company_id = $1 AND LOWER(name) = LOWER($2)`,
    [auth.company_id, name.trim()]
  );
  if (existing.rows.length > 0) return NextResponse.json({ error: "A family with this name already exists" }, { status: 409 });

  const res = await query(
    `INSERT INTO product_families (company_id, name, description) VALUES ($1, $2, $3) RETURNING *`,
    [auth.company_id, name.trim(), description || null]
  );

  await createAuditEvent(auth.company_id, auth.membership_id, "create", "product_family", res.rows[0].id, null, { name });

  return NextResponse.json({ family: res.rows[0] }, { status: 201 });
}
