import { NextResponse } from "next/server";
import { query } from "@/lib/db";

/**
 * Every change a person makes to an alert needs a comment. The comment is saved
 * as a team note on the alert together with the action taken, so the Notes tab
 * reads as a log of what changed and why.
 *
 * The comment travels in the request body as `comment`, or (for DELETE requests
 * without a body) in the `x-change-comment` header, URI-encoded.
 */
export const COMMENT_HEADER = "x-change-comment";
export const MAX_COMMENT_LENGTH = 2000;

export function readChangeComment(request: Request, body?: unknown): string {
  const fromBody = body && typeof body === "object" && "comment" in body ? (body as { comment?: unknown }).comment : undefined;
  let raw = typeof fromBody === "string" ? fromBody : "";
  if (!raw) {
    const header = request.headers.get(COMMENT_HEADER);
    if (header) {
      try {
        raw = decodeURIComponent(header);
      } catch {
        raw = header;
      }
    }
  }
  return raw.trim().slice(0, MAX_COMMENT_LENGTH);
}

/** 400 response when a change arrives without a comment. */
export function commentRequired() {
  return NextResponse.json({ error: "Add a comment explaining this change.", code: "comment_required" }, { status: 400 });
}

/**
 * Records a change on one or more alerts as a team note.
 * `membershipId` null means the system made the change (e.g. automatic grouping).
 */
export async function addChangeNotes(
  companyId: string,
  alertIds: string[],
  membershipId: string | null,
  action: string,
  comment: string
) {
  if (!alertIds.length) return;
  await query(
    `INSERT INTO alert_notes (company_id, alert_id, author_membership_id, body, visibility, kind, action)
     SELECT $1, x, $2, $3, 'team', 'change', $4 FROM unnest($5::uuid[]) AS x`,
    [companyId, membershipId, comment || "—", action.slice(0, 300), alertIds]
  );
}

/** Alerts filed in a group or any of its sub-groups (they are affected by changes to the group). */
export async function alertsInGroupTree(companyId: string, groupId: string): Promise<string[]> {
  const res = await query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM regulation_groups WHERE id = $1::uuid AND company_id = $2
       UNION ALL
       SELECT rg.id FROM regulation_groups rg JOIN sub ON rg.parent_group_id = sub.id
     )
     SELECT a.id FROM alerts a WHERE a.company_id = $2 AND a.archived_at IS NULL AND a.primary_group_id IN (SELECT id FROM sub)`,
    [groupId, companyId]
  );
  return res.rows.map((r) => r.id);
}
