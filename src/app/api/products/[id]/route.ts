import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent } from "@/lib/auth-helpers";
import { UUID_RE, canDeleteInventory, deleteInventory } from "@/lib/inventory";

async function findFamily(companyId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  const res = await query(`SELECT * FROM product_families WHERE id = $1 AND company_id = $2`, [id, companyId]);
  return res.rows[0] || null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  const { id } = await params;

  const family = await findFamily(auth.company_id, id);
  if (!family) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const productsRes = await query(
    `SELECT * FROM products WHERE family_id = $1 AND company_id = $2 ORDER BY name`,
    [id, auth.company_id]
  );
  return NextResponse.json({ family, products: productsRes.rows });
}

/**
 * Update a family ({ name?, description?, state? }), or add a model to it
 * ({ action: "add_product", name, model_code?, description? }).
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();
  const { id } = await params;
  const family = await findFamily(auth.company_id, id);
  if (!family) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));

  if (body.action === "add_product") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const modelCode = typeof body.model_code === "string" ? body.model_code.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!name) return NextResponse.json({ error: "Product name is required" }, { status: 400 });
    if (name.length > 120) return NextResponse.json({ error: "Name must be 120 characters or fewer" }, { status: 400 });

    if (modelCode) {
      const existing = await query(`SELECT id FROM products WHERE company_id = $1 AND LOWER(model_code) = LOWER($2)`, [auth.company_id, modelCode]);
      if (existing.rows.length > 0) return NextResponse.json({ error: "Another product already uses this model code" }, { status: 409 });
    }

    const res = await query(
      `INSERT INTO products (company_id, family_id, model_code, name, description)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [auth.company_id, id, modelCode || null, name, description || null]
    );
    await createAuditEvent(auth.company_id, auth.membership_id, "create", "product", res.rows[0].id, null, { name, family_id: id });
    return NextResponse.json({ product: res.rows[0] }, { status: 201 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const description = typeof body.description === "string" ? body.description.trim() : undefined;
  const state = body.state === "active" || body.state === "archived" ? body.state : undefined;

  if (name !== undefined) {
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    if (name.length > 120) return NextResponse.json({ error: "Name must be 120 characters or fewer" }, { status: 400 });
    const dup = await query(
      `SELECT id FROM product_families WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3`,
      [auth.company_id, name, id]
    );
    if (dup.rows.length > 0) return NextResponse.json({ error: "A family with this name already exists" }, { status: 409 });
  }

  const res = await query(
    `UPDATE product_families SET name = COALESCE($1, name),
       description = CASE WHEN $2::text IS NULL THEN description ELSE NULLIF($2::text, '') END,
       state = COALESCE($3, state)
     WHERE id = $4 AND company_id = $5 RETURNING *`,
    [name ?? null, description ?? null, body.action === "archive" ? "archived" : state ?? null, id, auth.company_id]
  );
  await createAuditEvent(auth.company_id, auth.membership_id, "update", "product_family", id,
    { name: family.name, description: family.description, state: family.state },
    { name: res.rows[0].name, description: res.rows[0].description, state: res.rows[0].state });
  return NextResponse.json({ family: res.rows[0] });
}

/** Permanently delete a family and all its models; they are removed from every alert and group. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canDeleteInventory(auth.role)) return forbidden();
  const { id } = await params;
  const family = await findFamily(auth.company_id, id);
  if (!family) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await deleteInventory(auth.company_id, { familyIds: [id] });
  await createAuditEvent(auth.company_id, auth.membership_id, "delete", "product_family", id,
    { name: family.name, models: result.products, alert_links: result.alertLinks }, null);
  return NextResponse.json({ success: true, ...result });
}
