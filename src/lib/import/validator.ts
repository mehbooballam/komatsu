import {
  VALID_RATINGS,
  VALID_CONFIDENCE,
  FACTOR_COLUMNS,
  CONFIDENCE_COLUMNS,
  DETAIL_COLUMNS,
  PLACEHOLDER_RATIONALE_PATTERN,
  parseHumanReview,
  CONTEXT_TEXT_COLUMNS,
  type ImportColumnName,
} from "./constants";
import type { ParsedRow } from "./parser-xlsx";
import { normalizeConfidence } from "@/lib/scoring/confidence";

export interface FieldError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidatedRow {
  rowNumber: number;
  raw: Record<string, string | null>;
  mapped: Partial<Record<ImportColumnName, string | null>>;
  presentColumns: Set<ImportColumnName>;
  parsed: Partial<Record<ImportColumnName, unknown>>;
  errors: FieldError[];
  warnings: FieldError[];
  isValid: boolean;
  isDuplicate: boolean;
}

export interface ValidationResult {
  rows: ValidatedRow[];
  totalValid: number;
  totalInvalid: number;
  totalDuplicates: number;
  fieldErrors: Record<string, number>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const EU_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const SLASH_YMD = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;

function parseDate(value: string): { date: string; valid: boolean } {
  const trimmed = value.trim();

  if (ISO_DATE.test(trimmed)) {
    const d = new Date(trimmed + "T00:00:00Z");
    if (!isNaN(d.getTime())) return { date: trimmed, valid: true };
  }

  const usMatch = trimmed.match(US_DATE);
  if (usMatch) {
    const m = usMatch[1].padStart(2, "0");
    const d = usMatch[2].padStart(2, "0");
    const y = usMatch[3];
    const isoStr = `${y}-${m}-${d}`;
    const dateObj = new Date(isoStr + "T00:00:00Z");
    if (!isNaN(dateObj.getTime())) return { date: isoStr, valid: true };
  }

  const euMatch = trimmed.match(EU_DATE);
  if (euMatch) {
    const d = euMatch[1].padStart(2, "0");
    const m = euMatch[2].padStart(2, "0");
    const y = euMatch[3];
    const isoStr = `${y}-${m}-${d}`;
    const dateObj = new Date(isoStr + "T00:00:00Z");
    if (!isNaN(dateObj.getTime())) return { date: isoStr, valid: true };
  }

  const slashMatch = trimmed.match(SLASH_YMD);
  if (slashMatch) {
    const y = slashMatch[1];
    const m = slashMatch[2].padStart(2, "0");
    const d = slashMatch[3].padStart(2, "0");
    const isoStr = `${y}-${m}-${d}`;
    const dateObj = new Date(isoStr + "T00:00:00Z");
    if (!isNaN(dateObj.getTime())) return { date: isoStr, valid: true };
  }

  return { date: trimmed, valid: false };
}

function parseInteger(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const num = Number(trimmed);
  if (!isNaN(num) && Number.isInteger(num)) return num;
  const floored = Math.round(parseFloat(trimmed));
  if (!isNaN(floored)) return floored;
  return null;
}

function cleanRationale(value: string | null): string | null {
  if (!value) return null;
  if (PLACEHOLDER_RATIONALE_PATTERN.test(value.trim())) return null;
  return value.trim();
}

export function validateRows(rows: ParsedRow[]): ValidationResult {
  const validatedRows: ValidatedRow[] = [];
  const seenAlertIds = new Map<string, number[]>();
  const fieldErrors: Record<string, number> = {};

  for (const row of rows) {
    const errors: FieldError[] = [];
    const warnings: FieldError[] = [];
    const parsed: Partial<Record<ImportColumnName, unknown>> = {};

    const alertId = row.mapped.alert_id;
    const title = row.mapped.title;

    if (!alertId) {
      errors.push({ field: "alert_id", message: "alert_id is required", severity: "error" });
    } else {
      parsed.alert_id = String(alertId);
      const existing = seenAlertIds.get(String(alertId));
      if (existing) {
        existing.push(row.rowNumber);
      } else {
        seenAlertIds.set(String(alertId), [row.rowNumber]);
      }
    }

    if (!title) {
      errors.push({ field: "title", message: "title is required", severity: "error" });
    } else {
      parsed.title = title;
    }

    if (row.mapped.overview) parsed.overview = row.mapped.overview;
    if (row.mapped.summary) parsed.summary = row.mapped.summary;
    if (row.mapped.relevance) parsed.relevance = row.mapped.relevance;
    if (row.mapped.jurisdiction) parsed.jurisdiction = row.mapped.jurisdiction;
    if (row.mapped.agency_name) parsed.agency_name = row.mapped.agency_name;
    if (row.mapped.source) parsed.source = row.mapped.source;
    if (row.mapped.link) parsed.link = row.mapped.link;
    if (row.mapped.status) parsed.status = row.mapped.status;
    if (row.mapped.timing) parsed.timing = row.mapped.timing;
    if (row.mapped.change_type) parsed.change_type = row.mapped.change_type;
    if (row.mapped.deadline_description) parsed.deadline_description = row.mapped.deadline_description;
    for (const col of CONTEXT_TEXT_COLUMNS) {
      const v = row.mapped[col];
      if (v && v.trim()) parsed[col] = v.trim();
    }
    if (row.mapped.category_algorithm_defined) {
      parsed.category_algorithm_defined = row.mapped.category_algorithm_defined;
    }

    parsed.needs_human_review = parseHumanReview(row.mapped.needs_human_review);

    for (const col of Object.values(CONFIDENCE_COLUMNS)) {
      const conf = normalizeConfidence(row.mapped[col]);
      if (conf) parsed[col] = conf;
    }

    if (row.mapped.published_on) {
      const result = parseDate(row.mapped.published_on);
      if (result.valid) {
        parsed.published_on = result.date;
      } else {
        warnings.push({
          field: "published_on",
          message: `Ambiguous or invalid date: "${row.mapped.published_on}"`,
          severity: "warning",
        });
        parsed.published_on = row.mapped.published_on;
      }
    }

    if (row.mapped.deadline_date) {
      const result = parseDate(row.mapped.deadline_date);
      if (result.valid) {
        parsed.deadline_date = result.date;
      } else {
        warnings.push({
          field: "deadline_date",
          message: `Ambiguous or invalid date: "${row.mapped.deadline_date}"`,
          severity: "warning",
        });
        parsed.deadline_date = row.mapped.deadline_date;
      }
    }

    for (const col of FACTOR_COLUMNS) {
      const rawVal = row.mapped[col];
      if (rawVal !== null && rawVal !== undefined) {
        const num = parseInteger(rawVal);
        if (num !== null) {
          parsed[col] = num;
          if (!VALID_RATINGS.has(num)) {
            warnings.push({
              field: col,
              message: `Rating value ${num} is not standard (expected 1, 3, 6, or 9)`,
              severity: "warning",
            });
          }
        } else {
          errors.push({
            field: col,
            message: `Invalid rating value: "${rawVal}"`,
            severity: "error",
          });
        }
      }
    }

    if (row.mapped.overall_impact_score !== null && row.mapped.overall_impact_score !== undefined) {
      const num = parseInteger(row.mapped.overall_impact_score);
      if (num !== null) {
        parsed.overall_impact_score = num;
      } else {
        warnings.push({
          field: "overall_impact_score",
          message: `Invalid score: "${row.mapped.overall_impact_score}"`,
          severity: "warning",
        });
      }
    }

    if (row.mapped.topic_match) {
      const topics = row.mapped.topic_match
        .split("|")
        .map((t) => t.trim())
        .filter(Boolean);
      parsed.topic_match = topics;
    }

    if (row.mapped.product) {
      const products = row.mapped.product
        .split(";")
        .map((p) => p.trim())
        .filter(Boolean);
      parsed.product = products;
    }

    parsed.market_access_risk_rationale = cleanRationale(
      row.mapped.market_access_risk_rationale ?? null
    );
    parsed.cost_to_implement_rationale = cleanRationale(
      row.mapped.cost_to_implement_rationale ?? null
    );
    parsed.human_resources_rationale = cleanRationale(
      row.mapped.human_resources_rationale ?? null
    );
    parsed.urgency_rationale = cleanRationale(
      row.mapped.urgency_rationale ?? null
    );

    for (const [, confCol] of Object.entries(CONFIDENCE_COLUMNS)) {
      const rawConf = row.mapped[confCol];
      if (rawConf) {
        const normalized = rawConf.trim().toLowerCase();
        if (VALID_CONFIDENCE.has(normalized)) {
          parsed[confCol] = rawConf.trim();
        } else {
          warnings.push({
            field: confCol,
            message: `Non-standard confidence value: "${rawConf}" (expected High, Medium, or Low)`,
            severity: "warning",
          });
          parsed[confCol] = rawConf.trim();
        }
      }
    }

    for (const err of errors) {
      fieldErrors[err.field] = (fieldErrors[err.field] || 0) + 1;
    }

    validatedRows.push({
      rowNumber: row.rowNumber,
      raw: row.raw,
      mapped: row.mapped,
      presentColumns: row.presentColumns,
      parsed,
      errors,
      warnings,
      isValid: errors.length === 0,
      isDuplicate: false,
    });
  }

  let totalDuplicates = 0;
  for (const [alertId, rowNums] of seenAlertIds) {
    if (rowNums.length > 1) {
      totalDuplicates += rowNums.length - 1;
      for (let i = 0; i < rowNums.length - 1; i++) {
        const vRow = validatedRows.find((r) => r.rowNumber === rowNums[i]);
        if (vRow) {
          vRow.isDuplicate = true;
          vRow.warnings.push({
            field: "alert_id",
            message: `Duplicate alert_id "${alertId}" in batch (rows: ${rowNums.join(", ")}). Last occurrence kept.`,
            severity: "warning",
          });
        }
      }
    }
  }

  return {
    rows: validatedRows,
    totalValid: validatedRows.filter((r) => r.isValid && !r.isDuplicate).length,
    totalInvalid: validatedRows.filter((r) => !r.isValid).length,
    totalDuplicates,
    fieldErrors,
  };
}
