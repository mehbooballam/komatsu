import { cookies } from "next/headers";
import crypto from "crypto";
import { query } from "@/lib/db";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface SessionContext {
  user: { id: string; email: string; display_name: string };
  membership: { id: string; company_id: string; role: string; access_scope: string };
  company: { id: string; name: string; slug: string; time_zone: string };
}

export async function getSessionFromRequest(): Promise<SessionContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("komatsu_session")?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);

  const result = await query(
    `SELECT s.user_id, s.expires_at,
            u.id as u_id, u.email, u.display_name,
            m.id as m_id, m.company_id, m.role, m.access_scope,
            c.id as c_id, c.name as c_name, c.slug, c.time_zone
     FROM sessions s
     JOIN user_profiles u ON u.id = s.user_id
     JOIN memberships m ON m.user_id = s.user_id AND m.state = 'active'
     JOIN companies c ON c.id = m.company_id
     WHERE s.token = $1 AND s.expires_at > now()
     ORDER BY (m.company_id::text = $2) DESC, m.joined_at ASC LIMIT 1`,
    [tokenHash, cookieStore.get("komatsu_company")?.value ?? ""]
  );

  if (result.rows.length === 0) return null;

  const r = result.rows[0];

  await query(`UPDATE sessions SET last_active_at = now() WHERE token = $1`, [tokenHash]);

  return {
    user: { id: r.u_id, email: r.email, display_name: r.display_name },
    membership: { id: r.m_id, company_id: r.company_id, role: r.role, access_scope: r.access_scope },
    company: { id: r.c_id, name: r.c_name, slug: r.slug, time_zone: r.time_zone },
  };
}

export function requireRole(session: SessionContext, ...roles: string[]): boolean {
  return roles.includes(session.membership.role);
}
