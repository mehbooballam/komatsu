export const IMPORT_COLUMNS = [
  "alert_id",
  "category_algorithm_defined",
  "category_user_defined",
  "title",
  "overview",
  "summary",
  "published_on",
  "key_dates",
  "date_relevance",
  "jurisdiction",
  "agency_name",
  "source",
  "link",
  "topic_match",
  "product",
  "status",
  "status_summary",
  "status_details",
  "timing",
  "timing_summary",
  "timing_details",
  "change_type",
  "change_summary",
  "change_details",
  "source_context",
  "source_context_summary",
  "source_context_details",
  "market_access_risk",
  "cost_to_implement",
  "human_resources",
  "urgency",
  "overall_impact_score",
  "needs_human_review",
  "compliance_deadline",
  "market_access_risk_rationale",
  "cost_to_implement_rationale",
  "human_resources_rationale",
  "urgency_rationale",
  "market_access_risk_confidence",
  "cost_to_implement_confidence",
  "human_resources_confidence",
  "urgency_confidence",
  // Older files only (still read, not in the template)
  "deadline_description",
  "relevance",
] as const;

export type ImportColumnName = (typeof IMPORT_COLUMNS)[number];

/**
 * Columns the app knows but does not import. Empty since v2 scoring, where Human Resources
 * is a scored factor again; kept so a column can be switched off without removing it.
 */
export const NOT_IMPORTED = new Set<ImportColumnName>([]);

/** v1 snapshot columns ("Was Priority Level", "Was Escalation Applied", "Was Source Context"): never imported. */
export function isV1WasColumn(raw: string): boolean {
  return /^was\b/i.test(raw.trim());
}

/** Older layout columns: still read when a file has them, but not in the templates. */
export const LEGACY_COLUMNS = new Set<ImportColumnName>(["deadline_description", "relevance"]);

/** Columns listed in the templates (the current feed layout). */
export const IMPORTED_COLUMNS = IMPORT_COLUMNS.filter((c) => !NOT_IMPORTED.has(c) && !LEGACY_COLUMNS.has(c));

/** Plain text columns copied as-is onto the alert (alerts.<same name>). */
export const CONTEXT_TEXT_COLUMNS = [
  "category_user_defined",
  "key_dates",
  "date_relevance",
  "status_summary",
  "status_details",
  "timing_summary",
  "timing_details",
  "change_summary",
  "change_details",
  "source_context",
  "source_context_summary",
  "source_context_details",
] as const satisfies readonly ImportColumnName[];

export type FieldType =
  | "text"
  | "date"
  | "integer"
  | "multi_semicolon"
  | "multi_pipe"
  | "boolean";

export interface ColumnDef {
  name: ImportColumnName;
  label: string;
  type: FieldType;
  required: boolean;
  description: string;
}

