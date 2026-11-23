import { query } from "@/lib/db";
import { getWorkspaceDate } from "@/lib/workspace-date";
import { defaultTitle, type HistoryPoint, type ReportContent, type ReportSnapshot, type SectionKey } from "@/lib/reports";
import { generateContent, regenerate } from "@/lib/reports-generate";

/** Columns for listing reports, with who last edited / published them. */
export const REPORT_SELECT = `
  SELECT r.id, to_char(r.period, 'YYYY-MM-DD') AS period, r.title, r.status,
         r.content->>'rag' AS rag, r.updated_at, r.published_at, r.created_at,
         ub.display_name AS updated_by_name, pb.display_name AS published_by_name`;

export const REPORT_JOINS = `
  FROM risk_reports r
  LEFT JOIN memberships um ON um.id = r.updated_by
  LEFT JOIN user_profiles ub ON ub.id = um.user_id
  LEFT JOIN memberships pm ON pm.id = r.published_by
  LEFT JOIN user_profiles pb ON pb.id = pm.user_id`;

const MAX_GROUPS = 8;
const DEADLINE_MONTHS = 6;

const n = (v: unknown) => parseInt(String(v ?? 0)) || 0;

/**
 * Alert figures for the report. For the current month they're "as of today";
 * for a past month they're as of the month's last day (deadlines judged against
 * that date; counts reflect alerts as they are now).
 */
