/**
 * Confidence of a scoring factor rating (browser-safe).
 * The import may send words (High / Medium / Low) or numbers (85%, 0.85, 85);
 * both are stored as display text: "High", "Medium", "Low" or "85%".
 */

export type ConfidenceLevel = "high" | "medium" | "low";

export const CONFIDENCE_CHOICES = ["High", "Medium", "Low"] as const;

const WORDS: Record<string, string> = {
  "very high": "Very high",
  high: "High",
  h: "High",
  medium: "Medium",
  med: "Medium",
  moderate: "Medium",
  m: "Medium",
  low: "Low",
  l: "Low",
  "very low": "Very low",
};

export function normalizeConfidence(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text || text === "-" || /^n\/?a$/i.test(text)) return null;
  const word = WORDS[text.toLowerCase().replace(/\s+/g, " ")];
  if (word) return word;
  const num = text.match(/^(\d+(?:\.\d+)?)\s*%?$/);
  if (num) {
    let n = parseFloat(num[1]);
    if (!text.includes("%") && n <= 1) n *= 100;
    if (n >= 0 && n <= 100) return `${Math.round(n)}%`;
  }
  return text.slice(0, 40);
}

/** Bucket for colouring: percentages ≥ 75 are high, ≥ 50 medium, otherwise low. */
export function confidenceLevel(value: string | null | undefined): ConfidenceLevel | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v.includes("high")) return "high";
  if (v.includes("medium")) return "medium";
  if (v.includes("low")) return "low";
  const n = parseFloat(v);
  if (!isNaN(n)) return n >= 75 ? "high" : n >= 50 ? "medium" : "low";
  return null;
}
