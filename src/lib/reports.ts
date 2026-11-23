/**
 * Monthly leadership risk report: structure, defaults and validation.
 * Types and pure helpers are safe to import in the browser; the snapshot
 * query lives in `reports-server.ts`.
 */

export type Rag = "green" | "amber" | "red";
export type RiskLevel = "" | "low" | "medium" | "med_high" | "high";
export type Trend = "" | "rising" | "stable" | "falling";
export type ScoreStatus = "" | "open" | "in_progress" | "at_risk" | "complete";

export interface PriorityRow {
  area: string;
  level: RiskLevel;
  trend: Trend;
  exposure: string;
  focus: string;
  out_of_scope: boolean;
}

export interface RiskDetail {
  title: string;
  /** Set when the risk was generated from an alert (links to it) */
  alert_id?: string;
  level: RiskLevel;
  evidence: string;
  next_actions: string;
  leadership_role: string;
}

export interface ScorecardRow {
  indicator: string;
  status: ScoreStatus;
  desired: string;
  interpretation: string;
}

export interface ReportContent {
  rag: Rag;
  posture: string;
  posture_callout: string;
  purpose: string;
  ranking: string;
  prepared_for: string;
  prepared_by: string;
  leadership_assessment: string;
  business_implications: string;
  priorities: PriorityRow[];
  decisions: string[];
  risks: RiskDetail[];
  scorecard: ScorecardRow[];
  scorecard_note: string;
  next_30_days: string[];
  /** Sections a person has edited; regeneration leaves these alone */
  edited: SectionKey[];
  /** Sections written by AI; refreshes keep them too (until rewritten or reset) */
  ai_sections: SectionKey[];
  ai_written_at: string | null;
  ai_model: string | null;
}

/** Sections of the report that are generated together and edited together. */
export const SECTION_FIELDS = {
  cover: ["rag", "posture", "posture_callout", "ranking", "prepared_for", "prepared_by", "purpose"],
  summary: ["leadership_assessment", "business_implications"],
  priorities: ["priorities"],
  decisions: ["decisions"],
  risks: ["risks"],
  scorecard: ["scorecard", "scorecard_note"],
  next_30_days: ["next_30_days"],
} as const satisfies Record<string, ReadonlyArray<keyof ReportContent>>;

export type SectionKey = keyof typeof SECTION_FIELDS;
export const SECTION_KEYS = Object.keys(SECTION_FIELDS) as SectionKey[];

/** Copies the given sections from `from` into `into`. */
export function copySections(into: ReportContent, from: ReportContent, sections: SectionKey[]): ReportContent {
  const next = { ...into } as Record<string, unknown>;
  for (const key of sections) for (const field of SECTION_FIELDS[key]) next[field] = (from as unknown as Record<string, unknown>)[field];
  return next as unknown as ReportContent;
}

export interface ReportSnapshot {
  as_of: string;
  total_alerts: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
  unscored: number;
  overdue: number;
  due_30_days: number;
  unassigned: number;
  new_this_month: number;
  /** Alerts per top-level regulation group (largest first; older reports may not have it) */
  by_group?: Array<{ name: string; total: number; critical: number; high: number }>;
  /** Compliance deadlines in each of the next 6 months ("2026-11") */
  deadlines?: Array<{ month: string; count: number }>;
}

/** One earlier (or this) month's figures, for the trend chart. */
export interface HistoryPoint {
  period: string;
  status: "draft" | "published";
  total_alerts: number;
  critical: number;
  high: number;
  overdue: number;
}

export interface ReportSummary {
  id: string;
  period: string;
  title: string;
  status: "draft" | "published";
  rag: Rag | null;
  updated_at: string;
  published_at: string | null;
  updated_by_name: string | null;
  published_by_name: string | null;
}

export interface ReportRecord extends ReportSummary {
  content: ReportContent;
  snapshot: ReportSnapshot | null;
  /** Up to 12 months of figures ending with this report, oldest first */
  history?: HistoryPoint[];
  snapshot_at: string | null;
  created_at: string;
}

export const RAG_LABELS: Record<Rag, string> = { green: "GREEN", amber: "AMBER", red: "RED" };
export const LEVEL_LABELS: Record<Exclude<RiskLevel, "">, string> = {
  low: "Low", medium: "Medium", med_high: "Med-High", high: "High",
};
export const TREND_LABELS: Record<Exclude<Trend, "">, string> = { rising: "Rising", stable: "Stable", falling: "Falling" };
export const STATUS_LABELS: Record<Exclude<ScoreStatus, "">, string> = {
  open: "Open", in_progress: "In progress", at_risk: "At risk", complete: "Complete",
};