export async function captureSnapshot(companyId: string, timeZone: string, period: string): Promise<ReportSnapshot> {
  const today = getWorkspaceDate(timeZone);
  const [y, m] = period.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const asOf = today < monthEnd ? today : monthEnd;

  const [totals, groups, deadlines] = await Promise.all([
    query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE p.effective_priority = 'critical') AS critical,
         COUNT(*) FILTER (WHERE p.effective_priority = 'high') AS high,
         COUNT(*) FILTER (WHERE p.effective_priority = 'moderate') AS moderate,
         COUNT(*) FILTER (WHERE p.effective_priority = 'low') AS low,
         COUNT(*) FILTER (WHERE p.effective_priority IS NULL OR p.effective_priority = 'unscored') AS unscored,
         COUNT(*) FILTER (WHERE p.next_compliance_deadline < $2::date) AS overdue,
         COUNT(*) FILTER (WHERE p.next_compliance_deadline >= $2::date AND p.next_compliance_deadline <= $2::date + 30) AS due_30,
         COUNT(*) FILTER (WHERE COALESCE(a.direct_owner_membership_id, rg.owner_membership_id) IS NULL) AS unassigned,
         COUNT(*) FILTER (WHERE a.created_at >= $3::date AND a.created_at < ($3::date + INTERVAL '1 month')) AS new_this_month
       FROM alert_active_projections p
       JOIN alerts a ON a.id = p.alert_id AND a.archived_at IS NULL
       LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
       WHERE p.company_id = $1 AND p.is_active`,
      [companyId, asOf, period]
    ),
    // Alerts rolled up to their top-level group (sub-groups count towards their parent)
    query(
      `WITH RECURSIVE tree AS (
         SELECT id, id AS root_id, title AS root_title FROM regulation_groups
         WHERE company_id = $1 AND parent_group_id IS NULL AND state <> 'archived'
         UNION ALL
         SELECT g.id, t.root_id, t.root_title FROM regulation_groups g
         JOIN tree t ON g.parent_group_id = t.id
         WHERE g.company_id = $1 AND g.state <> 'archived'
       )
       SELECT COALESCE(t.root_title, 'Not in a group') AS name,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE p.effective_priority = 'critical') AS critical,
              COUNT(*) FILTER (WHERE p.effective_priority = 'high') AS high
       FROM alert_active_projections p
       JOIN alerts a ON a.id = p.alert_id AND a.archived_at IS NULL
       LEFT JOIN tree t ON t.id = a.primary_group_id
       WHERE p.company_id = $1 AND p.is_active
       GROUP BY 1
       ORDER BY COUNT(*) DESC, 1`,
      [companyId]
    ),
    query(
      `SELECT to_char(date_trunc('month', p.next_compliance_deadline), 'YYYY-MM') AS month, COUNT(*) AS count
       FROM alert_active_projections p
       JOIN alerts a ON a.id = p.alert_id AND a.archived_at IS NULL
       WHERE p.company_id = $1 AND p.is_active
         AND p.next_compliance_deadline >= $2::date
         AND p.next_compliance_deadline < (date_trunc('month', $2::date) + make_interval(months => $3))
       GROUP BY 1`,
      [companyId, asOf, DEADLINE_MONTHS]
    ),
  ]);

  // Top groups by size, the rest folded into "Other groups"
  const groupRows = groups.rows.map((g) => ({ name: g.name as string, total: n(g.total), critical: n(g.critical), high: n(g.high) }));
  const named = groupRows.filter((g) => g.name !== "Not in a group");
  const ungrouped = groupRows.find((g) => g.name === "Not in a group");
  const byGroup = named.slice(0, MAX_GROUPS);
  const rest = named.slice(MAX_GROUPS);
  if (rest.length) {
    byGroup.push(rest.reduce((acc, g) => ({ ...acc, total: acc.total + g.total, critical: acc.critical + g.critical, high: acc.high + g.high }),
      { name: `Other groups (${rest.length})`, total: 0, critical: 0, high: 0 }));
  }
  if (ungrouped) byGroup.push(ungrouped);

  // Every one of the next 6 months, including empty ones
  const counts = new Map(deadlines.rows.map((d) => [d.month as string, n(d.count)]));
  const [ay, am] = asOf.split("-").map(Number);
  const deadlineMonths = Array.from({ length: DEADLINE_MONTHS }, (_, i) => {
    const d = new Date(Date.UTC(ay, am - 1 + i, 1));
    const key = d.toISOString().slice(0, 7);
    return { month: key, count: counts.get(key) ?? 0 };
  });

  const r = totals.rows[0] ?? {};
  return {
    as_of: asOf,
    total_alerts: n(r.total),
    critical: n(r.critical),
    high: n(r.high),
    moderate: n(r.moderate),
    low: n(r.low),
    unscored: n(r.unscored),
    overdue: n(r.overdue),
    due_30_days: n(r.due_30),
    unassigned: n(r.unassigned),
    new_this_month: n(r.new_this_month),
    by_group: byGroup,
    deadlines: deadlineMonths,
  };
}

/** Figures from this report and up to 11 earlier ones, oldest first, for the trend chart. */
export async function loadHistory(companyId: string, period: string): Promise<HistoryPoint[]> {
  const res = await query(
    `SELECT to_char(period, 'YYYY-MM-DD') AS period, status, snapshot
     FROM risk_reports
     WHERE company_id = $1 AND period <= $2 AND snapshot IS NOT NULL
     ORDER BY period DESC
     LIMIT 12`,
    [companyId, period]
  );
  return res.rows.reverse().map((r) => ({
    period: r.period,
    status: r.status,
    total_alerts: n(r.snapshot?.total_alerts),
    critical: n(r.snapshot?.critical),
    high: n(r.snapshot?.high),
    overdue: n(r.snapshot?.overdue),
  }));
}

/** The snapshot of the most recent report before this month (for month-on-month comparison). */
export async function previousSnapshot(companyId: string, period: string): Promise<ReportSnapshot | null> {
  const res = await query(
    `SELECT snapshot FROM risk_reports WHERE company_id = $1 AND period < $2 AND snapshot IS NOT NULL ORDER BY period DESC LIMIT 1`,
    [companyId, period]
  );
  return res.rows[0]?.snapshot ?? null;
}

/** Drafts older than this are refreshed from the alert register when opened. */
export const AUTO_REFRESH_MINUTES = 15;

/**
 * Re-captures the figures and regenerates the report text, keeping sections a
 * person edited (or only the given sections, for "reset to automatic").
 */
export async function refreshReport(
  companyId: string, timeZone: string, membershipId: string | null,
  report: { id: string; period: string; content: ReportContent }, only?: SectionKey[],
) {
  const snapshot = await captureSnapshot(companyId, timeZone, report.period);
  const prev = await previousSnapshot(companyId, report.period);
  const content = await regenerate(companyId, report.content, snapshot, prev, only);
  await query(
    `UPDATE risk_reports SET content = $3, snapshot = $4, snapshot_at = now(), updated_at = now(), updated_by = COALESCE($5, updated_by)
     WHERE company_id = $1 AND id = $2 AND status = 'draft'`,
    [companyId, report.id, JSON.stringify(content), JSON.stringify(snapshot), membershipId]
  );
}

/** Creates a fully generated draft for the month. Returns its id, or null if one already exists. */
export async function createGeneratedReport(companyId: string, timeZone: string, membershipId: string | null, period: string) {
  const snapshot = await captureSnapshot(companyId, timeZone, period);
  const prev = await previousSnapshot(companyId, period);
  const content = await generateContent(companyId, snapshot, prev);
  const ins = await query(
    `INSERT INTO risk_reports (company_id, period, title, content, snapshot, snapshot_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, now(), $6, $6)
     ON CONFLICT (company_id, period) DO NOTHING
     RETURNING id`,
    [companyId, period, defaultTitle(period), JSON.stringify(content), JSON.stringify(snapshot), membershipId]
  );
  return (ins.rows[0]?.id as string | undefined) ?? null;
}
