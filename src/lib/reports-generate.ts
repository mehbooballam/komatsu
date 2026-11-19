import { query } from "@/lib/db";
import {
  copySections, SECTION_KEYS,
  type PriorityRow, type Rag, type ReportContent, type ReportSnapshot, type RiskDetail, type RiskLevel, type ScorecardRow,
  type ScoreStatus, type SectionKey, type Trend,
} from "@/lib/reports";

/**
 * Writes the monthly report from the alert register — every section, in short
 * one-line statements. Fixed rules (no AI), so the same data always gives the
 * same report and every statement can be traced back to the alerts.
 */

const n = (v: unknown) => parseInt(String(v ?? 0)) || 0;
const plural = (count: number, word: string, many = `${word}s`) => `${count.toLocaleString()} ${count === 1 ? word : many}`;
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 100);
const short = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const day = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

interface GroupStat {
  name: string;
  has_owner: boolean;
  total: number;
  critical: number;
  high: number;
  moderate: number;
  overdue: number;
  due_30: number;
  unassigned: number;
}

interface AlertRow {
  id: string;
  title: string;
  priority: string;
  score: number | null;
  group_name: string | null;
  jurisdiction: string | null;
  deadline: string | null;
  owner: string | null;
}

/** Same top-level-group roll-up as the snapshot: sub-groups count in their root group. */
const GROUP_TREE = `
  WITH RECURSIVE tree AS (
    SELECT id, id AS root_id, title AS root_title, owner_membership_id AS root_owner FROM regulation_groups
    WHERE company_id = $1 AND parent_group_id IS NULL AND state <> 'archived'
    UNION ALL
    SELECT g.id, t.root_id, t.root_title, t.root_owner FROM regulation_groups g
    JOIN tree t ON g.parent_group_id = t.id
    WHERE g.company_id = $1 AND g.state <> 'archived'
  )`;

const OWNER = `COALESCE(a.direct_owner_membership_id, rg.owner_membership_id)`;

