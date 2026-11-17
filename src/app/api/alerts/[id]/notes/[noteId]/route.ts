import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized, forbidden } from "@/lib/auth-helpers";
import { MAX_NOTE_LENGTH, NOTE_SELECT } from "@/lib/notes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findNote(companyId: string, alertId: string, noteId: string) {
  if (!UUID_RE.test(alertId) || !UUID_RE.test(noteId)) return null;
  const res = await query(
    `SELECT id, author_membership_id, visibility FROM alert_notes WHERE id = $1 AND alert_id = $2 AND company_id = $3`,
    [noteId, alertId, companyId]
  );
  return res.rows[0] || null;
}

/** PATCH { body?, visibility? } — only the author can edit a note. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  const { id, noteId } = await params;
  const note = await findNote(auth.company_id, id, noteId);
  // Someone else's private note is reported as missing, not forbidden
  if (!note || (note.visibility === "private" && note.author_membership_id !== auth.membership_id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (note.author_membership_id !== auth.membership_id) return forbidden();

  const payload = await request.json().catch(() => ({}));
  const body = typeof payload.body === "string" ? payload.body.trim() : undefined;
  const visibility = payload.visibility === "team" || payload.visibility === "private" ? payload.visibility : undefined;
  if (body !== undefined && !body) return NextResponse.json({ error: "A note can't be empty" }, { status: 400 });
  if (body && body.length > MAX_NOTE_LENGTH) {
    return NextResponse.json({ error: `Notes can be at most ${MAX_NOTE_LENGTH} characters` }, { status: 400 });
  }

  await query(
    `UPDATE alert_notes SET body = COALESCE($1, body), visibility = COALESCE($2, visibility),
       updated_at = CASE WHEN $1::text IS NOT NULL AND $1::text <> body THEN now() ELSE updated_at END
     WHERE id = $3`,
    [body ?? null, visibility ?? null, noteId]
  );
  const res = await query(`${NOTE_SELECT} WHERE n.id = $1`, [noteId]);
  return NextResponse.json({ note: { ...res.rows[0], mine: true } });
}

/** DELETE — the author can delete their note; admins can also remove team notes. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  const { id, noteId } = await params;
  const note = await findNote(auth.company_id, id, noteId);
  if (!note || (note.visibility === "private" && note.author_membership_id !== auth.membership_id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (note.author_membership_id !== auth.membership_id && auth.role !== "company_admin") return forbidden();

  await query(`DELETE FROM alert_notes WHERE id = $1`, [noteId]);
  return NextResponse.json({ success: true });
}
