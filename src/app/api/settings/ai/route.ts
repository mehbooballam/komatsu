import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden, canManage, createAuditEvent } from "@/lib/auth-helpers";
import { loadAiSettings } from "@/lib/ai/settings";
import { encryptSecret } from "@/lib/ai/secret";
import { PROVIDER_INFO, type Provider } from "@/lib/ai/provider-info";
import { DEFAULT_GROUPING_PROMPT, GROUPING_OUTPUT_RULES } from "@/lib/grouping/ai-prompt";
import { DEFAULT_REPORT_PROMPT, REPORT_OUTPUT_RULES } from "@/lib/reports-ai-prompt";

/** GET — AI grouping settings (never includes the API key). */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canManage(auth.role)) return forbidden();
  return NextResponse.json({
    settings: await loadAiSettings(auth.company_id),
    default_prompt: DEFAULT_GROUPING_PROMPT,
    output_rules: GROUPING_OUTPUT_RULES,
    default_report_prompt: DEFAULT_REPORT_PROMPT,
    report_output_rules: REPORT_OUTPUT_RULES,
  });
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const AFTER = ["off", "review", "apply"];

/**
 * PUT — save settings. api_key: a new key to store, null to remove it, omitted to keep it.
 * grouping_prompt: null or empty resets to the default prompt.
 */
export async function PUT(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canManage(auth.role)) return forbidden();
  const body = await request.json().catch(() => ({}));
  const before = await loadAiSettings(auth.company_id);

  const provider = (body.provider ?? before.provider) as Provider;
  if (!(provider in PROVIDER_INFO)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  let baseUrl: string | null =
    body.base_url === undefined ? before.base_url : typeof body.base_url === "string" && body.base_url.trim() ? body.base_url.trim() : null;
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      const local = u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
      if (u.protocol !== "https:" && !local) throw new Error("not https");
      baseUrl = u.toString().replace(/\/+$/, "");
    } catch {
      return NextResponse.json({ error: "The base URL must be a valid https:// address" }, { status: 400 });
    }
  }
  if (PROVIDER_INFO[provider].needsBaseUrl && !baseUrl) return NextResponse.json({ error: "Enter the API base URL" }, { status: 400 });

  const model =
    body.model === undefined ? before.model : typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 120) : null;
  const effort = EFFORTS.includes(body.effort) ? body.effort : before.effort;
  const afterImport = AFTER.includes(body.after_import) ? body.after_import : before.after_import;
  const pct = (v: unknown, d: number) => (v !== undefined && Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Math.round(Number(v)))) : d);
  const autoAccept = pct(body.auto_accept_confidence, before.auto_accept_confidence);
  const minConf = pct(body.min_confidence, before.min_confidence);
  if (minConf > autoAccept) {
    return NextResponse.json({ error: "The minimum confidence can't be higher than the auto-accept confidence" }, { status: 400 });
  }
  let prompt: string | null;
  if (body.grouping_prompt === undefined) prompt = before.prompt_is_default ? null : before.grouping_prompt;
  else if (typeof body.grouping_prompt === "string" && body.grouping_prompt.trim() && body.grouping_prompt.trim() !== DEFAULT_GROUPING_PROMPT.trim()) {
    prompt = body.grouping_prompt.slice(0, 40000);
  } else prompt = null;
  let reportPrompt: string | null;
  if (body.report_prompt === undefined) reportPrompt = before.report_prompt_is_default ? null : before.report_prompt;
  else if (typeof body.report_prompt === "string" && body.report_prompt.trim() && body.report_prompt.trim() !== DEFAULT_REPORT_PROMPT.trim()) {
    reportPrompt = body.report_prompt.slice(0, 40000);
  } else reportPrompt = null;
  const enabled = typeof body.enabled === "boolean" ? body.enabled : before.enabled;
  const reportsEnabled = typeof body.reports_enabled === "boolean" ? body.reports_enabled : before.reports_enabled;
  const readPages = typeof body.read_source_pages === "boolean" ? body.read_source_pages : before.read_source_pages;
  const themeFallback = typeof body.theme_fallback === "boolean" ? body.theme_fallback : before.theme_fallback;

  const newKey = typeof body.api_key === "string" && body.api_key.trim() ? body.api_key.trim() : null;
  if (newKey && newKey.length > 500) return NextResponse.json({ error: "That API key is too long" }, { status: 400 });
  const removeKey = body.api_key === null;
  const willHaveKey = newKey ? true : removeKey ? false : before.has_key;
  if (enabled && !willHaveKey) return NextResponse.json({ error: "Add an API key before turning AI grouping on" }, { status: 400 });
  if (enabled && !model) return NextResponse.json({ error: "Choose a model before turning AI grouping on" }, { status: 400 });
  if (reportsEnabled && !before.reports_enabled && !willHaveKey) return NextResponse.json({ error: "Add an API key before turning AI report writing on" }, { status: 400 });
  if (reportsEnabled && !before.reports_enabled && !model) return NextResponse.json({ error: "Choose a model before turning AI report writing on" }, { status: 400 });

  await query(`INSERT INTO ai_settings (company_id) VALUES ($1) ON CONFLICT (company_id) DO NOTHING`, [auth.company_id]);
  const params: unknown[] = [auth.company_id, enabled, provider, model, baseUrl, effort, prompt, readPages, afterImport, autoAccept, minConf, auth.membership_id, themeFallback, reportPrompt, reportsEnabled];
  let keySql = "";
  if (newKey) {
    params.push(encryptSecret(newKey), newKey.slice(-4));
    keySql = `, api_key_encrypted = $${params.length - 1}, api_key_last4 = $${params.length}`;
  } else if (removeKey) {
    keySql = ", api_key_encrypted = NULL, api_key_last4 = NULL";
  }
  await query(
    `UPDATE ai_settings SET enabled = $2, provider = $3, model = $4, base_url = $5, effort = $6, grouping_prompt = $7,
            read_source_pages = $8, after_import = $9, auto_accept_confidence = $10, min_confidence = $11,
            updated_by = $12, theme_fallback = $13, report_prompt = $14, reports_enabled = $15, updated_at = now()${keySql}
     WHERE company_id = $1`,
    params
  );

  const after = await loadAiSettings(auth.company_id);
  const keys = ["enabled", "reports_enabled", "provider", "model", "base_url", "effort", "read_source_pages", "after_import", "auto_accept_confidence", "min_confidence", "theme_fallback"] as const;
  const changed: Record<string, unknown> = Object.fromEntries(keys.filter((k) => before[k] !== after[k]).map((k) => [k, after[k]]));
  if (before.grouping_prompt !== after.grouping_prompt) changed.grouping_prompt = after.prompt_is_default ? "reset to default" : "edited";
  if (before.report_prompt !== after.report_prompt) changed.report_prompt = after.report_prompt_is_default ? "reset to default" : "edited";
  if (newKey) changed.api_key = `replaced (ends …${after.api_key_last4})`;
  if (removeKey && before.has_key) changed.api_key = "removed";
  if (Object.keys(changed).length) {
    await createAuditEvent(auth.company_id, auth.membership_id, "ai_settings_updated", "company", auth.company_id, null, changed);
  }
  return NextResponse.json({ settings: after });
}