export const COLUMN_DEFS: ColumnDef[] = [
  { name: "alert_id", label: "Alert ID", type: "text", required: true, description: "Stable external alert key, stored as text." },
  { name: "category_algorithm_defined", label: "Category (Algorithm Defined)", type: "text", required: false, description: "Raw Daptic recommendation, e.g. RECOMMEND_INCLUDE." },
  { name: "title", label: "Title", type: "text", required: true, description: "Short display title." },
  { name: "overview", label: "Overview", type: "text", required: false, description: "One-line takeaway." },
  { name: "summary", label: "Summary", type: "text", required: false, description: "Full summary, searchable." },
  { name: "published_on", label: "Published On", type: "date", required: false, description: "Source publication date." },
  { name: "compliance_deadline", label: "Compliance Deadline", type: "date", required: false, description: "Compliance deadline date (YYYY-MM-DD, DD.MM.YYYY or MM/DD/YYYY). Added to the alert's deadlines as unconfirmed." },
  { name: "category_user_defined", label: "Category (User Defined)", type: "text", required: false, description: "Category set by a person in the feed." },
  { name: "key_dates", label: "Key Dates", type: "text", required: false, description: "Important dates mentioned by the source." },
  { name: "date_relevance", label: "Date Relevance", type: "text", required: false, description: "Why those dates matter." },
  { name: "status_summary", label: "Status Summary", type: "text", required: false, description: "Short explanation of the regulatory status." },
  { name: "status_details", label: "Status Details", type: "text", required: false, description: "Full status explanation." },
  { name: "timing_summary", label: "Timing Summary", type: "text", required: false, description: "Short explanation of the timing." },
  { name: "timing_details", label: "Timing Details", type: "text", required: false, description: "Full timing explanation." },
  { name: "change_summary", label: "Change Summary", type: "text", required: false, description: "Short explanation of what changes." },
  { name: "change_details", label: "Change Details", type: "text", required: false, description: "Full explanation of the change." },
  { name: "source_context", label: "Source Context", type: "text", required: false, description: "Context about the source document." },
  { name: "source_context_summary", label: "Source Context Summary", type: "text", required: false, description: "Short source context." },
  { name: "source_context_details", label: "Source Context Details", type: "text", required: false, description: "Full source context." },
  { name: "deadline_description", label: "Deadline Description", type: "text", required: false, description: "Deadline context and evidence for classification." },
  { name: "jurisdiction", label: "Jurisdiction", type: "text", required: false, description: "Raw jurisdiction or source grouping." },
  { name: "agency_name", label: "Agency Name", type: "text", required: false, description: "Issuing agency or organisation from the feed." },
  { name: "source", label: "Source", type: "text", required: false, description: "Daptic feed or publisher." },
  { name: "link", label: "Link", type: "text", required: false, description: "Source URL." },
  { name: "topic_match", label: "Topic Match", type: "multi_pipe", required: false, description: "Source topics, pipe-delimited." },
  { name: "relevance", label: "Relevance", type: "text", required: false, description: "Daptic's explanation of relevance to Komatsu." },
  { name: "product", label: "Product", type: "multi_semicolon", required: false, description: "Daptic-inferred product labels, semicolon-delimited." },
  { name: "status", label: "Status", type: "text", required: false, description: "Regulatory stage: signal/information, draft, consultation open, final mandatory, final voluntary or unknown." },
  { name: "timing", label: "Timing", type: "text", required: false, description: "Raw source timing label." },
  { name: "change_type", label: "Change Type", type: "text", required: false, description: "Source change classification." },
  { name: "market_access_risk", label: "Market Access Risk", type: "integer", required: false, description: "Imported market-access rating (1, 3, 6, or 9)." },
  { name: "cost_to_implement", label: "Cost to Implement", type: "integer", required: false, description: "Imported implementation-cost rating (1, 3, 6, or 9)." },
  { name: "human_resources", label: "Human Resources", type: "integer", required: false, description: "Imported human-resources rating (1, 3, 6, or 9) from obligation points. Blank counts as 1." },
  { name: "urgency", label: "Urgency", type: "integer", required: false, description: "Imported urgency snapshot." },
  { name: "overall_impact_score", label: "Overall Impact Score", type: "integer", required: false, description: "Imported total snapshot." },
  { name: "market_access_risk_rationale", label: "Market Access Risk Rationale", type: "text", required: false, description: "Imported market-access explanation." },
  { name: "cost_to_implement_rationale", label: "Cost to Implement Rationale", type: "text", required: false, description: "Imported implementation-cost explanation." },
  { name: "human_resources_rationale", label: "Human Resources Rationale", type: "text", required: false, description: "Imported human-resources explanation (obligation points)." },
  { name: "urgency_rationale", label: "Urgency Rationale", type: "text", required: false, description: "Imported urgency explanation." },
  { name: "market_access_risk_confidence", label: "Market Access Risk Confidence", type: "text", required: false, description: "How sure the source is of the market-access rating: High / Medium / Low, or a percentage (85%, 0.85)." },
  { name: "cost_to_implement_confidence", label: "Cost to Implement Confidence", type: "text", required: false, description: "How sure the source is of the implementation-cost rating: High / Medium / Low, or a percentage." },
  { name: "human_resources_confidence", label: "Human Resources Confidence", type: "text", required: false, description: "How sure the source is of the human-resources rating: High / Medium / Low, or a percentage." },
  { name: "urgency_confidence", label: "Urgency Confidence", type: "text", required: false, description: "How sure the source is of the urgency rating: High / Medium / Low, or a percentage." },
  { name: "needs_human_review", label: "Needs Human Review", type: "boolean", required: false, description: "Yes/No (also True/False, Y/N, 1/0). Yes marks the alert Needs review until a person clears it. Any other text also flags it and is kept as the reason." },
];

