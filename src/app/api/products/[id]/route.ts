import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent } from "@/lib/auth-helpers";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  const { id } = await params;

  const familyRes = await query(
    `SELECT * FROM product_families WHERE id = $1 AND company_id = $2`,
    [id, auth.company_id]
  );
  if (familyRes.rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const productsRes = await query(
    `SELECT * FROM products WHERE family_id = $1 AND company_id = $2 ORDER BY name`,
    [id, auth.company_id]
  );

  return NextResponse.json({ family: familyRes.rows[0], products: productsRes.rows });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();
  const { id } = await params;
  const body = await request.json();

  if (body.action === "add_product") {
    const { model_code, name, description } = body;
    if (!name?.trim()) return NextResponse.json({ error: "Product name is required" }, { status: 400 });

    if (model_code) {
      const existing = await query(
        `SELECT id FROM products WHERE company_id = $1 AND model_code = $2`,
        [auth.company_id, model_code]
      );
      if (existing.rows.length > 0) return NextResponse.json({ error: "Model code already exists" }, { status: 409 });
    }

    const res = await query(
      `INSERT INTO products (company_id, family_id, model_code, name, description)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [auth.company_id, id, model_code || null, name.trim(), description || null]
    );

    await createAuditEvent(auth.company_id, auth.membership_id, "create", "product", res.rows[0].id, null, { name, family_id: id });

    return NextResponse.json({ product: res.rows[0] }, { status: 201 });
  }

  if (body.action === "archive") {
    await query(`UPDATE product_families SET state = 'archived' WHERE id = $1 AND company_id = $2`, [id, auth.company_id]);
    await createAuditEvent(auth.company_id, auth.membership_id, "archive", "product_family", id);
    return NextResponse.json({ success: true });
  }

  const { name, description, state } = body;
  const res = await query(
    `UPDATE product_families SET name = COALESCE($1, name), description = COALESCE($2, description), state = COALESCE($3, state)
     WHERE id = $4 AND company_id = $5 RETURNING *`,
    [name, description, state, id, auth.company_id]
  );
  if (res.rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ family: res.rows[0] });
}