const RAGS: Rag[] = ["green", "amber", "red"];
const LEVELS: RiskLevel[] = ["", "low", "medium", "med_high", "high"];
const TRENDS: Trend[] = ["", "rising", "stable", "falling"];
const STATUSES: ScoreStatus[] = ["", "open", "in_progress", "at_risk", "complete"];

export const MAX_ROWS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT = 300;
const LONG = 5000;

export const emptyPriority = (): PriorityRow => ({ area: "", level: "", trend: "", exposure: "", focus: "", out_of_scope: false });
export const emptyRisk = (): RiskDetail => ({ title: "", level: "", evidence: "", next_actions: "", leadership_role: "" });
export const emptyScorecard = (): ScorecardRow => ({ indicator: "", status: "", desired: "", interpretation: "" });

export function defaultContent(preparedBy = ""): ReportContent {
  return {
    rag: "amber",
    posture: "",
    posture_callout: "",
    purpose:
      "Provide senior leadership with a concise view of material product regulatory risks, business implications, mitigation progress, and decisions needed.",
    ranking: "",
    prepared_for: "Executive Leadership and Risk Council",
    prepared_by: preparedBy,
    leadership_assessment: "",
    business_implications: "",
    priorities: [emptyPriority()],
    decisions: [""],
    risks: [emptyRisk()],
    scorecard: [emptyScorecard()],
    scorecard_note: "",
    next_30_days: [""],
    edited: [],
    ai_sections: [],
    ai_written_at: null,
    ai_model: null,
  };
}

/** "2026-09-01" → "September 2026" */
export function periodLabel(period: string): string {
  const [y, m] = period.slice(0, 10).split("-").map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function defaultTitle(period: string): string {
  return `${periodLabel(period)} Product Regulatory Risk Report`;
}

/** Accepts "2026-09" or "2026-09-xx"; returns "2026-09-01" or null. */
export function normalizePeriod(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

// ── validation ──────────────────────────────────────────────────────────────

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}
function pick<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}
function list<T>(v: unknown, map: (item: unknown) => T): T[] {
  return Array.isArray(v) ? v.slice(0, MAX_ROWS).map(map) : [];
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Coerces untrusted JSON into a well-formed report (unknown keys dropped, text capped). */
export function sanitizeContent(input: unknown): ReportContent {
  const c = obj(input);
  return {
    rag: pick(c.rag, RAGS, "amber"),
    posture: str(c.posture, SHORT),
    posture_callout: str(c.posture_callout, SHORT),
    purpose: str(c.purpose, LONG),
    ranking: str(c.ranking, LONG),
    prepared_for: str(c.prepared_for, SHORT),
    prepared_by: str(c.prepared_by, SHORT),
    leadership_assessment: str(c.leadership_assessment, LONG),
    business_implications: str(c.business_implications, LONG),
    priorities: list(c.priorities, (r) => {
      const o = obj(r);
      return {
        area: str(o.area, SHORT),
        level: pick(o.level, LEVELS, ""),
        trend: pick(o.trend, TRENDS, ""),
        exposure: str(o.exposure, SHORT),
        focus: str(o.focus, SHORT),
        out_of_scope: o.out_of_scope === true,
      };
    }),
    decisions: list(c.decisions, (d) => str(d, SHORT * 2)),
    risks: list(c.risks, (r) => {
      const o = obj(r);
      const alertId = typeof o.alert_id === "string" && UUID.test(o.alert_id) ? o.alert_id : undefined;
      return {
        title: str(o.title, SHORT),
        ...(alertId ? { alert_id: alertId } : {}),
        level: pick(o.level, LEVELS, ""),
        evidence: str(o.evidence, LONG),
        next_actions: str(o.next_actions, LONG),
        leadership_role: str(o.leadership_role, LONG),
      };
    }),
    scorecard: list(c.scorecard, (r) => {
      const o = obj(r);
      return {
        indicator: str(o.indicator, SHORT),
        status: pick(o.status, STATUSES, ""),
        desired: str(o.desired, SHORT),
        interpretation: str(o.interpretation, SHORT),
      };
    }),
    scorecard_note: str(c.scorecard_note, LONG),
    next_30_days: list(c.next_30_days, (d) => str(d, SHORT * 2)),
    edited: Array.isArray(c.edited) ? SECTION_KEYS.filter((k) => (c.edited as unknown[]).includes(k)) : [],
    ai_sections: Array.isArray(c.ai_sections) ? SECTION_KEYS.filter((k) => (c.ai_sections as unknown[]).includes(k)) : [],
    ai_written_at: typeof c.ai_written_at === "string" ? c.ai_written_at.slice(0, 40) : null,
    ai_model: typeof c.ai_model === "string" ? c.ai_model.slice(0, 120) : null,
  };
}

/** Roles that can write, publish and delete reports (everyone with workspace-wide access can read). */
export function canEditReports(role: string | undefined): boolean {
  return role === "company_admin" || role === "manager";
}
