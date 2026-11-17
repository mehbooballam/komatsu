import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { matchImportedProducts, unmatchedProductLabels } from "@/lib/import/product-matching";

/**
 * The product inventory: families with their models, plus how many alerts and
 * groups each one is attached to (so deletes can warn about what they affect).
 */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  const includeUsage = hasCompanyWideAccess(auth.role, auth.access_scope);

  const families = await query(
    `SELECT pf.id, pf.name, pf.description, pf.state, pf.created_at,
            CASE WHEN $2 THEN (SELECT COUNT(DISTINCT l.alert_id)::int FROM alert_product_links l
             LEFT JOIN products p2 ON p2.id = l.product_id
             WHERE l.state <> 'rejected' AND (l.family_id = pf.id OR p2.family_id = pf.id)) END AS alert_count,
            CASE WHEN $2 THEN (SELECT COUNT(DISTINCT g.group_id)::int FROM group_product_links g
             LEFT JOIN products p3 ON p3.id = g.product_id
             WHERE g.family_id = pf.id OR p3.family_id = pf.id) END AS group_count,
            COALESCE((
              SELECT json_agg(json_build_object(
                'id', p.id, 'model_code', p.model_code, 'name', p.name, 'description', p.description,
                'is_active', p.is_active,
                'alert_count', CASE WHEN $2 THEN (SELECT COUNT(DISTINCT alert_id) FROM alert_product_links WHERE product_id = p.id AND state <> 'rejected') END,
                'group_count', CASE WHEN $2 THEN (SELECT COUNT(*) FROM group_product_links WHERE product_id = p.id) END
              ) ORDER BY p.name)
              FROM products p WHERE p.family_id = pf.id
            ), '[]'::json) AS products
     FROM product_families pf
     WHERE pf.company_id = $1
     ORDER BY pf.name`,
    [auth.company_id, includeUsage]
  );

  // Product names used in imported alerts that the inventory doesn't have yet
  const unmatched = includeUsage ? await unmatchedProductLabels(auth.company_id) : [];
  return NextResponse.json({ families: families.rows, unmatched });
}

/** Create a product family. */
export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role) || !hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (name.length > 120) return NextResponse.json({ error: "Name must be 120 characters or fewer" }, { status: 400 });

  const existing = await query(
    `SELECT id FROM product_families WHERE company_id = $1 AND LOWER(name) = LOWER($2)`,
    [auth.company_id, name]
  );
  if (existing.rows.length > 0) return NextResponse.json({ error: "A family with this name already exists" }, { status: 409 });

  const res = await query(
    `INSERT INTO product_families (company_id, name, description) VALUES ($1, $2, $3) RETURNING *`,
    [auth.company_id, name, description || null]
  );

  await createAuditEvent(auth.company_id, auth.membership_id, "create", "product_family", res.rows[0].id, null, { name });
  // Alerts whose imported product text names this family get it as a suggestion
  const matched = await matchImportedProducts(auth.company_id);

  return NextResponse.json({ family: res.rows[0], matched }, { status: 201 });
}
