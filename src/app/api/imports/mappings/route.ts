import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { canImport, forbidden, getAuth, unauthorized } from "@/lib/auth-helpers";
import { batchHeaders, cleanMapping, headerSignature } from "@/lib/import/mapping";

/** GET — saved import mappings. */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canImport(auth.role)) return forbidden();
  const res = await query(
    `SELECT p.id, p.name, p.headers, p.mapping, p.updated_at, p.last_used_at, up.display_name AS updated_by_name
     FROM import_mapping_profiles p
     LEFT JOIN memberships m ON m.id = COALESCE(p.updated_by, p.created_by)
     LEFT JOIN user_profiles up ON up.id = m.user_id
     WHERE p.company_id = $1
     ORDER BY p.last_used_at DESC NULLS LAST, p.updated_at DESC`,
    [auth.company_id]
  );
  return NextResponse.json({ mappings: res.rows });
}

/**
 * POST { batch_id, name } — save the mapping of an import in preview.
 * Files with the same set of columns get it automatically; saving again for the
 * same layout updates that saved mapping.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canImport(auth.role)) return forbidden();
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return NextResponse.json({ error: "Give the mapping a name" }, { status: 400 });

  const res = await query(
    `SELECT column_mapping, file_headers FROM import_batches WHERE id::text = $1 AND company_id = $2`,
    [String(body.batch_id || ""), auth.company_id]
  );
  const batch = res.rows[0];
  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  const headers = batchHeaders(batch);
  const mapping = cleanMapping(batch.column_mapping, headers);

  const saved = await query(
    `INSERT INTO import_mapping_profiles (company_id, name, headers, signature, mapping, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (company_id, signature) DO UPDATE
       SET name = EXCLUDED.name, headers = EXCLUDED.headers, mapping = EXCLUDED.mapping,
           updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING id, name, (xmax <> 0) AS replaced`,
    [auth.company_id, name, JSON.stringify(headers), headerSignature(headers), JSON.stringify(mapping), auth.membership_id]
  );
  const profile = saved.rows[0];
  await query(`UPDATE import_batches SET mapping_profile_id = $1 WHERE id::text = $2`, [profile.id, String(body.batch_id)]);
  await query(
    `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, after_values)
     VALUES ($1, $2, 'import_mapping_saved', 'import_mapping', $3, $4)`,
    [auth.company_id, auth.membership_id, profile.id, JSON.stringify({ name, columns: headers.length })]
  );
  return NextResponse.json({ mapping: { id: profile.id, name: profile.name }, replaced: profile.replaced });
}
