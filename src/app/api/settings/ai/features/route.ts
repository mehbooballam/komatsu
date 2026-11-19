import { NextResponse } from "next/server";
import { getAuth, unauthorized } from "@/lib/auth-helpers";
import { aiFeatures, loadAiSettings } from "@/lib/ai/settings";

/** GET — which AI features are switched on (any signed-in user; no settings details). */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  return NextResponse.json(aiFeatures(await loadAiSettings(auth.company_id)));
}
