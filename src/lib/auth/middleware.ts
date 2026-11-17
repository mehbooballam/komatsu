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

  let membershipQuery: string;
  let membershipParams: string[];

  if (companyId) {
    membershipQuery = `SELECT id, company_id, user_id, role, access_scope, state
      FROM memberships WHERE user_id = $1 AND company_id = $2 AND state = 'active'`;
    membershipParams = [session.userId, companyId];
  } else {
    membershipQuery = `SELECT id, company_id, user_id, role, access_scope, state
      FROM memberships WHERE user_id = $1 AND state = 'active' ORDER BY joined_at ASC LIMIT 1`;
    membershipParams = [session.userId];
  }

  const membershipResult = await query(membershipQuery, membershipParams);
  if (membershipResult.rows.length === 0) return null;
  const membership = membershipResult.rows[0] as AuthMembership;

  const companyResult = await query(
    `SELECT id, name, slug, time_zone, active_policy_id, settings FROM companies WHERE id = $1`,
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
