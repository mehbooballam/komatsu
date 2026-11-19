import { query } from "@/lib/db";
import { completeJson, ProviderError } from "@/lib/ai/providers";
import { loadAiSettings } from "@/lib/ai/settings";
import { providerConfig } from "@/lib/grouping/ai";
import { generateContent, loadFacts } from "@/lib/reports-generate";
import { REPORT_OUTPUT_RULES, REPORT_SCHEMA } from "@/lib/reports-ai-prompt";
import {
  SECTION_KEYS, sanitizeContent,
  type ReportContent, type ReportSnapshot, type RiskLevel, type SectionKey, type Trend,
} from "@/lib/reports";

/**
 * Writes the monthly report with the configured language model, from the alert register:
 * figures, regulation groups, the critical/high alerts with their summaries, deadlines and
 * new alerts. Figures in the scorecard stay calculated; the model writes the text.
 * Anything the model returns that does not fit (unknown alert, bad value) falls back to
 * the rule-based text.
 */

/** Sections the AI writes (the scorecard rows stay calculated; the AI writes its note). */
export const AI_SECTIONS: SectionKey[] = ["cover", "summary", "priorities", "decisions", "risks", "scorecard", "next_30_days"];

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const clean = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ""));

async function loadAlertContext(companyId: string, asOf: string, period: string) {
  const OWNER = `COALESCE(a.direct_owner_membership_id, rg.owner_membership_id)`;
  const [top, upcoming, fresh, review] = await Promise.all([
    query(
      `SELECT a.id, a.title, a.overview, a.summary, a.relevance, a.jurisdiction_raw, a.stage, a.human_review_required,
              p.effective_priority AS priority, p.effective_total AS score, to_char(p.next_compliance_deadline, 'YYYY-MM-DD') AS deadline,
              up.display_name AS owner, rg.title AS group_title
       FROM alert_active_projections p
       JOIN alerts a ON a.id = p.alert_id AND a.archived_at IS NULL
       LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
       LEFT JOIN memberships m ON m.id = ${OWNER}
       LEFT JOIN user_profiles up ON up.id = m.user_id
       WHERE p.company_id = $1 AND p.is_active AND p.effective_priority IN ('critical', 'high', 'moderate')
       ORDER BY CASE p.effective_priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, p.effective_total DESC NULLS LAST
       LIMIT 15`,
      [companyId]
    ),
    query(
      `SELECT a.title, p.effective_priority AS priority, to_char(p.next_compliance_deadline, 'YYYY-MM-DD') AS deadline, up.display_name AS owner
       FROM alert_active_projections p
       JOIN alerts a ON a.id = p.alert_id AND a.archived_at IS NULL
       LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
       LEFT JOIN memberships m ON m.id = ${OWNER}
       LEFT JOIN user_profiles up ON up.id = m.user_id
       WHERE p.company_id = $1 AND p.is_active AND p.next_compliance_deadline >= $2::date AND p.next_compliance_deadline <= $2::date + 90
       ORDER BY p.next_compliance_deadline LIMIT 20`,
      [companyId, asOf]
    ),
    query(
      `SELECT a.title, COALESCE(p.effective_priority, 'unscored') AS priority, a.jurisdiction_raw
       FROM alerts a LEFT JOIN alert_active_projections p ON p.alert_id = a.id
       WHERE a.company_id = $1 AND a.archived_at IS NULL AND date_trunc('month', a.created_at) = date_trunc('month', $2::date)
       ORDER BY p.effective_total DESC NULLS LAST LIMIT 20`,
      [companyId, period]
    ),
    query(`SELECT COUNT(*)::int AS n FROM alerts WHERE company_id = $1 AND archived_at IS NULL AND human_review_required`, [companyId]),
  ]);
  return { top: top.rows, upcoming: upcoming.rows, fresh: fresh.rows, needsReview: review.rows[0]?.n ?? 0 };
}

const LEVELS: RiskLevel[] = ["low", "medium", "med_high", "high"];
const TRENDS: Trend[] = ["rising", "stable", "falling"];

