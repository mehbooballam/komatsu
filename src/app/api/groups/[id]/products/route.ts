import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { groupProducts, resolveTarget } from "@/lib/products";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findGroup(companyId: string, id: string) {
  if (!UUID_RE.test(id)) return false;
  const res = await query(`SELECT 1 FROM regulation_groups WHERE id = $1 AND company_id = $2 AND state <> 'archived'`, [id, companyId]);
  return res.rows.length > 0;
}

/** Products attached directly to this group. Alerts in it and its sub-groups inherit them. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  const { id } = await params;
  if (!(await findGroup(auth.company_id, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const map = await groupProducts(auth.company_id, [id]);
  return NextResponse.json({ products: map.get(id) || [] });
}

/** POST { family_id | product_id } */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  if (!canEdit(auth.role)) return forbidden();
  const { id } = await params;
  if (!(await findGroup(auth.company_id, id))) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  const target = await resolveTarget(auth.company_id, await request.json().catch(() => ({})));
  if ("error" in target) return NextResponse.json(target, { status: 400 });
  const col = target.kind === "family" ? "family_id" : "product_id";

  await query(
    `INSERT INTO group_product_links (company_id, group_id, ${col}, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (group_id, COALESCE(family_id, product_id)) DO NOTHING`,
    [auth.company_id, id, target.id, auth.membership_id]
  );
  await createAuditEvent(auth.company_id, auth.membership_id, "attach_product", "regulation_group", id, null, { [col]: target.id });
  return NextResponse.json({ success: true });
}

/** DELETE ?family_id=… or ?product_id=… */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  if (!canEdit(auth.role)) return forbidden();
  const { id } = await params;
  if (!(await findGroup(auth.company_id, id))) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  const sp = request.nextUrl.searchParams;
  const familyId = sp.get("family_id");
  const productId = sp.get("product_id");
  if (!!familyId === !!productId) return NextResponse.json({ error: "Choose one product family or one product" }, { status: 400 });
  const col = familyId ? "family_id" : "product_id";
  const targetId = (familyId || productId)!;
  if (!UUID_RE.test(targetId)) return NextResponse.json({ error: "Product not found" }, { status: 400 });

  await query(`DELETE FROM group_product_links WHERE company_id = $1 AND group_id = $2 AND ${col} = $3`, [auth.company_id, id, targetId]);
  await createAuditEvent(auth.company_id, auth.membership_id, "detach_product", "regulation_group", id, { [col]: targetId }, null);
  return NextResponse.json({ success: true });
}