const aliasEntries: [string, ImportColumnName][] = [
  ["alert id", "alert_id"],
  ["alertid", "alert_id"],
  ["alert_id", "alert_id"],
  ["id", "alert_id"],
  ["category algorithm defined", "category_algorithm_defined"],
  ["category_algorithm_defined", "category_algorithm_defined"],
  ["category", "category_algorithm_defined"],
  ["recommendation", "category_algorithm_defined"],
  ["title", "title"],
  ["alert title", "title"],
  ["overview", "overview"],
  ["summary", "summary"],
  ["published on", "published_on"],
  ["published_on", "published_on"],
  ["published date", "published_on"],
  ["publication date", "published_on"],
  ["deadline date", "compliance_deadline"],
  ["deadline_date", "compliance_deadline"],
  ["compliance deadline", "compliance_deadline"],
  ["compliance_deadline", "compliance_deadline"],
  ["category user defined", "category_user_defined"],
  ["category_user_defined", "category_user_defined"],
  ["user category", "category_user_defined"],
  ["key dates", "key_dates"],
  ["key_dates", "key_dates"],
  ["date relevance", "date_relevance"],
  ["date_relevance", "date_relevance"],
  ["status summary", "status_summary"],
  ["status_summary", "status_summary"],
  ["status details", "status_details"],
  ["status_details", "status_details"],
  ["timing summary", "timing_summary"],
  ["timing_summary", "timing_summary"],
  ["timing details", "timing_details"],
  ["timing_details", "timing_details"],
  ["change summary", "change_summary"],
  ["change_summary", "change_summary"],
  ["change details", "change_details"],
  ["change_details", "change_details"],
  ["source context", "source_context"],
  ["source_context", "source_context"],
  ["source context summary", "source_context_summary"],
  ["source_context_summary", "source_context_summary"],
  ["source context details", "source_context_details"],
  ["source_context_details", "source_context_details"],
  ["deadline", "compliance_deadline"],
  ["deadline description", "deadline_description"],
  ["deadline_description", "deadline_description"],
  ["jurisdiction", "jurisdiction"],
  ["country", "jurisdiction"],
  ["region", "jurisdiction"],
  ["agency name", "agency_name"],
  ["agency_name", "agency_name"],
  ["agency", "agency_name"],
  ["issuing agency", "agency_name"],
  ["source", "source"],
  ["publisher", "source"],
  ["feed", "source"],
  ["link", "link"],
  ["url", "link"],
  ["source url", "link"],
  ["source_url", "link"],
  ["topic match", "topic_match"],
  ["topic_match", "topic_match"],
  ["topics", "topic_match"],
  ["relevance", "relevance"],
  ["product", "product"],
  ["products", "product"],
  ["product lines", "product"],
  ["status", "status"],
  ["stage", "status"],
  ["regulatory stage", "status"],
  ["timing", "timing"],
  ["change type", "change_type"],
  ["change_type", "change_type"],
  ["market access risk", "market_access_risk"],
  ["market_access_risk", "market_access_risk"],
  ["market access", "market_access_risk"],
  ["cost to implement", "cost_to_implement"],
  ["cost_to_implement", "cost_to_implement"],
  ["implementation cost", "cost_to_implement"],
  ["human resources", "human_resources"],
  ["human_resources", "human_resources"],
  ["people", "human_resources"],
  ["additional people", "human_resources"],
  ["urgency", "urgency"],
  ["overall impact score", "overall_impact_score"],
  ["overall_impact_score", "overall_impact_score"],
  ["total score", "overall_impact_score"],
  ["impact score", "overall_impact_score"],
  ["market access risk rationale", "market_access_risk_rationale"],
  ["market_access_risk_rationale", "market_access_risk_rationale"],
  ["cost to implement rationale", "cost_to_implement_rationale"],
  ["cost_to_implement_rationale", "cost_to_implement_rationale"],
  ["human resources rationale", "human_resources_rationale"],
  ["human_resources_rationale", "human_resources_rationale"],
  ["urgency rationale", "urgency_rationale"],
  ["urgency_rationale", "urgency_rationale"],
  ["market access risk confidence", "market_access_risk_confidence"],
  ["market_access_risk_confidence", "market_access_risk_confidence"],
  ["market access confidence", "market_access_risk_confidence"],
  ["cost to implement confidence", "cost_to_implement_confidence"],
  ["cost_to_implement_confidence", "cost_to_implement_confidence"],
  ["implementation cost confidence", "cost_to_implement_confidence"],
  ["human resources confidence", "human_resources_confidence"],
  ["human_resources_confidence", "human_resources_confidence"],
  ["urgency confidence", "urgency_confidence"],
  ["urgency_confidence", "urgency_confidence"],
  ["need human review", "needs_human_review"],
  ["needs human review", "needs_human_review"],
  ["needs_human_review", "needs_human_review"],
  ["human review", "needs_human_review"],
  ["human review required", "needs_human_review"],
  ["requires human review", "needs_human_review"],
  ["need review", "needs_human_review"],
  ["needs review", "needs_human_review"],
  ["review required", "needs_human_review"],
];