/** Returns the report with the AI-written sections (other sections untouched). */
export async function writeReportWithAI(
  companyId: string,
  current: ReportContent,
  snapshot: ReportSnapshot,
  previous: ReportSnapshot | null,
  period: string
): Promise<{ content: ReportContent; model: string; usage: { input_tokens: number; output_tokens: number } }> {
  const settings = await loadAiSettings(companyId);
  const cfg = await providerConfig(companyId, settings);
  const [baseline, facts, ctx] = await Promise.all([
    generateContent(companyId, snapshot, previous),
    loadFacts(companyId, snapshot.as_of),
    loadAlertContext(companyId, snapshot.as_of, period),
  ]);

  const input = {
    period: period.slice(0, 7),
    as_of: snapshot.as_of,
    figures: snapshot,
    previous_figures: previous,
    groups: facts.groups
      .sort((a, b) => b.critical * 100 + b.high * 10 + b.moderate + b.overdue * 50 - (a.critical * 100 + a.high * 10 + a.moderate + a.overdue * 50))
      .slice(0, 15),
    top_alerts: ctx.top.map((a) =>
      clean({
        id: a.id,
        title: a.title,
        priority: a.priority,
        score: a.score,
        overview: clip(a.overview, 300),
        summary: clip(a.summary, 700),
        relevance: clip(a.relevance, 400),
        jurisdiction: a.jurisdiction_raw,
        stage: a.stage,
        deadline: a.deadline,
        owner: a.owner ?? "none",
        group: a.group_title,
        needs_human_review: a.human_review_required || undefined,
      })
    ),
    upcoming_deadlines: ctx.upcoming.map((a) => clean({ date: a.deadline, title: clip(a.title, 140), priority: a.priority, owner: a.owner ?? "none" })),
    new_alerts: ctx.fresh.map((a) => clean({ title: clip(a.title, 140), priority: a.priority, jurisdiction: a.jurisdiction_raw })),
    governance: {
      critical_high: facts.critHigh,
      critical_high_owned: facts.critHighOwned,
      critical_high_overdue: facts.critHighOverdue,
      due_30_days: facts.due30,
      due_30_days_owned: facts.due30Owned,
      due_90_days: facts.due90,
      needs_human_review: ctx.needsReview,
      scorecard: baseline.scorecard,
    },
    baseline: {
      rag: baseline.rag,
      ranking: baseline.ranking,
      leadership_assessment: baseline.leadership_assessment,
      business_implications: baseline.business_implications,
      decisions: baseline.decisions,
    },
  };

  const system = `${(settings.report_prompt || "").trim()}\n\n${REPORT_OUTPUT_RULES}`;
  const answer = await completeJson(cfg, { system, user: JSON.stringify(input), schema: REPORT_SCHEMA, maxTokens: 32000 });
  const o = (answer.json && typeof answer.json === "object" ? answer.json : {}) as Record<string, unknown>;
  const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim() : fallback);
  const strings = (v: unknown, max: number) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()).slice(0, max) : [];
  const knownAlerts = new Map(ctx.top.map((a) => [a.id as string, a]));

  const priorities = (Array.isArray(o.priorities) ? o.priorities : []).slice(0, 6).flatMap((r) => {
    const p = (r ?? {}) as Record<string, unknown>;
    const area = text(p.area, "");
    if (!area) return [];
    return [{
      area,
      level: LEVELS.includes(p.level as RiskLevel) ? (p.level as RiskLevel) : "",
      trend: TRENDS.includes(p.trend as Trend) ? (p.trend as Trend) : "",
      exposure: text(p.exposure, ""),
      focus: text(p.focus, ""),
      out_of_scope: false,
    }];
  });
  const risks = (Array.isArray(o.risks) ? o.risks : []).slice(0, 6).flatMap((r) => {
    const p = (r ?? {}) as Record<string, unknown>;
    const id = typeof p.alert_id === "string" && knownAlerts.has(p.alert_id) ? p.alert_id : undefined;
    const title = text(p.title, id ? String(knownAlerts.get(id)!.title) : "");
    if (!title) return [];
    return [{
      title,
      ...(id ? { alert_id: id } : {}),
      level: LEVELS.includes(p.level as RiskLevel) ? (p.level as RiskLevel) : "",
      evidence: text(p.evidence, ""),
      next_actions: text(p.next_actions, ""),
      leadership_role: text(p.leadership_role, ""),
    }];
  });
  const decisions = strings(o.decisions, 5);
  const next = strings(o.next_30_days, 8);

  // Only sections nobody edited by hand are rewritten
  const write = AI_SECTIONS.filter((k) => !current.edited.includes(k));
  const ai: Partial<ReportContent> = {};
  if (write.includes("cover")) {
    Object.assign(ai, {
      rag: o.rag === "green" || o.rag === "amber" || o.rag === "red" ? o.rag : baseline.rag,
      posture: text(o.posture, baseline.posture),
      posture_callout: text(o.posture_callout, baseline.posture_callout),
      ranking: text(o.ranking, baseline.ranking),
      purpose: current.purpose || baseline.purpose,
      prepared_for: current.prepared_for || baseline.prepared_for,
      prepared_by: `RiskOrbit with AI (${answer.model})`,
    });
  }
  if (write.includes("summary")) {
    ai.leadership_assessment = text(o.leadership_assessment, baseline.leadership_assessment);
    ai.business_implications = text(o.business_implications, baseline.business_implications);
  }
  if (write.includes("priorities")) ai.priorities = priorities.length ? priorities : baseline.priorities;
  if (write.includes("decisions")) ai.decisions = decisions.length ? decisions : baseline.decisions;
  if (write.includes("risks")) ai.risks = risks.length ? risks : baseline.risks;
  if (write.includes("scorecard")) {
    ai.scorecard = baseline.scorecard;
    ai.scorecard_note = text(o.scorecard_note, baseline.scorecard_note);
  }
  if (write.includes("next_30_days")) ai.next_30_days = next.length ? next : baseline.next_30_days;

  const content = sanitizeContent({
    ...current,
    ...ai,
    ai_sections: SECTION_KEYS.filter((k) => write.includes(k) || current.ai_sections.includes(k)),
    ai_written_at: new Date().toISOString(),
    ai_model: answer.model,
  });
  return { content, model: answer.model, usage: answer.usage };
}

export { ProviderError };
