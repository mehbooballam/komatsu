/** Labels for regulatory-family grouping, safe to use in the browser. */

export type IdentifierKind = "rin" | "docket" | "bill" | "tracking" | "wto" | "cfr";

export const IDENTIFIER_LABELS: Record<IdentifierKind, string> = {
  rin: "RIN",
  docket: "Docket",
  bill: "Bill",
  tracking: "Agency tracking no.",
  wto: "WTO notification",
  cfr: "CFR part",
};

export type VersionType =
  | "proposed_rule" | "supplemental_proposal" | "final_rule" | "correction" | "amendment" | "enforcement_guidance" | "notice";

export const VERSION_LABELS: Record<VersionType, string> = {
  proposed_rule: "Proposed rule",
  supplemental_proposal: "Supplemental proposal",
  final_rule: "Final rule",
  correction: "Correction",
  amendment: "Amendment",
  enforcement_guidance: "Enforcement guidance",
  notice: "Notice / information",
};

export type GroupingMethod = "exact" | "strong" | "similarity" | "manual" | "ai" | "theme";

export const METHOD_LABELS: Record<GroupingMethod, string> = {
  exact: "Exact match",
  strong: "Strong match",
  similarity: "Similar subject",
  manual: "Grouped by hand",
  ai: "AI match",
  theme: "By theme (no regulation group found)",
};

export const LEVEL_LABELS = { family: "Regulatory family", action: "Regulatory action" } as const;
