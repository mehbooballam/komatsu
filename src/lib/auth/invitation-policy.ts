import type { AuthMembership } from "./middleware";

const ROLES = ["company_admin", "manager", "reviewer", "risk_owner"] as const;

export function isInvitationRole(role: unknown): role is AuthMembership["role"] {
  return ROLES.some((knownRole) => knownRole === role);
}

export function canGrantInvitationRole(
  inviterRole: AuthMembership["role"],
  role: AuthMembership["role"]
) {
  return inviterRole === "company_admin" ||
    (inviterRole === "manager" && (role === "reviewer" || role === "risk_owner"));
}
