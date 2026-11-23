import Anthropic from "@anthropic-ai/sdk";
import { PROVIDER_INFO, type Provider } from "./provider-info";
import type { Effort } from "./settings";

export type { Provider } from "./provider-info";

export interface ProviderConfig {
  provider: Provider;
  apiKey: string;
  model: string;
  baseUrl: string | null;
  effort: Effort;
}

export interface JsonCompletion {
  json: unknown;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export class ProviderError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

function baseUrlFor(cfg: Pick<ProviderConfig, "provider" | "baseUrl">): string {
  const url = (cfg.baseUrl || PROVIDER_INFO[cfg.provider].baseUrl || "").replace(/\/+$/, "");
  if (cfg.provider !== "anthropic" && !url) throw new ProviderError("Enter the API base URL for this provider");
  return url;
}

/* ---------- Anthropic (Claude) ---------- */

function claudeClient(cfg: Pick<ProviderConfig, "apiKey" | "baseUrl">) {
  return new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl || undefined, maxRetries: 3, timeout: 20 * 60 * 1000 });
}

// Models that take output_config.effort, and those that support server-side refusal fallbacks
const CLAUDE_EFFORT = /^claude-(fable|mythos|opus-5|sonnet-5|haiku-5|opus-4-[5-8]|sonnet-4-6)/;
const CLAUDE_FALLBACK = /^claude-(fable-5-[12]|opus-5-5|opus-5|sonnet-5-5)$/;

function claudeError(err: unknown): ProviderError {
  if (err instanceof Anthropic.AuthenticationError) return new ProviderError("The API key was rejected by Anthropic", 401);
  if (err instanceof Anthropic.PermissionDeniedError) return new ProviderError("This API key may not use that model", 403);
  if (err instanceof Anthropic.NotFoundError) return new ProviderError("Model not found — check the model name", 404);
  if (err instanceof Anthropic.RateLimitError) return new ProviderError("Rate limited by Anthropic — try again in a minute", 429);
  if (err instanceof Anthropic.BadRequestError) return new ProviderError(`Request rejected: ${err.message}`, 400);
  if (err instanceof Anthropic.APIError) return new ProviderError(`Anthropic API error ${err.status ?? ""}: ${err.message}`, err.status);
  return new ProviderError(err instanceof Error ? err.message : "Could not reach Anthropic");
}

async function claudeJson(cfg: ProviderConfig, system: string, user: string, schema: Record<string, unknown>, maxTokens: number, structured = true): Promise<JsonCompletion> {
  const client = claudeClient(cfg);
  const output_config: Anthropic.OutputConfig = {};
  if (structured) output_config.format = { type: "json_schema", schema };
  if (CLAUDE_EFFORT.test(cfg.model)) output_config.effort = cfg.effort;
  const base = {
    model: cfg.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user" as const, content: user }],
    ...(Object.keys(output_config).length ? { output_config } : {}),
  };
  let message: Anthropic.Message | Anthropic.Beta.BetaMessage;
  try {
    // Streaming: long outputs would otherwise hit HTTP timeouts
    message = CLAUDE_FALLBACK.test(cfg.model)
      ? await client.beta.messages.stream({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }).finalMessage()
      : await client.messages.stream(base).finalMessage();
  } catch (err) {
    // Older models without structured outputs: ask again with the schema only in the prompt
    if (structured && err instanceof Anthropic.BadRequestError && /output_config|json_schema|format|effort/i.test(err.message)) {
      return claudeJson(cfg, system, user, schema, maxTokens, false);
    }
    throw claudeError(err);
  }
  if (message.stop_reason === "refusal") throw new ProviderError("The model declined this request");
  if (message.stop_reason === "max_tokens") throw new ProviderError("The answer was cut off (too long) — the batch will be split");
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return {
    json: parseJsonText(text),
    model: message.model,
    usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
  };
}

/* ---------- OpenAI and OpenAI-compatible (Gemini, others) ---------- */

async function openAiFetch(cfg: Pick<ProviderConfig, "provider" | "apiKey" | "baseUrl">, path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrlFor(cfg)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", ...(init?.headers || {}) },
    signal: AbortSignal.timeout(20 * 60 * 1000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg = body.slice(0, 400);
    try {
      const j = JSON.parse(body);
      msg = j.error?.message || j.message || msg;
    } catch {}
    if (res.status === 401 || res.status === 403) throw new ProviderError("The API key was rejected", res.status);
    if (res.status === 404) throw new ProviderError(`Not found — check the base URL and model (${msg})`, 404);
    if (res.status === 429) throw new ProviderError("Rate limited — try again in a minute", 429);
    throw new ProviderError(`API error ${res.status}: ${msg}`, res.status);
  }
  return res.json();
}

async function openAiJson(cfg: ProviderConfig, system: string, user: string, schema: Record<string, unknown>, maxTokens: number): Promise<JsonCompletion> {
  const call = (response_format: Record<string, unknown>) =>
    openAiFetch(cfg, "/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format,
        max_completion_tokens: maxTokens,
      }),
    });
  let data;
  try {
    data = await call({ type: "json_schema", json_schema: { name: "grouping_result", strict: true, schema } });
  } catch (err) {
    // Some compatible APIs only support plain JSON mode; the schema is also in the prompt
    if (err instanceof ProviderError && err.status === 400) data = await call({ type: "json_object" });
    else throw err;
  }
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") throw new ProviderError("The answer was cut off (too long) — the batch will be split");
  if (choice?.message?.refusal) throw new ProviderError(`The model declined: ${choice.message.refusal}`);
  return {
    json: parseJsonText(choice?.message?.content ?? ""),
    model: data.model || cfg.model,
    usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 },
  };
}

/* ---------- Public API ---------- */

function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new ProviderError("The model did not return valid JSON");
  }
}

/** One request that must return JSON matching `schema`. */
export async function completeJson(
  cfg: ProviderConfig,
  req: { system: string; user: string; schema: Record<string, unknown>; maxTokens?: number }
): Promise<JsonCompletion> {
  const maxTokens = req.maxTokens ?? 32000;
  return cfg.provider === "anthropic"
    ? claudeJson(cfg, req.system, req.user, req.schema, maxTokens)
    : openAiJson(cfg, req.system, req.user, req.schema, maxTokens);
}

/** Models this key can use (for the model picker). */
export async function listModels(cfg: Pick<ProviderConfig, "provider" | "apiKey" | "baseUrl">): Promise<Array<{ id: string; label: string }>> {
  if (cfg.provider === "anthropic") {
    try {
      const out: Array<{ id: string; label: string }> = [];
      for await (const m of claudeClient(cfg).models.list()) out.push({ id: m.id, label: m.display_name || m.id });
      return out;
    } catch (err) {
      throw claudeError(err);
    }
  }
  const data = await openAiFetch(cfg, "/models");
  const list: Array<{ id: string }> = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  return list
    .map((m) => ({ id: String(m.id).replace(/^models\//, ""), label: String(m.id).replace(/^models\//, "") }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Small round trip to check the key and model work. */
export async function testConnection(cfg: ProviderConfig): Promise<{ ok: true; model: string; latency_ms: number }> {
  const started = Date.now();
  const schema = {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  };
  const r = await completeJson(
    { ...cfg, effort: "low" },
    { system: "Reply with JSON only.", user: 'Return {"ok": true}.', schema, maxTokens: 2000 }
  );
  if (!r.json || typeof r.json !== "object") throw new ProviderError("Unexpected reply from the model");
  return { ok: true, model: r.model, latency_ms: Date.now() - started };
}
