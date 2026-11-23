import type { AuthMembership } from "./middleware";

type Role = AuthMembership["role"];

/**
 * Deleting alerts (one, selected, or all) is switched off: the buttons are hidden and the
 * server refuses. Set to true to bring it back.
 */
export const ALERT_DELETE_ENABLED = false;

/** Roles that may change alerts, groups and products. Reviewers and risk owners are read-only. */
const EDITING_ROLES: Role[] = ["company_admin", "manager"];
const IMPORT_ROLES: Role[] = ["company_admin", "manager"];
const ADMIN_ROLES: Role[] = ["company_admin"];

export function canManageCompany(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

export function canManageTeams(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

export function canImport(role: Role): boolean {
  return IMPORT_ROLES.includes(role);
}

export function canEditAlerts(role: Role): boolean {
  return EDITING_ROLES.includes(role);
}

/** Same rule for code that only has the role as a string (e.g. in the browser). */
export function canMakeChanges(role: string | null | undefined): boolean {
  return role === "company_admin" || role === "manager";
}

export function canEditRatings(role: Role): boolean {
  return EDITING_ROLES.includes(role);
}

export function canEditDeadlines(role: Role): boolean {
  return EDITING_ROLES.includes(role);
}

export function canManageGroups(role: Role): boolean {
  return IMPORT_ROLES.includes(role);
}

export function canAssign(role: string): boolean {
  return role === "company_admin" || role === "manager";
}

export function canViewAlerts(role: string): boolean {
  return role === "risk_owner" || role === "reviewer" || canViewAudit(role);
}

export function canViewAudit(role: string): boolean {
  return role === "company_admin" || role === "manager";
}

export function canManageInventory(role: Role): boolean {
  return EDITING_ROLES.includes(role);
}

export function canInviteUsers(role: Role): boolean {
  return IMPORT_ROLES.includes(role);
}

export function canManageScoringPolicy(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

export function canRequestSourceReview(role: Role): boolean {
  return EDITING_ROLES.includes(role);
}

export function canViewDashboard(role: string, scope: string): boolean {
  return hasCompanyWideAccess(role, scope);
}

export function isRiskOwnerOnly(role: Role): boolean {
  return role === "risk_owner";
}

export function hasCompanyWideAccess(role: string, scope: string): boolean {
  return canViewAudit(role) || (role === "reviewer" && scope === "company");
}

export function workspaceHome(role: string, scope: string): string {
  if (role === "risk_owner") return "/my-risks";
  return canViewDashboard(role, scope) ? "/dashboard" : "/alerts";
}
