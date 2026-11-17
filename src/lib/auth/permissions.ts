import type { AuthMembership } from "./middleware";

type Role = AuthMembership["role"];

const EDITING_ROLES: Role[] = ["company_admin", "manager", "reviewer"];
const IMPORT_ROLES: Role[] = ["company_admin", "manager"];
const ADMIN_ROLES: Role[] = ["company_admin"];
const ASSIGN_ROLES: Role[] = ["company_admin", "manager", "reviewer"];

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

export function canEditRatings(role: Role): boolean {
  return EDITING_ROLES.includes(role);
}

export function canEditDeadlines(role: Role): boolean {
  return EDITING_ROLES.includes(role);
}

export function canManageGroups(role: Role): boolean {
  return IMPORT_ROLES.includes(role);
}

export function canAssign(role: Role): boolean {
  return ASSIGN_ROLES.includes(role);
}

export function canViewAlerts(role: Role): boolean {
  return true;
}

export function canViewAudit(role: Role): boolean {
  return role !== "risk_owner";
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

export function canViewDashboard(role: Role): boolean {
  return true;
}

export function isRiskOwnerOnly(role: Role): boolean {
  return role === "risk_owner";
}

export function hasCompanyWideAccess(
  role: Role,
  scope: AuthMembership["access_scope"]
): boolean {
  if (role === "company_admin" || role === "manager") return true;
  return scope === "company";
}
