import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, createAuditEvent } from "@/lib/auth-helpers";
import { validateImageDataUrl } from "@/lib/images";

/** Branding images stored in companies.settings */
const KINDS = {
  logo: "Logo (light background)",
  logo_dark: "Logo (dark background)",
  icon: "Icon (square)",
} as const;
type Kind = keyof typeof KINDS;

/**
 * PUT /api/workspaces/current/logo { kind?: "logo" | "logo_dark" | "icon", image: dataUrl | null }
 * Set or remove a workspace branding image (admins only). kind defaults to "logo".
 */
export async function PUT(request: Request) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role !== "company_admin") {
    return NextResponse.json({ error: "Only administrators can change workspace branding" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { kind?: string; image?: string | null };
  const kind = (body.kind ?? "logo") as Kind;
  if (!(kind in KINDS)) return NextResponse.json({ error: "Unknown image type" }, { status: 400 });

  if (body.image === null) {
    await query(`UPDATE companies SET settings = settings - $1::text WHERE id = $2`, [kind, auth.company_id]);
  } else {
    const err = validateImageDataUrl(body.image);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    await query(
      `UPDATE companies SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), ARRAY[$1::text], to_jsonb($2::text)) WHERE id = $3`,
      [kind, body.image, auth.company_id]
    );
  }

  await createAuditEvent(auth.company_id, auth.membership_id, body.image === null ? "workspace_branding_removed" : "workspace_branding_updated", "company", auth.company_id, null, { image: KINDS[kind] });
  return NextResponse.json({ kind, image: body.image ?? null });
}
