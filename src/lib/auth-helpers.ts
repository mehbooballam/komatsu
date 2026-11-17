import { query } from "@/lib/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "crypto";

export interface AuthContext {
  user_id: string;
  membership_id: string;
  company_id: string;
  role: string;
  access_scope: string;
  time_zone: string;
  display_name: string;
  email: string;
}

export async function getAuth(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("komatsu_session")?.value;
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const res = await query(
    `SELECT s.user_id, m.id as membership_id, m.company_id, m.role, m.access_scope,
            c.time_zone, up.display_name, up.email
     FROM sessions s
     JOIN memberships m ON m.user_id = s.user_id AND m.state = 'active'
     JOIN companies c ON c.id = m.company_id
     JOIN user_profiles up ON up.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()
     ORDER BY s.last_active_at DESC LIMIT 1`,
    [tokenHash]
  );
  if (res.rows.length === 0) return null;
  await query(`UPDATE sessions SET last_active_at = now() WHERE token = $1`, [tokenHash]);
  return res.rows[0] as AuthContext;
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function canManage(role: string): boolean {
  return role === "company_admin";
}

export function canImport(role: string): boolean {
  return role === "company_admin" || role === "manager";
}

export function canEdit(role: string): boolean {
  return role !== "risk_owner";
}

export function canAssign(role: string): boolean {
  return role === "company_admin" || role === "manager";
}

export async function createAuditEvent(
  companyId: string,
  actorMembershipId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  beforeValues: unknown = null,
  afterValues: unknown = null,
  reason?: string
) {
  await query(
    `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, before_values, after_values, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [companyId, actorMembershipId, action, entityType, entityId,
     beforeValues ? JSON.stringify(beforeValues) : null,
     afterValues ? JSON.stringify(afterValues) : null,
     reason || null]
  );
}
