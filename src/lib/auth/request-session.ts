import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { hashToken } from "./session";

export interface RequestSession {
  user: { id: string; email: string; display_name: string };
  membership: { id: string; company_id: string; role: string; access_scope: string };
  company: { id: string; name: string; slug: string; time_zone: string; active_policy_id: string | null };
}

export async function getSessionFromRequest(): Promise<RequestSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("komatsu_session")?.value;
  if (!token) return null;

  const res = await query(
    `SELECT s.user_id, u.id AS uid, u.email, u.display_name,
            m.id AS mid, m.company_id, m.role, m.access_scope,
            c.id AS cid, c.name AS cname, c.slug, c.time_zone, c.active_policy_id
     FROM sessions s
     JOIN user_profiles u ON u.id = s.user_id
     JOIN memberships m ON m.user_id = s.user_id AND m.state = 'active'
     JOIN companies c ON c.id = m.company_id AND c.archived_at IS NULL
     WHERE s.token = $1 AND s.expires_at > NOW()
     ORDER BY (m.company_id::text = $2) DESC, m.joined_at ASC LIMIT 1`,
    [hashToken(token), cookieStore.get("komatsu_company")?.value ?? ""]
  );

  if (res.rows.length === 0 || !res.rows[0].mid) return null;
  const r = res.rows[0];
  return {
    user: { id: r.uid, email: r.email, display_name: r.display_name },
    membership: { id: r.mid, company_id: r.company_id, role: r.role, access_scope: r.access_scope },
    company: { id: r.cid, name: r.cname, slug: r.slug, time_zone: r.time_zone, active_policy_id: r.active_policy_id },
  };
}