async function loadFacts(companyId: string, asOf: string) {
  const [groups, top, upcoming, coverage] = await Promise.all([
    query(
      `${GROUP_TREE}
       SELECT COALESCE(t.root_title, 'Not in a group') AS name,
              bool_or(t.root_owner IS NOT NULL) AS has_owner,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE p.effective_priority = 'critical') AS critical,
              COUNT(*) FILTER (WHERE p.effective_priority = 'high') AS high,
              COUNT(*) FILTER (WHERE p.effective_priority = 'moderate') AS moderate,
              COUNT(*) FILTER (WHERE p.next_compliance_deadline < $2::date) AS overdue,
              COUNT(*) FILTER (WHERE p.next_compliance_deadline >= $2::date AND p.next_compliance_deadline <= $2::date + 30) AS due_30,
              COUNT(*) FILTER (WHERE ${OWNER} IS NULL) AS unassigned
       FROM alert_active_projections p
       JOIN alerts a ON a.id = p.alert_id AND a.archived_at IS NULL
       LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
       LEFT JOIN tree t ON t.id = a.primary_group_id
       WHERE p.company_id = $1 AND p.is_active
       GROUP BY 1`,
      [companyId, asOf]
    ),
    // The highest-scoring critical / high alerts
    query(
      `${GROUP_TREE}
       SELECT a.id, a.title, p.effective_priority AS priority, p.effective_total AS score,
              t.root_title AS group_name, a.jurisdiction_raw AS jurisdiction,
              to_char(p.next_compliance_deadline, 'YYYY-MM-DD') AS deadline, up.display_name AS owner
       FROM alert_active_projections p
       JOIN alerts a ON a.id = p.alert_id AND a.archived_at IS NULL
       LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
       LEFT JOIN tree t ON t.id = a.primary_group_id
       LEFT JOIN memberships m ON m.id = ${OWNER}
       LEFT JOIN user_profiles up ON up.id = m.user_id
       WHERE p.company_id = $1 AND p.is_active AND p.effective_priority IN ('critical', 'high')
       ORDER BY (p.effective_priority = 'critical') DESC, p.effective_total DESC NULLS LAST, p.next_compliance_deadline NULLS LAST
       LIMIT 5`,
      [companyId]
    ),
    query(
      `SELECT a.id, a.title, p.effective_priority AS priority, NULL::int AS score, NULL AS group_name, NULL AS jurisdiction,
              to_char(p.next_compliance_deadline, 'YYYY-MM-DD') AS deadline, up.display_name AS owner
       FROM alert_active_projections p
       JOIN alerts a ON a.id = p.alert_id AND a.archived_at IS NULL
       LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
       LEFT JOIN memberships m ON m.id = ${OWNER}
       LEFT JOIN user_profiles up ON up.id = m.user_id
       WHERE p.company_id = $1 AND p.is_active
         AND p.next_compliance_deadline >= $2::date AND p.next_compliance_deadline <= $2::date + 30
       ORDER BY p.next_compliance_deadline, p.effective_total DESC NULLS LAST
       LIMIT 6`,
      [companyId, asOf]
    ),
    query(
      `SELECT
         COUNT(*) FILTER (WHERE p.effective_priority IN ('critical', 'high')) AS crit_high,
         COUNT(*) FILTER (WHERE p.effective_priority IN ('critical', 'high') AND ${OWNER} IS NOT NULL) AS crit_high_owned,
         COUNT(*) FILTER (WHERE p.effective_priority IN ('critical', 'high') AND p.next_compliance_deadline < $2::date) AS crit_high_overdue,
         COUNT(*) FILTER (WHERE p.next_compliance_deadline >= $2::date AND p.next_compliance_deadline <= $2::date + 30) AS due_30,
         COUNT(*) FILTER (WHERE p.next_compliance_deadline >= $2::date AND p.next_compliance_deadline <= $2::date + 30 AND ${OWNER} IS NOT NULL) AS due_30_owned,
         COUNT(*) FILTER (WHERE p.next_compliance_deadline >= $2::date AND p.next_compliance_deadline <= $2::date + 90) AS due_90
       FROM alert_active_projections p
       JOIN alerts a ON a.id = p.alert_id AND a.archived_at IS NULL
       LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
       WHERE p.company_id = $1 AND p.is_active`,
      [companyId, asOf]
    ),
  ]);

  const c = coverage.rows[0] ?? {};
  return {
    groups: groups.rows.map((g) => ({
      name: g.name, has_owner: !!g.has_owner, total: n(g.total), critical: n(g.critical), high: n(g.high),
      moderate: n(g.moderate), overdue: n(g.overdue), due_30: n(g.due_30), unassigned: n(g.unassigned),
    })) as GroupStat[],
    top: top.rows as AlertRow[],
    upcoming: upcoming.rows as AlertRow[],
    critHigh: n(c.crit_high),
    critHighOwned: n(c.crit_high_owned),
    critHighOverdue: n(c.crit_high_overdue),
    due30: n(c.due_30),
    due30Owned: n(c.due_30_owned),
    due90: n(c.due_90),
  };
}

type Facts = Awaited<ReturnType<typeof loadFacts>>;

function rating(s: ReportSnapshot, f: Facts): Rag {
  if (f.critHighOverdue > 0 || s.critical >= Math.max(5, s.total_alerts * 0.15)) return "red";
  if (s.critical > 0 || s.high > 0 || s.overdue > 0 || pct(s.unassigned, s.total_alerts) > 25) return "amber";
  return "green";
}

function change(now: number, before: number | undefined, label: string): string | null {
  if (before === undefined || now === before) return null;
  return `${label} ${now > before ? "up" : "down"} ${Math.abs(now - before)}`;
}

function groupLevel(g: GroupStat): RiskLevel {
  if (g.critical) return "high";
  if (g.high) return "med_high";
  if (g.moderate) return "medium";
  return "low";
}

