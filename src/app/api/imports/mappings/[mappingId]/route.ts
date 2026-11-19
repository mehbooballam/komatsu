import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { canImport, forbidden, getAuth, unauthorized } from "@/lib/auth-helpers";

/** DELETE — forget a saved import mapping (files fall back to automatic mapping). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ mappingId: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canImport(auth.role)) return forbidden();
  const { mappingId } = await params;
  const res = await query(
    `DELETE FROM import_mapping_profiles WHERE id::text = $1 AND company_id = $2 RETURNING id, name`,
    [mappingId, auth.company_id]
  );
  if (!res.rows[0]) return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  await query(
    `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, before_values)
     VALUES ($1, $2, 'import_mapping_deleted', 'import_mapping', $3, $4)`,
    [auth.company_id, auth.membership_id, res.rows[0].id, JSON.stringify({ name: res.rows[0].name })]
  );
  return NextResponse.json({ ok: true });
}
