import { NextRequest, NextResponse } from "next/server";
import { query, getClient } from "@/lib/db";
import { getAuth, createAuditEvent } from "@/lib/auth-helpers";
import { normalizePolicy, validatePolicy, DEFAULT_POLICY } from "@/lib/scoring/policy";
import { recalculateCompanyAlerts, getAsOfDate } from "@/lib/scoring/recalculate";

/** GET /api/scoring/policy — the active scoring policy for the current workspace, plus version history. */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const active = await query(
    `SELECT sp.id, sp.version, sp.rules_json, sp.published_at, up.display_name AS published_by
     FROM companies c
     JOIN scoring_policies sp ON sp.id = c.active_policy_id
     LEFT JOIN memberships m ON m.id = sp.created_by
     LEFT JOIN user_profiles up ON up.id = m.user_id
     WHERE c.id = $1`,
    [auth.company_id]
  );
  const history = await query(
    `SELECT sp.id, sp.version, sp.published_at, sp.is_active, up.display_name AS published_by
     FROM scoring_policies sp
     LEFT JOIN memberships m ON m.id = sp.created_by
     LEFT JOIN user_profiles up ON up.id = m.user_id
     WHERE sp.company_id = $1
     ORDER BY sp.version DESC LIMIT 20`,
    [auth.company_id]
  );

  const row = active.rows[0];
  return NextResponse.json({
    policy: normalizePolicy(row?.rules_json ?? DEFAULT_POLICY),
    version: row?.version ?? 0,
    published_at: row?.published_at ?? null,
    published_by: row?.published_by ?? null,
    can_edit: auth.role === "company_admin",
    history: history.rows,
    defaults: DEFAULT_POLICY,
  });
}

/**
 * PUT /api/scoring/policy { policy, reason? } — publish a new policy version (admins only),
 * make it active and re-score every alert in the workspace.
 */
export async function PUT(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role !== "company_admin") {
    return NextResponse.json({ error: "Only administrators can change the scoring policy" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const policy = normalizePolicy(body.policy);
  const errors = validatePolicy(policy);
  if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });

  const client = await getClient();
  let newId: string;
  let version: number;
  try {
    await client.query("BEGIN");
    const prev = await client.query(
      `SELECT COALESCE(MAX(version), 0) AS v FROM scoring_policies WHERE company_id = $1`,
      [auth.company_id]
    );
    version = Number(prev.rows[0].v) + 1;
    policy.version = version;

    await client.query(`UPDATE scoring_policies SET is_active = FALSE WHERE company_id = $1`, [auth.company_id]);
    const ins = await client.query(
      `INSERT INTO scoring_policies (company_id, version, effective_from, rules_json, created_by, published_at, is_active)
       VALUES ($1, $2, now(), $3, $4, now(), TRUE) RETURNING id`,
      [auth.company_id, version, JSON.stringify(policy), auth.membership_id]
    );
    newId = ins.rows[0].id;
    await client.query(`UPDATE companies SET active_policy_id = $1 WHERE id = $2`, [newId, auth.company_id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Publish scoring policy failed:", err);
    return NextResponse.json({ error: "Could not save the scoring policy" }, { status: 500 });
  } finally {
    client.release();
  }

  await createAuditEvent(auth.company_id, auth.membership_id, "scoring_policy_published", "scoring_policy", newId, null, {
    version,
    reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
  });

  const result = await recalculateCompanyAlerts(auth.company_id, getAsOfDate(auth.time_zone || "UTC"), "policy_change");

  return NextResponse.json({ success: true, version, policy, recalculated: result.recalculated, changed: result.changed });
}
