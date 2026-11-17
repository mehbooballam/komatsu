import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { validateSession } from "@/lib/auth/session";
import { validateImageDataUrl } from "@/lib/images";

/** PUT /api/users/me/avatar { image: dataUrl | null } — set or remove your profile photo. */
export async function PUT(request: Request) {
  const session = await validateSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { image } = (await request.json().catch(() => ({}))) as { image?: string | null };

  if (image === null) {
    await query(`UPDATE user_profiles SET preferences = preferences - 'avatar' WHERE id = $1`, [session.userId]);
    return NextResponse.json({ avatar: null });
  }

  const err = validateImageDataUrl(image);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  await query(
    `UPDATE user_profiles SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{avatar}', to_jsonb($1::text)) WHERE id = $2`,
    [image, session.userId]
  );
  return NextResponse.json({ avatar: image });
}
