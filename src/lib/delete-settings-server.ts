import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { DELETE_LABELS, isDeleteAllowed, type DeleteKind } from "./delete-settings";

/** Reads the workspace setting, so a switch turned off takes effect at once. */
export async function deletionAllowed(companyId: string, kind: DeleteKind): Promise<boolean> {
  const res = await query(`SELECT settings FROM companies WHERE id = $1`, [companyId]);
  return isDeleteAllowed(res.rows[0]?.settings, kind);
}

/** 403 when deleting this type is switched off. */
export async function refuseIfDeleteOff(companyId: string, kind: DeleteKind): Promise<NextResponse | null> {
  if (await deletionAllowed(companyId, kind)) return null;
  return NextResponse.json({ error: DELETE_LABELS[kind].off, code: "delete_disabled" }, { status: 403 });
}
