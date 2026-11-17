import { query } from "@/lib/db";
import { validateSession } from "./session";
import { cookies } from "next/headers";

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  verified_email: boolean;
  preferences: Record<string, unknown>;
}

export interface AuthMembership {
  id: string;
  company_id: string;
  user_id: string;
  role: "company_admin" | "manager" | "reviewer" | "risk_owner";
  access_scope: "company" | "team" | "assigned";
  state: "active" | "suspended" | "revoked";
}

export interface AuthCompany {
  id: string;
  name: string;
  slug: string;
  time_zone: string;
  active_policy_id: string | null;
  settings: Record<string, unknown>;
}

export interface ServerSession {
  user: AuthUser;
  membership: AuthMembership;
  company: AuthCompany;
}

export async function getServerSession(): Promise<ServerSession | null> {
  const session = await validateSession();
  if (!session) return null;

  const cookieStore = await cookies();
  const companyId = cookieStore.get("komatsu_company")?.value;

  const userResult = await query(
    `SELECT id, email, display_name, verified_email, preferences FROM user_profiles WHERE id = $1`,
    [session.userId]
  );
  if (userResult.rows.length === 0) return null;
  const user = userResult.rows[0] as AuthUser;

  // Prefer the selected workspace (komatsu_company cookie); fall back to the
  // user's first workspace if the cookie is missing or no longer valid.
  const membershipResult = await query(
    `SELECT m.id, m.company_id, m.user_id, m.role, m.access_scope, m.state
     FROM memberships m JOIN companies c ON c.id = m.company_id AND c.archived_at IS NULL
     WHERE m.user_id = $1 AND m.state = 'active'
     ORDER BY (m.company_id::text = $2) DESC, m.joined_at ASC LIMIT 1`,
    [session.userId, companyId ?? ""]
  );
  if (membershipResult.rows.length === 0) return null;
  const membership = membershipResult.rows[0] as AuthMembership;

  const companyResult = await query(
    `SELECT id, name, slug, time_zone, active_policy_id, settings FROM companies WHERE id = $1 AND archived_at IS NULL`,
    [membership.company_id]
  );
  if (companyResult.rows.length === 0) return null;
  const company = companyResult.rows[0] as AuthCompany;

  return { user, membership, company };
}

export async function requireSession(): Promise<ServerSession> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

export async function requireRole(
  ...roles: AuthMembership["role"][]
): Promise<ServerSession> {
  const session = await requireSession();
  if (!roles.includes(session.membership.role)) {
    throw new Error("FORBIDDEN");
  }
  return session;
}