const REVIEW_YES = new Set(["yes", "y", "true", "t", "1", "x", "required", "needed", "need review", "needs review", "review"]);
const REVIEW_NO = new Set(["no", "n", "false", "f", "0", "-", "none", "n/a", "na", "not required", "not needed"]);

/**
 * Reads the "Need Human Review" cell. Blank → null (no opinion from the feed).
 * Yes-like → flagged. No-like → not flagged. Any other text → flagged, and the
 * text is kept as the reason (e.g. "Yes – conflicting deadlines" or just a note).
 */
export function parseHumanReview(raw: string | null | undefined): { flag: boolean; reason: string | null } | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const key = text.toLowerCase().replace(/\s+/g, " ");
  if (REVIEW_NO.has(key)) return { flag: false, reason: null };
  if (REVIEW_YES.has(key)) return { flag: true, reason: null };
  // "Yes - reason" / "Yes: reason" / "TRUE (reason)"
  const lead = key.match(/^(yes|y|true|required|needed)\b[\s\-–—:,;(]*/);
  if (lead) {
    const reason = text.slice(lead[0].length).replace(/\)\s*$/, "").trim();
    return { flag: true, reason: reason || null };
  }
  const noLead = key.match(/^(no|false|not required)\b/);
  if (noLead) return { flag: false, reason: null };
  return { flag: true, reason: text.slice(0, 1000) };
}

export const HEADER_ALIASES: Map<string, ImportColumnName> = new Map(
  aliasEntries.map(([alias, col]) => [alias.toLowerCase().trim(), col])
);

export function normalizeHeader(raw: string): ImportColumnName | null {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ");
  if (isV1WasColumn(cleaned)) return null;
  const mapped = HEADER_ALIASES.get(cleaned) ?? null;
  return mapped && !NOT_IMPORTED.has(mapped) ? mapped : null;
}

export const RECOMMENDATION_MAP: Record<string, string> = {
  recommend_include: "recommend_include",
  recommend_exclude: "recommend_exclude",
  include: "recommend_include",
  exclude: "recommend_exclude",
};

export const VALID_RATINGS = new Set([1, 3, 6, 9]);

export const FACTOR_COLUMNS: ImportColumnName[] = [
  "market_access_risk",
  "cost_to_implement",
  "human_resources",
  "urgency",
];

