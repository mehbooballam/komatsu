import { NextResponse } from "next/server";
import { getAuth, unauthorized, forbidden, canEdit } from "@/lib/auth-helpers";
import { hasCompanyWideAccess } from "@/lib/auth/permissions";
import { runGrouping } from "@/lib/grouping/engine";

/** POST — run automatic regulatory-family grouping over every alert in the workspace. */
export async function POST() {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!hasCompanyWideAccess(auth.role, auth.access_scope) || !canEdit(auth.role)) return forbidden();
  const result = await runGrouping(auth.company_id);
  return NextResponse.json({ result });
}
