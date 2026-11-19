import { query } from "@/lib/db";
import { decryptSecret } from "./secret";
import { DEFAULT_GROUPING_PROMPT } from "@/lib/grouping/ai-prompt";
import { DEFAULT_REPORT_PROMPT } from "@/lib/reports-ai-prompt";
import type { Provider } from "./providers";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type AfterImport = "off" | "review" | "apply";

export interface AiSettings {
  enabled: boolean;
  provider: Provider;
  model: string | null;
  base_url: string | null;
  has_key: boolean;
  api_key_last4: string | null;
  effort: Effort;
  grouping_prompt: string;
  prompt_is_default: boolean;
  /** Instructions for writing the monthly report with AI */
  report_prompt: string;
  report_prompt_is_default: boolean;
  read_source_pages: boolean;
  after_import: AfterImport;
  auto_accept_confidence: number;
  min_confidence: number;
  /** Put alerts AI could not group into their theme group */
  theme_fallback: boolean;
  updated_at: string | null;
  updated_by_name: string | null;
}

/** Settings as shown in the app (no API key). */
export async function loadAiSettings(companyId: string): Promise<AiSettings> {
  const res = await query(
    `SELECT s.*, up.display_name AS updated_by_name
     FROM ai_settings s
     LEFT JOIN memberships m ON m.id = s.updated_by
     LEFT JOIN user_profiles up ON up.id = m.user_id
     WHERE s.company_id = $1`,
    [companyId]
  );
  const r = res.rows[0];
  return {
    enabled: !!r?.enabled,
    provider: (r?.provider as Provider) ?? "anthropic",
    model: r?.model ?? null,
    base_url: r?.base_url ?? null,
    has_key: !!r?.api_key_encrypted,
    api_key_last4: r?.api_key_last4 ?? null,
    effort: (r?.effort as Effort) ?? "high",
    grouping_prompt: r?.grouping_prompt?.trim() ? r.grouping_prompt : DEFAULT_GROUPING_PROMPT,
    prompt_is_default: !r?.grouping_prompt?.trim(),
    report_prompt: r?.report_prompt?.trim() ? r.report_prompt : DEFAULT_REPORT_PROMPT,
    report_prompt_is_default: !r?.report_prompt?.trim(),
    read_source_pages: r ? !!r.read_source_pages : true,
    after_import: (r?.after_import as AfterImport) ?? "off",
    auto_accept_confidence: r?.auto_accept_confidence ?? 90,
    min_confidence: r?.min_confidence ?? 60,
    theme_fallback: r ? r.theme_fallback !== false : true,
    updated_at: r?.updated_at ?? null,
    updated_by_name: r?.updated_by_name ?? null,
  };
}

/** The stored API key, decrypted (server only). */
export async function loadApiKey(companyId: string): Promise<string | null> {
  const res = await query(`SELECT api_key_encrypted FROM ai_settings WHERE company_id = $1`, [companyId]);
  const stored = res.rows[0]?.api_key_encrypted;
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch {
    return null;
  }
}
