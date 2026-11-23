import { NextRequest, NextResponse } from "next/server";
import { getAuth, unauthorized, forbidden, canManage } from "@/lib/auth-helpers";
import { loadAiSettings, loadApiKey } from "@/lib/ai/settings";
import { listModels, ProviderError } from "@/lib/ai/providers";
import { PROVIDER_INFO, type Provider } from "@/lib/ai/provider-info";

/** POST { provider, base_url?, api_key? } — models this key can use (the saved key when none is given). */
export async function POST(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canManage(auth.role)) return forbidden();
  const body = await request.json().catch(() => ({}));
  const saved = await loadAiSettings(auth.company_id);
  const provider = (body.provider ?? saved.provider) as Provider;
  if (!(provider in PROVIDER_INFO)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  // A saved key only applies to the provider it was saved for
  const typed = typeof body.api_key === "string" && body.api_key.trim() ? body.api_key.trim() : null;
  const apiKey = typed ?? (provider === saved.provider ? await loadApiKey(auth.company_id) : null);
  if (!apiKey) return NextResponse.json({ error: "Enter an API key first" }, { status: 400 });
  const baseUrl = typeof body.base_url === "string" && body.base_url.trim() ? body.base_url.trim() : provider === saved.provider ? saved.base_url : null;
  try {
    return NextResponse.json({ models: await listModels({ provider, apiKey, baseUrl }) });
  } catch (err) {
    const e = err instanceof ProviderError ? err : new ProviderError("Could not load the models");
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
