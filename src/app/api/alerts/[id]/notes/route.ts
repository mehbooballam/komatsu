import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized } from "@/lib/auth-helpers";

import { MAX_NOTE_LENGTH, NOTE_SELECT } from "@/lib/notes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function alertExists(companyId: string, id: string) {
  if (!UUID_RE.test(id)) return false;
  const res = await query(`SELECT 1 FROM alerts WHERE id = $1 AND company_id = $2`, [id, companyId]);
  return res.rows.length > 0;
}

/** Notes on an alert: everyone's team notes plus the caller's own private notes, newest first. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  const { id } = await params;
  if (!(await alertExists(auth.company_id, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const res = await query(
    `${NOTE_SELECT}
     WHERE n.alert_id = $1 AND n.company_id = $2
       AND (n.visibility = 'team' OR n.author_membership_id = $3)
     ORDER BY n.created_at DESC`,
    [id, auth.company_id, auth.membership_id]
  );
  return NextResponse.json({
    notes: res.rows.map((n) => ({ ...n, mine: n.author_membership_id === auth.membership_id })),
  });
}

/** POST { body, visibility: "private" | "team" } */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  const { id } = await params;
  if (!(await alertExists(auth.company_id, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = await request.json().catch(() => ({}));
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  const visibility = payload.visibility === "team" ? "team" : "private";
  if (!body) return NextResponse.json({ error: "Write something first" }, { status: 400 });
  if (body.length > MAX_NOTE_LENGTH) {
    return NextResponse.json({ error: `Notes can be at most ${MAX_NOTE_LENGTH} characters` }, { status: 400 });
  }

  const ins = await query(
    `INSERT INTO alert_notes (company_id, alert_id, author_membership_id, body, visibility)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [auth.company_id, id, auth.membership_id, body, visibility]
  );
  const res = await query(`${NOTE_SELECT} WHERE n.id = $1`, [ins.rows[0].id]);
  return NextResponse.json({ note: { ...res.rows[0], mine: true } }, { status: 201 });
}
