import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { parseEmailAddress } from "@/lib/auth/email-address";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { setSessionCookies, storeSession } from "@/lib/auth/session";
import { DEFAULT_POLICY } from "@/lib/scoring/policy";
import { isValidWorkspaceTimeZone } from "@/lib/workspace-date";
import { slugify } from "@/lib/workspaces";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = parseEmailAddress(body?.email);
  const password = body?.password;
  const rawDisplayName = body?.displayName ?? body?.display_name;
  const rawCompanyName = body?.companyName ?? body?.company_name;
  const timeZone = body?.timeZone ?? body?.time_zone ?? "UTC";
  const displayName = typeof rawDisplayName === "string" ? rawDisplayName.trim() : "";
  const companyName = typeof rawCompanyName === "string" ? rawCompanyName.trim() : "";
  if (!email || typeof password !== "string" || !displayName || !companyName) {
    return NextResponse.json(
      { error: "A valid email, password, display name, and company name are required" },
      { status: 400 }
    );
  }
  if (!isValidWorkspaceTimeZone(timeZone)) {
    return NextResponse.json({ error: "Unknown time zone" }, { status: 400 });
  }
  const passwordError = validatePasswordStrength(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  try {
    const passwordHash = await hashPassword(password);
    const result = await transaction(async (client) => {
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO user_profiles (email, password_hash, display_name, verified_email)
         VALUES ($1, $2, $3, TRUE) ON CONFLICT DO NOTHING RETURNING id`,
        [email, passwordHash, displayName]
      );
      const userId = userResult.rows[0]?.id;
      if (!userId) return null;

      let slug = slugify(companyName);
      let company = await client.query<{ id: string }>(
        `INSERT INTO companies (name, slug, time_zone) VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO NOTHING RETURNING id`,
        [companyName, slug, timeZone]
      );
      if (!company.rowCount) {
        slug = `${slug}-${randomBytes(8).toString("hex")}`;
        company = await client.query<{ id: string }>(
          `INSERT INTO companies (name, slug, time_zone) VALUES ($1, $2, $3) RETURNING id`,
          [companyName, slug, timeZone]
        );
      }
      const companyId = company.rows[0].id;

      const membershipResult = await client.query<{ id: string }>(
        `INSERT INTO memberships (company_id, user_id, role, access_scope, state)
         VALUES ($1, $2, 'company_admin', 'company', 'active') RETURNING id`,
        [companyId, userId]
      );
      const membershipId = membershipResult.rows[0].id;

      await client.query(
        `INSERT INTO feeds (company_id, provider_name, dataset_key, name)
         VALUES ($1, 'Daptic', 'daptic-default', 'Daptic Alerts')`,
        [companyId]
      );
      const policy = await client.query<{ id: string }>(
        `INSERT INTO scoring_policies (company_id, version, rules_json, created_by, published_at, is_active)
         VALUES ($1, 1, $2, $3, now(), TRUE) RETURNING id`,
        [companyId, JSON.stringify(DEFAULT_POLICY), membershipId]
      );
      await client.query(`UPDATE companies SET active_policy_id = $1 WHERE id = $2`, [policy.rows[0].id, companyId]);
      await client.query(
        `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, after_values)
         VALUES ($1, $2, 'company.created', 'company', $1, $3)`,
        [companyId, membershipId, JSON.stringify({ name: companyName, slug })]
      );
      const credentials = await storeSession(userId, client);
      return { userId, companyId, membershipId, slug, credentials };
    });

    if (!result) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    await setSessionCookies(result.credentials, result.companyId);
    return NextResponse.json(
      {
        user: { id: result.userId, email, displayName },
        company: { id: result.companyId, name: companyName, slug: result.slug },
        membership: { id: result.membershipId, role: "company_admin" },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Signup error", { code: (error as { code?: string }).code });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