function groupTrend(g: GroupStat, prev: ReportSnapshot | null): Trend {
  const before = prev?.by_group?.find((p) => p.name === g.name);
  if (!before) return "stable";
  const now = g.critical + g.high;
  const then = before.critical + before.high;
  return now > then ? "rising" : now < then ? "falling" : "stable";
}

function groupFocus(g: GroupStat): string {
  if (g.overdue) return `Recover ${plural(g.overdue, "overdue deadline")}`;
  if (g.due_30) return `${plural(g.due_30, "deadline")} in the next 30 days`;
  if (g.unassigned) return `Assign owners to ${plural(g.unassigned, "alert")}`;
  return "Monitor";
}

const weight = (g: GroupStat) => g.critical * 100 + g.high * 10 + g.moderate + g.overdue * 50;

function coverageStatus(percent: number): ScoreStatus {
  if (percent >= 95) return "complete";
  if (percent >= 60) return "in_progress";
  if (percent >= 30) return "at_risk";
  return "open";
}

/** A complete, freshly generated report. */
export async function generateContent(
  companyId: string, snapshot: ReportSnapshot, previous: ReportSnapshot | null,
): Promise<ReportContent> {
  const s = snapshot;
  const f = await loadFacts(companyId, s.as_of);
  const rag = rating(s, f);
  const critHigh = s.critical + s.high;
  const scored = s.total_alerts - s.unscored;
  const assigned = s.total_alerts - s.unassigned;

  const ranked = [...f.groups].filter((g) => g.name !== "Not in a group" || g.critical + g.high > 0).sort((a, b) => weight(b) - weight(a));
  const hot = ranked.filter((g) => g.critical + g.high > 0).slice(0, 2);

  // ── cover ──
  const changes = [change(s.critical, previous?.critical, "Critical"), change(s.high, previous?.high, "high")].filter(Boolean);
  const ranking = [
    `${plural(s.total_alerts, "active alert")}: ${s.critical} critical, ${s.high} high.`,
    s.overdue ? `${plural(s.overdue, "deadline")} overdue.` : "No overdue deadlines.",
    changes.length ? `${changes.join(", ")} vs last month.` : null,
  ].filter(Boolean).join(" ");

  // ── summary ──
  const leadership = [
    hot.length
      ? `Highest exposure: ${hot.map((g) => `${g.name} (${[g.critical && `${g.critical} critical`, g.high && `${g.high} high`].filter(Boolean).join(", ")})`).join(" and ")}.`
      : "No critical or high alerts this month.",
    s.unassigned ? `${plural(s.unassigned, "alert")} (${pct(s.unassigned, s.total_alerts)}%) without an owner.` : "Every alert has an owner.",
  ].join(" ");
  const business = critHigh
    ? `${plural(critHigh, "critical/high alert")} could affect market access; ${plural(f.due90, "deadline")} fall in the next 90 days.`
    : `No material market-access exposure; ${plural(f.due90, "deadline")} in the next 90 days.`;

  // ── priorities ──
  const priorities: PriorityRow[] = ranked.slice(0, 6).map((g) => ({
    area: g.name,
    level: groupLevel(g),
    trend: groupTrend(g, previous),
    exposure: [plural(g.total, "alert"), g.critical && `${g.critical} critical`, g.high && `${g.high} high`].filter(Boolean).join(" · "),
    focus: groupFocus(g),
    out_of_scope: false,
  }));

  // ── decisions ──
  const ownerless = ranked.filter((g) => g.name !== "Not in a group" && !g.has_owner && g.critical + g.high > 0).map((g) => g.name);
  const decisions = [
    f.critHigh > f.critHighOwned && `Assign owners to ${plural(f.critHigh - f.critHighOwned, "critical/high alert")} without one.`,
    s.overdue && `Approve a recovery plan for ${plural(s.overdue, "overdue deadline")}.`,
    ownerless.length && `Name an accountable owner for ${ownerless.slice(0, 3).join(", ")}.`,
    s.unscored && `Complete risk scoring for ${plural(s.unscored, "unscored alert")}.`,
  ].filter((d): d is string => typeof d === "string").slice(0, 4);

  // ── risks ──
  const risks: RiskDetail[] = f.top.map((a) => {
    const days = a.deadline ? Math.round((Date.parse(a.deadline) - Date.parse(s.as_of)) / 86400000) : null;
    return {
      title: short(a.title),
      alert_id: a.id,
      level: a.priority === "critical" ? "high" : "med_high",
      evidence: [a.group_name, a.jurisdiction && short(a.jurisdiction, 40), a.score != null && `score ${a.score}`].filter(Boolean).join(" · "),
      next_actions: !a.deadline ? "Set a compliance deadline"
        : days! < 0 ? `Overdue since ${day(a.deadline)}`
        : `Deadline ${day(a.deadline)} (${plural(days!, "day")})`,
      leadership_role: a.owner ? `Owner: ${a.owner}` : "No owner — assign one",
    };
  });

  // ── scorecard ──
  const scorecard: ScorecardRow[] = [
    { indicator: "Alerts with an owner", status: coverageStatus(pct(assigned, s.total_alerts)), desired: "All owned", interpretation: `${assigned} of ${s.total_alerts} (${pct(assigned, s.total_alerts)}%)` },
    { indicator: "Critical & high alerts owned", status: coverageStatus(pct(f.critHighOwned, f.critHigh)), desired: "All owned", interpretation: f.critHigh ? `${f.critHighOwned} of ${f.critHigh}` : "None open" },
    { indicator: "Alerts risk-scored", status: coverageStatus(pct(scored, s.total_alerts)), desired: "All scored", interpretation: `${scored} of ${s.total_alerts} (${pct(scored, s.total_alerts)}%)` },
    { indicator: "Deadlines on time", status: s.overdue ? "open" : "complete", desired: "None overdue", interpretation: s.overdue ? `${plural(s.overdue, "overdue deadline")}` : "No overdue deadlines" },
    { indicator: "Next-30-day deadlines owned", status: coverageStatus(pct(f.due30Owned, f.due30)), desired: "All owned", interpretation: f.due30 ? `${f.due30Owned} of ${f.due30}` : "None due" },
  ];

  // ── next 30 days ──
  const next = f.upcoming.length
    ? f.upcoming.map((a) => `${day(a.deadline!)} — ${short(a.title, 70)}${a.owner ? ` (${a.owner})` : " (no owner)"}`)
    : ["No compliance deadlines in the next 30 days."];

  return {
    rag,
    posture: rag === "red" ? "High — urgent action required" : rag === "amber" ? "Elevated, with active mitigation" : "Stable and under control",
    posture_callout: rag === "red" ? "Escalation needed" : rag === "amber" ? "Leadership support needed" : "On track",
    purpose: "Monthly view of product regulatory risk, generated from the RiskOrbit alert register.",
    ranking,
    prepared_for: "Executive Leadership and Risk Council",
    prepared_by: "RiskOrbit (generated automatically)",
    leadership_assessment: leadership,
    business_implications: business,
    priorities,
    decisions,
    risks,
    scorecard,
    scorecard_note: "",
    next_30_days: next,
    edited: [],
  };
}

/**
 * Regenerates the report but keeps every section someone edited.
 * `only` limits regeneration to the given sections (used by "Reset to automatic").
 */
export async function regenerate(
  companyId: string, current: ReportContent, snapshot: ReportSnapshot, previous: ReportSnapshot | null, only?: SectionKey[],
): Promise<ReportContent> {
  const fresh = await generateContent(companyId, snapshot, previous);
  const targets = only ?? SECTION_KEYS.filter((k) => !current.edited.includes(k));
  const merged = copySections(current, fresh, targets);
  return { ...merged, edited: current.edited.filter((k) => !targets.includes(k)) };
}
