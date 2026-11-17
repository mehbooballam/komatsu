import { NextRequest, NextResponse } from "next/server";
import { query, getClient } from "@/lib/db";
import { getAuth, createAuditEvent } from "@/lib/auth-helpers";
import { setActiveWorkspace, slugify } from "@/lib/workspaces";

/** GET /api/workspaces — workspaces the current user belongs to. */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await query(
    `SELECT c.id, c.name, c.slug, m.role, c.settings->>'logo' AS logo, c.settings->>'icon' AS icon,
            (SELECT COUNT(*)::int FROM alerts a WHERE a.company_id = c.id AND a.archived_at IS NULL) AS alert_count
     FROM memberships m JOIN companies c ON c.id = m.company_id
     WHERE m.user_id = $1 AND m.state = 'active' AND c.archived_at IS NULL
     ORDER BY c.name`,
    [auth.user_id]
  );
  return NextResponse.json({ workspaces: res.rows, current: auth.company_id });
}

/**
 * POST /api/workspaces { name } — create a new workspace. The creator becomes its
 * administrator. The scoring policy and product families are copied from the
 * current workspace so the new one is ready to import into.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role !== "company_admin") {
    return NextResponse.json({ error: "Only administrators can create workspaces" }, { status: 403 });
  }

  const { name, time_zone } = (await request.json().catch(() => ({}))) as { name?: string; time_zone?: string };
  const title = (name || "").trim();
  if (title.length < 2) return NextResponse.json({ error: "Workspace name is required" }, { status: 400 });

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const base = slugify(title);
    let slug = base;
    for (let i = 2; ; i++) {
      const taken = await client.query(`SELECT 1 FROM companies WHERE slug = $1`, [slug]);
      if (taken.rows.length === 0) break;
      slug = `${base}-${i}`;
    }

    const current = await client.query(`SELECT time_zone, active_policy_id FROM companies WHERE id = $1`, [auth.company_id]);
    const tz = time_zone || current.rows[0]?.time_zone || "UTC";

    const company = await client.query(
      `INSERT INTO companies (name, slug, time_zone, settings) VALUES ($1, $2, $3, '{}') RETURNING id, name, slug`,
      [title, slug, tz]
    );
    const companyId = company.rows[0].id;

    const membership = await client.query(
      `INSERT INTO memberships (company_id, user_id, role, access_scope, state)
       VALUES ($1, $2, 'company_admin', 'company', 'active') RETURNING id`,
      [companyId, auth.user_id]
    );
    const membershipId = membership.rows[0].id;

    // Copy the scoring policy
    const policySrc = current.rows[0]?.active_policy_id
      ? await client.query(`SELECT rules_json FROM scoring_policies WHERE id = $1`, [current.rows[0].active_policy_id])
      : { rows: [] as Array<{ rules_json: unknown }> };
    if (policySrc.rows.length > 0) {
      const policy = await client.query(
        `INSERT INTO scoring_policies (company_id, version, effective_from, rules_json, created_by, published_at, is_active)
         VALUES ($1, 1, now(), $2, $3, now(), TRUE) RETURNING id`,
        [companyId, JSON.stringify(policySrc.rows[0].rules_json), membershipId]
      );
      await client.query(`UPDATE companies SET active_policy_id = $1 WHERE id = $2`, [policy.rows[0].id, companyId]);
    }

    // Alert feed + product families
    await client.query(
      `INSERT INTO feeds (company_id, provider_name, dataset_key, name) VALUES ($1, 'Daptic', 'daptic-default', 'Daptic Alert Feed')`,
      [companyId]
    );
    await client.query(
      `INSERT INTO product_families (company_id, name, state)
       SELECT $1, name, 'active' FROM product_families WHERE company_id = $2 AND state = 'active'`,
      [companyId, auth.company_id]
    );

    await client.query("COMMIT");

    await createAuditEvent(companyId, membershipId, "workspace_created", "company", companyId, null, { name: title });
    await setActiveWorkspace(companyId);

    return NextResponse.json({ workspace: company.rows[0] }, { status: 201 });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create workspace failed:", err);
    return NextResponse.json({ error: "Could not create workspace" }, { status: 500 });
  } finally {
    client.release();
  }
}
