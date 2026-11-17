import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { DEFAULT_POLICY } from "@/lib/scoring/policy";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

const DEFAULT_SCORING_POLICY = DEFAULT_POLICY;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, displayName, companyName, timeZone } = body;

    if (!email || !password || !displayName || !companyName) {
      return NextResponse.json(
        { error: "Email, password, display name, and company name are required" },
        { status: 400 }
      );
    }

    const emailLower = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    const pwError = validatePasswordStrength(password);
    if (pwError) {
      return NextResponse.json({ error: pwError }, { status: 400 });
    }

    const existing = await query(
      `SELECT id FROM user_profiles WHERE LOWER(email) = $1`,
      [emailLower]
    );
    if (existing.rows.length > 0) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    let slug = slugify(companyName);
    const slugCheck = await query(
      `SELECT id FROM companies WHERE slug = $1`,
      [slug]
    );
    if (slugCheck.rows.length > 0) {
      slug = slug + "-" + Date.now().toString(36);
    }

    const tz = timeZone || "UTC";

    // Create user
    const userResult = await query(
      `INSERT INTO user_profiles (email, password_hash, display_name, verified_email)
       VALUES ($1, $2, $3, TRUE) RETURNING id`,
      [emailLower, passwordHash, displayName.trim()]
    );
    const userId = userResult.rows[0].id;

    // Create company
    const companyResult = await query(
      `INSERT INTO companies (name, slug, time_zone)
       VALUES ($1, $2, $3) RETURNING id`,
      [companyName.trim(), slug, tz]
    );
    const companyId = companyResult.rows[0].id;

    // Create membership
    const membershipResult = await query(
      `INSERT INTO memberships (company_id, user_id, role, access_scope, state)
       VALUES ($1, $2, 'company_admin', 'company', 'active') RETURNING id`,
      [companyId, userId]
    );
    const membershipId = membershipResult.rows[0].id;

    // Create default feed
    await query(
      `INSERT INTO feeds (company_id, provider_name, dataset_key, name)
       VALUES ($1, 'Daptic', 'daptic-default', 'Daptic Alerts')`,
      [companyId]
    );

    // Create default scoring policy
    const policyResult = await query(
      `INSERT INTO scoring_policies (company_id, version, rules_json, created_by, published_at, is_active)
       VALUES ($1, 1, $2, $3, now(), TRUE) RETURNING id`,
      [companyId, JSON.stringify(DEFAULT_SCORING_POLICY), membershipId]
    );
    const policyId = policyResult.rows[0].id;

    // Link policy to company
    await query(`UPDATE companies SET active_policy_id = $1 WHERE id = $2`, [
      policyId,
      companyId,
    ]);

    // Audit
    await query(
      `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id, after_values)
       VALUES ($1, $2, 'company.created', 'company', $3, $4)`,
      [companyId, membershipId, companyId, JSON.stringify({ name: companyName.trim(), slug })]
    );

    await createSession(userId, companyId);

    return NextResponse.json(
      {
        user: { id: userId, email: emailLower, displayName: displayName.trim() },
        company: { id: companyId, name: companyName.trim(), slug },
        membership: { id: membershipId, role: "company_admin" },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
