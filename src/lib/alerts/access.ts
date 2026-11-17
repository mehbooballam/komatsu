import { NextResponse } from "next/server";
import type { AuthContext } from "@/lib/auth-helpers";
import { canViewAlerts, hasCompanyWideAccess } from "@/lib/auth/permissions";
import { query } from "@/lib/db";

export const ALERT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AlertAccess = Pick<AuthContext, "role" | "access_scope" | "membership_id" | "company_id">;

/** Additional access predicate for queries whose alerts table is aliased as a. */
export function alertScopeSql(auth: AlertAccess, params: unknown[], assignedToMe = false): string {
  if (!canViewAlerts(auth.role)) return "FALSE";
  if (!assignedToMe && hasCompanyWideAccess(auth.role, auth.access_scope)) return "TRUE";

  const member = `$${params.push(auth.membership_id)}`;
  const owner = `COALESCE(a.direct_owner_membership_id, (
    SELECT rg.owner_membership_id FROM regulation_groups rg
    WHERE rg.id = a.primary_group_id AND rg.company_id = a.company_id
  ))`;
  const isOwner = `${owner} = ${member}`;
  if (assignedToMe || auth.role === "risk_owner") return isOwner;
  if (auth.access_scope !== "assigned" && auth.access_scope !== "team") return "FALSE";

  const teamGrant = auth.access_scope === "team" ? `OR EXISTS (
    SELECT 1 FROM team_memberships tm
    JOIN teams t ON t.id = tm.team_id AND t.company_id = tm.company_id AND t.archived_at IS NULL
    WHERE tm.team_id = s.team_id AND tm.company_id = s.company_id AND tm.membership_id = ${member}
  )` : "";
  return `(${isOwner} OR EXISTS (
    SELECT 1 FROM alert_scopes s
    WHERE s.company_id = a.company_id AND s.alert_id = a.id AND s.revoked_at IS NULL
      AND (s.membership_id = ${member} ${teamGrant})
  ))`;
}

export async function accessibleAlertIds(auth: AlertAccess, ids: string[]): Promise<string[]> {
  if (!ids.length || !ids.every((id) => ALERT_UUID.test(id))) return [];
  const params: unknown[] = [auth.company_id, ids];
  const scope = alertScopeSql(auth, params);
  const result = await query(
    `SELECT a.id FROM alerts a
     WHERE a.company_id = $1 AND a.id = ANY($2::uuid[]) AND a.archived_at IS NULL AND ${scope}`,
    params
  );
  return result.rows.map((row) => row.id);
}

export async function canAccessAlert(auth: AlertAccess, id: string): Promise<boolean> {
  return (await accessibleAlertIds(auth, [id])).length === 1;
}

export function alertNotFound() {
  return NextResponse.json({ error: "Alert not found" }, { status: 404 });
}