export const FACTOR_KEY_MAP: Record<string, string> = {
  market_access_risk: "market_access",
  cost_to_implement: "cost_to_implement",
  human_resources: "human_resources",
  urgency: "urgency",
};

export const RATIONALE_COLUMNS: Record<string, ImportColumnName> = {
  market_access: "market_access_risk_rationale",
  cost_to_implement: "cost_to_implement_rationale",
  human_resources: "human_resources_rationale",
  urgency: "urgency_rationale",
};

export const CONFIDENCE_COLUMNS: Record<string, ImportColumnName> = {
  market_access: "market_access_risk_confidence",
  cost_to_implement: "cost_to_implement_confidence",
  human_resources: "human_resources_confidence",
  urgency: "urgency_confidence",
};

export const PLACEHOLDER_RATIONALE_PATTERN =
  /^\[rationale:\s*\d+.*sentences?\]$/i;

/** Where each import field ends up in the database (shown in the import mapping review). */
export const COLUMN_STORAGE: Record<ImportColumnName, string> = {
  alert_id: "alerts.external_alert_id — matches re-imports to the same alert",
  category_algorithm_defined: "alerts.recommendation and alerts.provider_review_state",
  category_user_defined: "alerts.category_user_defined",
  title: "alerts.title",
  overview: "alerts.overview",
  summary: "alerts.summary (searchable)",
  published_on: "alerts.published_on",
  key_dates: "alerts.key_dates",
  date_relevance: "alerts.date_relevance",
  jurisdiction: "alerts.jurisdiction_raw → mapped to countries (alert_geographies)",
  agency_name: "alerts.agency_name (also used for grouping)",
  source: "alerts.source_name",
  link: "alerts.source_url",
  topic_match: "alerts.topic_match and alert_topics",
  product: "alerts.product_raw → matched to Products (alert_product_links)",
  status: "alerts.stage",
  status_summary: "alerts.status_summary",
  status_details: "alerts.status_details",
  timing: "alerts.timing_raw",
  timing_summary: "alerts.timing_summary",
  timing_details: "alerts.timing_details",
  change_type: "alerts.change_type",
  change_summary: "alerts.change_summary",
  change_details: "alerts.change_details",
  source_context: "alerts.source_context",
  source_context_summary: "alerts.source_context_summary",
  source_context_details: "alerts.source_context_details",
  market_access_risk: "source_factor_ratings (market_access) → risk score A",
  cost_to_implement: "source_factor_ratings (cost_to_implement) → risk score B",
  human_resources: "source_factor_ratings (human_resources)",
  urgency: "source_factor_ratings (urgency) → risk score C",
  overall_impact_score: "Kept in the source revision only — the score is calculated (A × B × C × D)",
  needs_human_review: "alerts.human_review_required (Needs review flag)",
  compliance_deadline: "alert_deadlines (unconfirmed deadline)",
  market_access_risk_rationale: "source_factor_ratings.rationale (market_access)",
  cost_to_implement_rationale: "source_factor_ratings.rationale (cost_to_implement)",
  human_resources_rationale: "source_factor_ratings.rationale (human_resources)",
  urgency_rationale: "source_factor_ratings.rationale (urgency)",
  market_access_risk_confidence: "source_factor_ratings.confidence (market_access)",
  cost_to_implement_confidence: "source_factor_ratings.confidence (cost_to_implement)",
  human_resources_confidence: "source_factor_ratings.confidence (human_resources)",
  urgency_confidence: "source_factor_ratings.confidence (urgency)",
  deadline_description: "Kept in the source revision (older layout)",
  relevance: "alerts.relevance (older layout)",
};

/** Header text → the field it would map to, ignoring the NOT_IMPORTED rule (to explain skipped columns). */
export function aliasTarget(raw: string): ImportColumnName | null {
  const cleaned = raw.toLowerCase().trim().replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
  return HEADER_ALIASES.get(cleaned) ?? null;
}
