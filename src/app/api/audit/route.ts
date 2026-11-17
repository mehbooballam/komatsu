import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, unauthorized } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return unauthorized();

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const offset = (page - 1) * limit;
  const action = searchParams.get("action");
  const entityType = searchParams.get("entity_type");
  const actorId = searchParams.get("actor_id");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const conditions: string[] = ["ae.company_id = $1"];
  const params: unknown[] = [auth.company_id];
  let idx = 2;

  if (action) { conditions.push(`ae.action = $${idx++}`); params.push(action); }
  if (entityType) { conditions.push(`ae.entity_type = $${idx++}`); params.push(entityType); }
  if (actorId) { conditions.push(`ae.actor_membership_id = $${idx++}`); params.push(actorId); }
  if (from) { conditions.push(`ae.occurred_at >= $${idx++}`); params.push(from); }
  if (to) { conditions.push(`ae.occurred_at <= $${idx++}`); params.push(to); }

  const where = conditions.join(" AND ");

  const countRes = await query(`SELECT COUNT(*) FROM audit_events ae WHERE ${where}`, params);
  const total = parseInt(countRes.rows[0].count);

  const events = await query(
    `SELECT ae.*, up.display_name as actor_name
     FROM audit_events ae
     LEFT JOIN memberships m ON m.id = ae.actor_membership_id
     LEFT JOIN user_profiles up ON up.id = m.user_id
     WHERE ${where}
     ORDER BY ae.occurred_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  return NextResponse.json({
    events: events.rows,
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
  });
}
