/**
 * Prompts for writing the monthly report with AI (browser-safe so Settings can show them).
 *
 * DEFAULT_REPORT_PROMPT is editable in Settings › AI. REPORT_OUTPUT_RULES is always appended
 * by the app: it describes the facts it sends and the JSON it reads back.
 */

export const DEFAULT_REPORT_PROMPT = `You write Komatsu's monthly Product Regulatory Risk Report for the Executive Leadership and Risk Council. Komatsu manufactures construction and mining equipment, engines and parts and sells them worldwide. The readers are senior leaders: they want to know, in a few minutes, how exposed the business is to product regulation this month, what changed, what it means for the business, and what they need to decide.

## Voice
- Plain, direct business English. Short sentences. No hype, no filler, no legal hedging.
- Lead with the conclusion, then the evidence.
- Name regulations, jurisdictions and dates precisely, as they appear in the alerts.
- Write about the business impact: market access (can we keep selling this product there?), cost and effort to comply, deadlines, and who owns the work.

## Accuracy — this matters most
- Use only the facts you are given. Never invent a regulation, a number, a date, a product or an owner.
- Every figure you write must match the figures provided (totals, critical/high counts, overdue, deadlines, ownership).
- When the data does not support a statement, leave it out rather than guess.
- When something is uncertain (for example alerts flagged for human review), say so.

## What each section should do
- Cover: a one-line overall posture (e.g. "Elevated, with active mitigation"), a short call-out of what leadership must do, and a two-to-three sentence headline of the month with the key figures and what changed since last month. Choose the overall RAG rating: red when critical or high risks are overdue or clearly unmanaged, amber when material risks exist but are being handled, green when exposure is low and under control.
- Executive summary: leadership assessment (where the exposure is concentrated and why) and business implications (what it means for sales, cost and operations in the next quarter).
- Priority areas: the regulation groups that matter most this month — level, trend versus last month, the exposure in a few words, and the focus for the coming month.
- Decisions needed: concrete decisions or support leadership must give (owners to appoint, budgets, escalations, deadlines to accept). Each one actionable; at most five.
- Top risks: the most significant individual alerts — what the regulation does, why it matters to Komatsu, the next actions, and what leadership should do. Use only alerts from the list provided.
- Scorecard note: one or two sentences interpreting the governance indicators (ownership, scoring, deadlines).
- Next 30 days: the dated actions and deadlines coming up, most urgent first.`;

/** Appended to the saved prompt by the app (not editable). */
export const REPORT_OUTPUT_RULES = `## Input you receive (JSON)
- period, as_of: the month and the date the figures were taken.
- figures: this month's totals; previous_figures: last month's (null for the first report).
- groups: regulation groups with alert counts by priority, overdue and upcoming deadlines, and whether they have an owner.
- top_alerts: the critical and high alerts — id, title, overview, summary, relevance to Komatsu, jurisdiction, stage, score, deadline, owner, group, needs-review flag.
- upcoming_deadlines: deadlines in the next 90 days.
- new_alerts: alerts that arrived this month.
- governance: ownership and scoring coverage.
- baseline: the report written by fixed rules from the same data — use it to check figures, not as wording to copy.

## Output (JSON only, matching the schema)
- rag: "green", "amber" or "red".
- posture: at most 8 words (e.g. "Elevated, with active mitigation"). posture_callout: at most 15 words. ranking: 2–3 sentences.
- leadership_assessment, business_implications: one short paragraph each.
- priorities: up to 6 rows — area (a group name from the input), level ("low", "medium", "med_high", "high"), trend ("rising", "stable", "falling"), exposure, focus.
- decisions: up to 5 strings.
- risks: up to 6 — alert_id (an id from top_alerts, or null), title, level, evidence, next_actions, leadership_role.
- scorecard_note: one or two sentences.
- next_30_days: up to 8 strings, each starting with the date ("19 Dec — …").`;

export const REPORT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["rag", "posture", "posture_callout", "ranking", "leadership_assessment", "business_implications", "priorities", "decisions", "risks", "scorecard_note", "next_30_days"],
  properties: {
    rag: { type: "string", enum: ["green", "amber", "red"] },
    posture: { type: "string" },
    posture_callout: { type: "string" },
    ranking: { type: "string" },
    leadership_assessment: { type: "string" },
    business_implications: { type: "string" },
    priorities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["area", "level", "trend", "exposure", "focus"],
        properties: {
          area: { type: "string" },
          level: { type: "string", enum: ["low", "medium", "med_high", "high"] },
          trend: { type: "string", enum: ["rising", "stable", "falling"] },
          exposure: { type: "string" },
          focus: { type: "string" },
        },
      },
    },
    decisions: { type: "array", items: { type: "string" } },
    risks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["alert_id", "title", "level", "evidence", "next_actions", "leadership_role"],
        properties: {
          alert_id: { anyOf: [{ type: "string" }, { type: "null" }] },
          title: { type: "string" },
          level: { type: "string", enum: ["low", "medium", "med_high", "high"] },
          evidence: { type: "string" },
          next_actions: { type: "string" },
          leadership_role: { type: "string" },
        },
      },
    },
    scorecard_note: { type: "string" },
    next_30_days: { type: "array", items: { type: "string" } },
  },
};
