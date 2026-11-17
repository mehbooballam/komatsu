import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { UUID_RE, canDeleteInventory, deleteInventory } from "@/lib/inventory";
import { matchImportedProducts } from "@/lib/import/product-matching";

type Params = { params: Promise<{ id: string; modelId: string }> };

async function findModel(companyId: string, familyId: string, modelId: string) {
  if (!UUID_RE.test(familyId) || !UUID_RE.test(modelId)) return null;
  const res = await query(`SELECT * FROM products WHERE id = $1 AND family_id = $2 AND company_id = $3`, [modelId, familyId, companyId]);
  return res.rows[0] || null;
}

/** Update a model: { name?, model_code?, description?, is_active?, family_id? (move to another family) } */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role) || !hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  const { id, modelId } = await params;
  const model = await findModel(auth.company_id, id, modelId);
  if (!model) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));

  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const modelCode = typeof body.model_code === "string" ? body.model_code.trim() : undefined;
  const description = typeof body.description === "string" ? body.description.trim() : undefined;
  const isActive = typeof body.is_active === "boolean" ? body.is_active : undefined;
  const familyId = typeof body.family_id === "string" ? body.family_id : undefined;

  if (name !== undefined && !name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (name && name.length > 120) return NextResponse.json({ error: "Name must be 120 characters or fewer" }, { status: 400 });
  if (modelCode) {
    const dup = await query(
      `SELECT id FROM products WHERE company_id = $1 AND LOWER(model_code) = LOWER($2) AND id <> $3`,
      [auth.company_id, modelCode, modelId]
    );
    if (dup.rows.length > 0) return NextResponse.json({ error: "Another product already uses this model code" }, { status: 409 });
  }
  if (familyId !== undefined) {
    if (!UUID_RE.test(familyId)) return NextResponse.json({ error: "Family not found" }, { status: 400 });
    const fam = await query(`SELECT 1 FROM product_families WHERE id = $1 AND company_id = $2`, [familyId, auth.company_id]);
    if (fam.rows.length === 0) return NextResponse.json({ error: "Family not found" }, { status: 400 });
  }

  const res = await query(
    `UPDATE products SET
       name = COALESCE($1, name),
       model_code = CASE WHEN $2::text IS NULL THEN model_code ELSE NULLIF($2::text, '') END,
       description = CASE WHEN $3::text IS NULL THEN description ELSE NULLIF($3::text, '') END,
       is_active = COALESCE($4, is_active),
       family_id = COALESCE($5, family_id)
     WHERE id = $6 AND company_id = $7 RETURNING *`,
    [name ?? null, modelCode ?? null, description ?? null, isActive ?? null, familyId ?? null, modelId, auth.company_id]
  );
  await createAuditEvent(auth.company_id, auth.membership_id, "update", "product", modelId,
    { name: model.name, model_code: model.model_code, is_active: model.is_active, family_id: model.family_id },
    { name: res.rows[0].name, model_code: res.rows[0].model_code, is_active: res.rows[0].is_active, family_id: res.rows[0].family_id });
  if (name !== undefined || modelCode !== undefined || isActive !== undefined) await matchImportedProducts(auth.company_id);
  return NextResponse.json({ product: res.rows[0] });
}

/** Permanently delete a model; it is removed from every alert and group. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canDeleteInventory(auth.role)) return forbidden();
  const { id, modelId } = await params;
  const model = await findModel(auth.company_id, id, modelId);
  if (!model) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await deleteInventory(auth.company_id, { productIds: [modelId] });
  await createAuditEvent(auth.company_id, auth.membership_id, "delete", "product", modelId,
    { name: model.name, model_code: model.model_code, family_id: id, alert_links: result.alertLinks }, null);
  return NextResponse.json({ success: true, ...result });
}
