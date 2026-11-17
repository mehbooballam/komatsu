import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent, type AuthContext } from "@/lib/auth-helpers";
import { alertProducts, resolveTarget } from "@/lib/products";
import { ALERT_UUID, accessibleAlertIds, alertNotFound, canAccessAlert } from "@/lib/alerts/access";

const MAX_ALERTS = 500;

/** GET ?alert_id=… — products that apply to an alert (its own plus those from its groups). */
export async function GET(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  const alertId = request.nextUrl.searchParams.get("alert_id") || "";
  if (!ALERT_UUID.test(alertId)) return NextResponse.json({ error: "alert_id required" }, { status: 400 });
  if (!(await canAccessAlert(auth, alertId))) return alertNotFound();
  const map = await alertProducts(auth.company_id, [alertId]);
  return NextResponse.json({ products: map.get(alertId) || [] });
}

/** Validates the body's alert_ids against the caller's alert access. */
async function readAlertIds(auth: AuthContext, raw: unknown): Promise<string[] | { error: string }> {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "alert_ids required" };
  if (raw.length > MAX_ALERTS) return { error: `At most ${MAX_ALERTS} alerts at a time` };
  const ids = [...new Set(raw.filter((x): x is string => typeof x === "string" && ALERT_UUID.test(x)).map((x) => x.toLowerCase()))];
  if (ids.length !== raw.length) return { error: "Invalid alert id" };
  const accessible = await accessibleAlertIds(auth, ids);
  if (accessible.length !== ids.length) return { error: "Alert not found" };
  return ids;
}

/** POST { alert_ids, family_id | product_id } — attach a product from the inventory. */
export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();
  const body = await request.json().catch(() => ({}));

  const ids = await readAlertIds(auth, body.alert_ids);
  if (!Array.isArray(ids)) return NextResponse.json(ids, { status: 400 });
  const target = await resolveTarget(auth.company_id, body);
  if ("error" in target) return NextResponse.json(target, { status: 400 });
  const col = target.kind === "family" ? "family_id" : "product_id";

  // Re-confirm an existing link (suggested or previously removed) …
  const updated = await query(
    `UPDATE alert_product_links SET state = 'confirmed', confirmed_by = $1, confirmed_at = now()
     WHERE company_id = $2 AND alert_id = ANY($3::uuid[]) AND ${col} = $4
     RETURNING alert_id`,
    [auth.membership_id, auth.company_id, ids, target.id]
  );
  const done = new Set(updated.rows.map((r) => r.alert_id));
  // … and create one where there is none
  const missing = ids.filter((id) => !done.has(id));
  if (missing.length) {
    await query(
      `INSERT INTO alert_product_links (company_id, alert_id, ${col}, state, origin, confirmed_by, confirmed_at, reason)
       SELECT $1, x, $2, 'confirmed', 'manual', $3, now(), 'Attached manually'
       FROM unnest($4::uuid[]) AS x`,
      [auth.company_id, target.id, auth.membership_id, missing]
    );
  }

  for (const id of ids) {
    await createAuditEvent(auth.company_id, auth.membership_id, "attach_product", "alert", id, null, {
      alert_id: id,
      [col]: target.id,
    });
  }
  return NextResponse.json({ success: true, attached: ids.length });
}

/** DELETE { alert_ids, family_id | product_id } — detach. Import suggestions are kept as rejected so a re-import doesn't bring them back. */
export async function DELETE(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();
  const body = await request.json().catch(() => ({}));

  const ids = await readAlertIds(auth, body.alert_ids);
  if (!Array.isArray(ids)) return NextResponse.json(ids, { status: 400 });
  const familyId = typeof body.family_id === "string" ? body.family_id : null;
  const productId = typeof body.product_id === "string" ? body.product_id : null;
  if (!!familyId === !!productId) return NextResponse.json({ error: "Choose one product family or one product" }, { status: 400 });
  const col = familyId ? "family_id" : "product_id";
  const targetId = (familyId || productId)!;
  if (!ALERT_UUID.test(targetId)) return NextResponse.json({ error: "Product not found" }, { status: 400 });

  await query(
    `DELETE FROM alert_product_links
     WHERE company_id = $1 AND alert_id = ANY($2::uuid[]) AND ${col} = $3 AND origin = 'manual'`,
    [auth.company_id, ids, targetId]
  );
  await query(
    `UPDATE alert_product_links SET state = 'rejected', confirmed_by = $1, confirmed_at = now()
     WHERE company_id = $2 AND alert_id = ANY($3::uuid[]) AND ${col} = $4`,
    [auth.membership_id, auth.company_id, ids, targetId]
  );

  for (const id of ids) {
    await createAuditEvent(auth.company_id, auth.membership_id, "detach_product", "alert", id, { alert_id: id, [col]: targetId }, null);
  }
  return NextResponse.json({ success: true });
}
