import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canEdit, canAssign } from "@/lib/auth-helpers";
import { ALERT_UUID, alertNotFound, alertScopeSql, canAccessAlert } from "@/lib/alerts/access";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { loadGroupTree } from "@/lib/groups";
import { alertProducts } from "@/lib/products";
import { addChangeNotes, commentRequired, readChangeComment } from "@/lib/change-notes";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuth();
  if (!auth) return unauthorized();

  const { id } = await params;
  const companyId = auth.company_id;
  if (!ALERT_UUID.test(id)) return alertNotFound();
  const values: unknown[] = [id, companyId];
  const scope = alertScopeSql(auth, values);

  const alertRes = await query(
    `SELECT
       a.*,
       rg.title AS group_title,
       rg.owner_membership_id AS group_owner_id,
       owner_u.display_name AS direct_owner_name,
       group_owner_u.display_name AS group_owner_name,
       hr_flag_u.display_name AS human_review_flagged_by_name,
       hr_clear_u.display_name AS human_review_cleared_by_name
     FROM alerts a
     LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id AND rg.company_id = a.company_id
     LEFT JOIN memberships owner_m ON owner_m.id = a.direct_owner_membership_id AND owner_m.company_id = a.company_id
     LEFT JOIN user_profiles owner_u ON owner_u.id = owner_m.user_id
     LEFT JOIN memberships group_owner_m ON group_owner_m.id = rg.owner_membership_id AND group_owner_m.company_id = a.company_id
     LEFT JOIN user_profiles group_owner_u ON group_owner_u.id = group_owner_m.user_id
     LEFT JOIN memberships hr_flag_m ON hr_flag_m.id = a.human_review_flagged_by
     LEFT JOIN user_profiles hr_flag_u ON hr_flag_u.id = hr_flag_m.user_id
     LEFT JOIN memberships hr_clear_m ON hr_clear_m.id = a.human_review_cleared_by
     LEFT JOIN user_profiles hr_clear_u ON hr_clear_u.id = hr_clear_m.user_id
     WHERE a.id = $1 AND a.company_id = $2 AND a.archived_at IS NULL AND ${scope}`,
    values
  );

  if (alertRes.rows.length === 0) {
    return alertNotFound();
  }

  const alert = alertRes.rows[0];

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
         LEFT JOIN product_families pf ON pf.id = apl.family_id AND pf.company_id = apl.company_id
         LEFT JOIN products pr ON pr.id = apl.product_id AND pr.company_id = apl.company_id
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
         JOIN tag_labels tl ON tl.id = at.tag_id AND tl.company_id = at.company_id
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
    // previous_value: what a step back brings back (null = the imported value)
    `SELECT o.*, p.value AS previous_value FROM score_overrides o
     LEFT JOIN score_overrides p ON p.id = o.replaces_override_id
     WHERE o.alert_id = $1 AND o.company_id = $2 AND o.ended_at IS NULL
     AND (o.expires_at IS NULL OR o.expires_at > now())`,
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
      // Feed context columns (summary + details per topic)
      category_user_defined: alert.category_user_defined,
      key_dates: alert.key_dates,
      date_relevance: alert.date_relevance,
      status_summary: alert.status_summary,
      status_details: alert.status_details,
      timing_summary: alert.timing_summary,
      timing_details: alert.timing_details,
      change_summary: alert.change_summary,
      change_details: alert.change_details,
      source_context: alert.source_context,
      source_context_summary: alert.source_context_summary,
      source_context_details: alert.source_context_details,
      local_state: alert.local_state,
      record_version: alert.record_version,
      group_id: alert.primary_group_id,
      group_title: alert.group_title,
      group_path: alert.primary_group_id
        ? (await loadGroupTree(companyId)).find((g) => g.id === alert.primary_group_id)?.path ?? [alert.group_title]
        : null,
      // Regulatory family grouping: Version type (level 3) and why the alert is in its group
      version_type: alert.version_type,
      grouping: {
        method: alert.grouping_method,
        confidence: alert.grouping_confidence,
        basis: alert.grouping_basis,
        reviewed: alert.grouping_reviewed,
      },
      identifiers: (
        await query(
          `SELECT kind, value, source FROM alert_identifiers WHERE alert_id = $1 AND company_id = $2 ORDER BY kind, value`,
          [id, companyId]
        )
      ).rows,
      // Needs human review: from the import's needs_human_review column (flagged_by null) or flagged by a person
      human_review: {
        required: !!alert.human_review_required,
        reason: alert.human_review_reason,
        from_import: alert.human_review_flagged_at != null && alert.human_review_flagged_by == null,
        flagged_at: alert.human_review_flagged_at,
        flagged_by_name: alert.human_review_flagged_by_name,
        cleared_at: alert.human_review_cleared_at,
        cleared_by_name: alert.human_review_cleared_by_name,
      },
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
    // Confidence set by a person per factor (wins over source_factors[].confidence)
    factor_confidence: (
      await query(
        `SELECT fc.factor_key, fc.confidence, fc.set_at, up.display_name AS set_by_name
         FROM alert_factor_confidence fc
         LEFT JOIN memberships m ON m.id = fc.set_by
         LEFT JOIN user_profiles up ON up.id = m.user_id
         WHERE fc.alert_id = $1 AND fc.company_id = $2`,
        [id, companyId]
      )
    ).rows,
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
  if (!auth) return unauthorized();
  if (!canEdit(auth.role)) return forbidden();

  const { id } = await params;
  const companyId = auth.company_id;
  if (!(await canAccessAlert(auth, id))) return alertNotFound();
  const body = await request.json();
  const comment = readChangeComment(request, body) || (typeof body.reason === "string" ? body.reason.trim() : "");
  if (!comment) return commentRequired();

  if (body.direct_owner_membership_id !== undefined) {
    if (!canAssign(auth.role)) return forbidden();
    const ownerId = body.direct_owner_membership_id;
    if (ownerId !== null) {
      const owner = await query(`SELECT 1 FROM memberships WHERE id::text = $1 AND company_id = $2 AND state = 'active'`, [ownerId, companyId]);
      if (!owner.rowCount) return NextResponse.json({ error: "Member not found" }, { status: 400 });
    }
  }
  if (body.primary_group_id !== undefined) {
    if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
    const groupId = body.primary_group_id;
    if (groupId !== null) {
      const group = await query(`SELECT 1 FROM regulation_groups WHERE id::text = $1 AND company_id = $2 AND state <> 'archived'`, [groupId, companyId]);
      if (!group.rowCount) return NextResponse.json({ error: "Group not found" }, { status: 400 });
    }
  }

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
    const updateValues = [...values, id, companyId, body.record_version];
    const scope = alertScopeSql(auth, updateValues);
    const result = await query(
      `UPDATE alerts a SET ${updates.join(", ")}
       WHERE id = $${paramIdx} AND company_id = $${paramIdx + 1} AND record_version = $${paramIdx + 2}
         AND a.archived_at IS NULL AND ${scope}
       RETURNING *`,
      updateValues
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
      [companyId, auth.membership_id, id, JSON.stringify(body._before || {}), JSON.stringify(body), comment]
    );
    const changed = [
      body.local_state !== undefined ? `Status set to ${String(body.local_state).replace(/_/g, " ")}` : null,
      body.primary_group_id !== undefined ? (body.primary_group_id ? "Moved to another group" : "Removed from its group") : null,
      body.direct_owner_membership_id !== undefined ? (body.direct_owner_membership_id ? "Owner assigned" : "Owner removed") : null,
    ].filter(Boolean).join("; ");
    await addChangeNotes(companyId, [id], auth.membership_id, changed || "Alert updated", comment);

    return NextResponse.json({ alert: result.rows[0] });
  }

  return NextResponse.json({ error: "record_version required for updates" }, { status: 400 });
}
