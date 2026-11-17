export const IMPORT_COLUMNS = [
  "alert_id",
  "category_algorithm_defined",
  "title",
  "overview",
  "summary",
  "published_on",
  "deadline_date",
  "deadline_description",
  "jurisdiction",
  "agency_name",
  "source",
  "link",
  "topic_match",
  "relevance",
  "product",
  "status",
  "timing",
  "change_type",
  "market_access_risk",
  "cost_to_implement",
  "human_resources",
  "urgency",
  "overall_impact_score",
  "market_access_risk_rationale",
  "cost_to_implement_rationale",
  "human_resources_rationale",
  "urgency_rationale",
] as const;

export type ImportColumnName = (typeof IMPORT_COLUMNS)[number];

export type FieldType =
  | "text"
  | "date"
  | "integer"
  | "multi_semicolon"
  | "multi_pipe";

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
  { name: "deadline_date", label: "Deadline Date", type: "date", required: false, description: "Raw published deadline date." },
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
  { name: "human_resources", label: "Human Resources (legacy)", type: "integer", required: false, description: "Legacy people rating. Optional — kept in upload history, not used in the score." },
  { name: "urgency", label: "Urgency", type: "integer", required: false, description: "Imported urgency snapshot." },
  { name: "overall_impact_score", label: "Overall Impact Score", type: "integer", required: false, description: "Imported total snapshot." },
  { name: "market_access_risk_rationale", label: "Market Access Risk Rationale", type: "text", required: false, description: "Imported market-access explanation." },
  { name: "cost_to_implement_rationale", label: "Cost to Implement Rationale", type: "text", required: false, description: "Imported implementation-cost explanation." },
  { name: "human_resources_rationale", label: "Human Resources Rationale", type: "text", required: false, description: "Imported people explanation." },
  { name: "urgency_rationale", label: "Urgency Rationale", type: "text", required: false, description: "Imported urgency explanation." },
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
  ["deadline date", "deadline_date"],
  ["deadline_date", "deadline_date"],
  ["deadline", "deadline_date"],
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
];

export const HEADER_ALIASES: Map<string, ImportColumnName> = new Map(
  aliasEntries.map(([alias, col]) => [alias.toLowerCase().trim(), col])
);

export function normalizeHeader(raw: string): ImportColumnName | null {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ");
  return HEADER_ALIASES.get(cleaned) ?? null;
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

export const PLACEHOLDER_RATIONALE_PATTERN =
  /^\[rationale:\s*\d+.*sentences?\]$/i;
