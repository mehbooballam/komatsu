import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { canImport, forbidden, getAuth, unauthorized } from "@/lib/auth-helpers";
import { batchHeaders, cleanMapping, mappingProblems, revalidateBatch } from "@/lib/import/mapping";

/**
 * PUT { mapping: { header: field | null }, profile_id?: string | null }
 * Changes the column mapping of an import in preview and re-checks every row.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canImport(auth.role)) return forbidden();
  const { id } = await params;

  const res = await query(
    `SELECT id, status, column_mapping, file_headers FROM import_batches WHERE id = $1 AND company_id = $2`,
    [id, auth.company_id]
  );
  const batch = res.rows[0];
  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  if (batch.status !== "previewing") {
    return NextResponse.json({ error: "The mapping can only be changed before the import runs" }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const headers = batchHeaders(batch);
  const before = cleanMapping(batch.column_mapping, headers);
  const mapping = cleanMapping(body.mapping, headers);
  const validation = await revalidateBatch(id, mapping);

  if (body.profile_id !== undefined) {
    const pid = typeof body.profile_id === "string" ? body.profile_id : null;
    await query(
      `UPDATE import_batches SET mapping_profile_id =
         (SELECT id FROM import_mapping_profiles WHERE id::text = $2 AND company_id = $3)
       WHERE id = $1`,
      [id, pid, auth.company_id]
    );
  }

  const changes = headers
    .filter((h) => before[h] !== mapping[h])
    .map((h) => ({ header: h, before: before[h], after: mapping[h] }));
  if (changes.length) {
    await query(
      `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, after_values)
       VALUES ($1, $2, 'import_mapping_changed', 'import_batch', $3, $4)`,
      [auth.company_id, auth.membership_id, id, JSON.stringify({ changes })]
    );
  }

  return NextResponse.json({
    ok: true,
    problems: mappingProblems(mapping),
    counts: { total: validation.rows.length, valid: validation.totalValid, invalid: validation.totalInvalid, duplicates: validation.totalDuplicates },
  });
}
