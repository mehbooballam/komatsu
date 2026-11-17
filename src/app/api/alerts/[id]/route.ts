import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { cookies } from "next/headers";
import crypto from "crypto";
import { loadGroupTree } from "@/lib/groups";
import { alertProducts } from "@/lib/products";

async function getAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get("komatsu_session")?.value;
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const res = await query(
    `SELECT s.user_id, m.id as membership_id, m.company_id, m.role, m.access_scope, c.time_zone
     FROM sessions s
     JOIN memberships m ON m.user_id = s.user_id AND m.state = 'active'
     JOIN companies c ON c.id = m.company_id
     WHERE s.token = $1 AND s.expires_at > now()
     ORDER BY (m.company_id::text = $2) DESC, m.joined_at ASC LIMIT 1`,
    [tokenHash, cookieStore.get("komatsu_company")?.value ?? ""]
  );
  return res.rows[0] || null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const companyId = auth.company_id;

  const alertRes = await query(
    `SELECT
       a.*,
       rg.title AS group_title,
       rg.owner_membership_id AS group_owner_id,
       owner_u.display_name AS direct_owner_name,
       group_owner_u.display_name AS group_owner_name
     FROM alerts a
     LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
     LEFT JOIN memberships owner_m ON owner_m.id = a.direct_owner_membership_id
     LEFT JOIN user_profiles owner_u ON owner_u.id = owner_m.user_id
     LEFT JOIN memberships group_owner_m ON group_owner_m.id = rg.owner_membership_id
     LEFT JOIN user_profiles group_owner_u ON group_owner_u.id = group_owner_m.user_id
     WHERE a.id = $1 AND a.company_id = $2`,
    [id, companyId]
  );

  if (alertRes.rows.length === 0) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }

  const alert = alertRes.rows[0];

  // Risk owner access check
  if (auth.role === "risk_owner") {
    const effectiveOwner = alert.direct_owner_membership_id || alert.group_owner_id;
    if (effectiveOwner !== auth.membership_id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
  }

  // Fetch related data in parallel
  const [assessment, deadlines, sourceRevisions, products, geographies, topics, tags, forecasts] =
    await Promise.all([
      query(
        `SELECT * FROM score_assessments
         WHERE alert_id = $1 AND company_id = $2 AND is_latest = TRUE
         LIMIT 1`,
        [id, companyId]
      ),
      query(
        `SELECT * FROM alert_deadlines
         WHERE alert_id = $1 AND company_id = $2
         ORDER BY date_value ASC`,
        [id, companyId]
      ),
      query(
        `SELECT asr.*, ir.row_number, ir.raw_payload,
                ib.original_filename, ib.input_format, ib.completed_at AS import_date
         FROM alert_source_revisions asr
         LEFT JOIN import_rows ir ON ir.id = asr.import_row_id
         LEFT JOIN import_batches ib ON ib.id = ir.batch_id
         WHERE asr.alert_id = $1 AND asr.company_id = $2
         ORDER BY asr.version_number DESC`,
        [id, companyId]
      ),
      query(
        `SELECT apl.*, pf.name AS family_name, pr.name AS product_name, pr.model_code
         FROM alert_product_links apl
         LEFT JOIN product_families pf ON pf.id = apl.family_id
         LEFT JOIN products pr ON pr.id = apl.product_id
         WHERE apl.alert_id = $1 AND apl.company_id = $2`,
        [id, companyId]
      ),
      query(
        `SELECT ag.*, g.display_name, g.code, g.iso_code, g.level
         FROM alert_geographies ag
         JOIN geographies g ON g.id = ag.geography_id
         WHERE ag.alert_id = $1 AND ag.company_id = $2`,
        [id, companyId]
      ),
      query(
        `SELECT * FROM alert_topics WHERE alert_id = $1 AND company_id = $2`,
        [id, companyId]
      ),
      query(
        `SELECT at.*, tl.name AS tag_name, tl.color
         FROM alert_tags at
         JOIN tag_labels tl ON tl.id = at.tag_id
         WHERE at.alert_id = $1 AND at.company_id = $2`,
        [id, companyId]
      ),
      query(
        `SELECT * FROM implementation_forecasts
         WHERE alert_id = $1 AND company_id = $2 AND status = 'current'
         ORDER BY created_at DESC LIMIT 1`,
        [id, companyId]
      ),
    ]);

  // Fetch source factor ratings for current revision
  let sourceFactors: Record<string, unknown>[] = [];
  if (alert.current_source_revision_id) {
    const factorsRes = await query(
      `SELECT * FROM source_factor_ratings
       WHERE alert_source_revision_id = $1 AND company_id = $2`,
      [alert.current_source_revision_id, companyId]
    );
    sourceFactors = factorsRes.rows;
  }

  // Fetch active overrides
  const overridesRes = await query(
    `SELECT * FROM score_overrides
     WHERE alert_id = $1 AND company_id = $2 AND ended_at IS NULL
     AND (expires_at IS NULL OR expires_at > now())`,
    [id, companyId]
  );

  // Determine effective ownership
  const effectiveOwnerMembershipId =
    alert.direct_owner_membership_id || alert.group_owner_id || null;
  const effectiveOwnerName =
    alert.direct_owner_name || alert.group_owner_name || null;
  const ownershipType = alert.direct_owner_membership_id
    ? "direct"
    : alert.group_owner_id
      ? "inherited"
      : "unassigned";

  return NextResponse.json({
    alert: {
      id: alert.id,
      external_alert_id: alert.external_alert_id,
      title: alert.title,
      overview: alert.overview,
      summary: alert.summary,
      relevance: alert.relevance,
      published_on: alert.published_on,
      stage: alert.stage,
      recommendation: alert.recommendation,
      change_type: alert.change_type,
      timing_raw: alert.timing_raw,
      product_raw: alert.product_raw,
      jurisdiction_raw: alert.jurisdiction_raw,
      agency_name: alert.agency_name,
      source_name: alert.source_name,
      source_url: alert.source_url,
      topic_match: alert.topic_match,
      local_state: alert.local_state,
      record_version: alert.record_version,
      group_id: alert.primary_group_id,
      group_title: alert.group_title,
      group_path: alert.primary_group_id
        ? (await loadGroupTree(companyId)).find((g) => g.id === alert.primary_group_id)?.path ?? [alert.group_title]
        : null,
      ownership: {
        type: ownershipType,
        effective_owner_id: effectiveOwnerMembershipId,
        effective_owner_name: effectiveOwnerName,
        direct_owner_id: alert.direct_owner_membership_id,
        direct_owner_name: alert.direct_owner_name,
        group_owner_id: alert.group_owner_id,
        group_owner_name: alert.group_owner_name,
      },
    },
    assessment: assessment.rows[0] || null,
    deadlines: deadlines.rows,
    source_revisions: sourceRevisions.rows,
    source_factors: sourceFactors,
    active_overrides: overridesRes.rows,
    // Raw links (incl. rejected import suggestions) and the products that actually apply
    product_links: products.rows,
    products: (await alertProducts(companyId, [id])).get(id) || [],
    notes_count: (
      await query(
        `SELECT COUNT(*)::int AS n FROM alert_notes
         WHERE alert_id = $1 AND company_id = $2 AND (visibility = 'team' OR author_membership_id = $3)`,
        [id, companyId, auth.membership_id]
      )
    ).rows[0].n,
    geographies: geographies.rows,
    topics: topics.rows,
    tags: tags.rows,
    forecast: forecasts.rows[0] || null,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role === "risk_owner") {
    return NextResponse.json({ error: "Risk owners cannot edit alerts" }, { status: 403 });
  }

  const { id } = await params;
  const companyId = auth.company_id;
  const body = await request.json();

  const allowedFields = ["local_state", "primary_group_id", "direct_owner_membership_id"];
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = $${paramIdx}`);
      values.push(body[field]);
      paramIdx++;
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // Record version check
  if (body.record_version !== undefined) {
    updates.push("record_version = record_version + 1");
    const result = await query(
      `UPDATE alerts SET ${updates.join(", ")}
       WHERE id = $${paramIdx} AND company_id = $${paramIdx + 1} AND record_version = $${paramIdx + 2}
       RETURNING *`,
      [...values, id, companyId, body.record_version]
    );
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Conflict: record was modified by another user" },
        { status: 409 }
      );
    }

    // Audit
    await query(
      `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, before_values, after_values, reason)
       VALUES ($1, $2, 'alert_updated', 'alert', $3, $4, $5, $6)`,
      [companyId, auth.membership_id, id, JSON.stringify(body._before || {}), JSON.stringify(body), body.reason || null]
    );

    return NextResponse.json({ alert: result.rows[0] });
  }

  return NextResponse.json({ error: "record_version required for updates" }, { status: 400 });
}
