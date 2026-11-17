import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, createAuditEvent } from "@/lib/auth-helpers";
import { loadGroupTree, checkParent, MAX_GROUP_DEPTH } from "@/lib/groups";
import { groupProducts } from "@/lib/products";

/** All active groups, flat and in tree order, with depth, path and roll-up counts. */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  const [groups, products] = await Promise.all([loadGroupTree(auth.company_id), groupProducts(auth.company_id)]);
  return NextResponse.json({
    groups: groups.map((g) => ({ ...g, products: products.get(g.id) || [] })),
    max_depth: MAX_GROUP_DEPTH,
  });
}

export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();

  const body = await request.json();
  const { title, jurisdiction_ref, issuer, description } = body;
  const parentId: string | null = body.parent_group_id || null;

  if (!title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (title.trim().length > 120) {
    return NextResponse.json({ error: "Title must be 120 characters or fewer" }, { status: 400 });
  }

  const tree = await loadGroupTree(auth.company_id);
  const problem = checkParent(tree, null, parentId);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const res = await query(
    `INSERT INTO regulation_groups (company_id, title, jurisdiction_ref, issuer, description, parent_group_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [auth.company_id, title.trim(), jurisdiction_ref || null, issuer || null, description || null, parentId]
  );

  await createAuditEvent(auth.company_id, auth.membership_id, "create", "regulation_group", res.rows[0].id, null, {
    title: title.trim(),
    parent_group_id: parentId,
  });

  const group = (await loadGroupTree(auth.company_id)).find((g) => g.id === res.rows[0].id);
  return NextResponse.json({ group }, { status: 201 });
}
