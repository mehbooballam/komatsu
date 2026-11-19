import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createAuditEvent, forbidden, getAuth, unauthorized } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { UUID_RE } from "@/lib/inventory";
import { canEditReports, sanitizeContent, SECTION_KEYS, type SectionKey } from "@/lib/reports";
import { AUTO_REFRESH_MINUTES, loadHistory, refreshReport, REPORT_JOINS, REPORT_SELECT } from "@/lib/reports-server";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "Report not found" }, { status: 404 });

async function loadReport(companyId: string, id: string) {
  const res = await query(
    `${REPORT_SELECT}, r.content, r.snapshot, r.snapshot_at ${REPORT_JOINS}
     WHERE r.company_id = $1 AND r.id = $2`,
    [companyId, id]
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  const history = await loadHistory(companyId, row.period);
  return { ...row, content: sanitizeContent(row.content), history };
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope)) return forbidden();
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();

  let report = await loadReport(auth.company_id, id);
  if (!report) return notFound();

  // Drafts keep themselves current: regenerate from the register when the figures are stale.
  const stale = !report.snapshot_at || Date.now() - new Date(report.snapshot_at).getTime() > AUTO_REFRESH_MINUTES * 60_000;
  if (report.status === "draft" && stale) {
    await refreshReport(auth.company_id, auth.time_zone, null, report);
    report = await loadReport(auth.company_id, id);
  }
  return NextResponse.json({ report, can_edit: canEditReports(auth.role) });
}

/**
 * PATCH with one of:
 *   { title?, content? }               save the draft
 *   { action: "refresh_snapshot" }     re-capture the figures and regenerate unedited sections
 *   { action: "reset_section", section } regenerate one section, dropping its manual edits
 *   { action: "publish" | "unpublish" }
 * `expected_updated_at` guards against overwriting someone else's newer edit.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEditReports(auth.role)) return forbidden();
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();

  const current = await query(
    `SELECT id, title, status, to_char(period, 'YYYY-MM-DD') AS period, updated_at, content FROM risk_reports WHERE company_id = $1 AND id = $2`,
    [auth.company_id, id]
  );
  if (!current.rows.length) return notFound();
  const before = current.rows[0];
  const body = await request.json().catch(() => ({}));

  if (body.expected_updated_at && new Date(body.expected_updated_at).getTime() !== new Date(before.updated_at).getTime()) {
    return NextResponse.json(
      { error: "Someone else changed this report. Reload to see the latest version." },
      { status: 409 }
    );
  }

  const action = body.action as string | undefined;

  if (action === "publish" || action === "unpublish") {
    const publish = action === "publish";
    if ((before.status === "published") === publish) {
      return NextResponse.json({ error: publish ? "Already published" : "Already a draft" }, { status: 400 });
    }
    await query(
      publish
        ? `UPDATE risk_reports SET status = 'published', published_at = now(), published_by = $3, updated_at = now(), updated_by = $3
           WHERE company_id = $1 AND id = $2`
        : `UPDATE risk_reports SET status = 'draft', published_at = NULL, published_by = NULL, updated_at = now(), updated_by = $3
           WHERE company_id = $1 AND id = $2`,
      [auth.company_id, id, auth.membership_id]
    );
    await createAuditEvent(auth.company_id, auth.membership_id, publish ? "report_published" : "report_unpublished",
      "risk_report", id, { status: before.status }, { status: publish ? "published" : "draft", title: before.title });
  } else if (action === "refresh_snapshot" || action === "reset_section") {
    if (before.status === "published") {
      return NextResponse.json({ error: "Move the report back to draft before refreshing it" }, { status: 400 });
    }
    let only: SectionKey[] | undefined;
    if (action === "reset_section") {
      if (!SECTION_KEYS.includes(body.section)) return NextResponse.json({ error: "Unknown section" }, { status: 400 });
      only = [body.section];
    }
    await refreshReport(auth.company_id, auth.time_zone, auth.membership_id,
      { id, period: before.period, content: sanitizeContent(before.content) }, only);
  } else if (action) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } else {
    if (before.status === "published") {
      return NextResponse.json({ error: "Published reports are read-only. Move it back to draft to edit." }, { status: 400 });
    }
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : before.title;
    if (!title) return NextResponse.json({ error: "Give the report a title" }, { status: 400 });
    const content = body.content === undefined ? null : sanitizeContent(body.content);
    await query(
      `UPDATE risk_reports
       SET title = $3, content = COALESCE($4::jsonb, content), updated_at = now(), updated_by = $5
       WHERE company_id = $1 AND id = $2`,
      [auth.company_id, id, title, content ? JSON.stringify(content) : null, auth.membership_id]
    );
    // One audit entry per save would flood the history; log title changes only.
    if (title !== before.title) {
      await createAuditEvent(auth.company_id, auth.membership_id, "report_updated", "risk_report", id,
        { title: before.title }, { title });
    }
  }

  const report = await loadReport(auth.company_id, id);
  return NextResponse.json({ report, can_edit: true });
}

/** Drafts only; a published report has to be moved back to draft first. */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canEditReports(auth.role)) return forbidden();
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();

  const res = await query(
    `DELETE FROM risk_reports WHERE company_id = $1 AND id = $2 AND status = 'draft' RETURNING title, to_char(period, 'YYYY-MM-DD') AS period`,
    [auth.company_id, id]
  );
  if (!res.rows.length) {
    const exists = await query(`SELECT status FROM risk_reports WHERE company_id = $1 AND id = $2`, [auth.company_id, id]);
    if (!exists.rows.length) return notFound();
    return NextResponse.json({ error: "Move the report back to draft before deleting it" }, { status: 400 });
  }
  await createAuditEvent(auth.company_id, auth.membership_id, "report_deleted", "risk_report", id, res.rows[0], null);
  return NextResponse.json({ ok: true });
}
