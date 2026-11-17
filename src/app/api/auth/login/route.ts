import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, companyId } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const emailLower = email.toLowerCase().trim();

    const userResult = await query(
      `SELECT id, email, display_name, password_hash, verified_email
       FROM user_profiles WHERE LOWER(email) = $1`,
      [emailLower]
    );

    if (userResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const user = userResult.rows[0];

    if (!user.password_hash) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    if (!user.verified_email) {
      return NextResponse.json(
        { error: "Please verify your email before signing in" },
        { status: 403 }
      );
    }

    // Get memberships
    const membershipsResult = await query(
      `SELECT m.id, m.company_id, m.role, m.access_scope, c.name as company_name, c.slug
       FROM memberships m JOIN companies c ON c.id = m.company_id
       WHERE m.user_id = $1 AND m.state = 'active' AND c.archived_at IS NULL
       ORDER BY m.joined_at ASC`,
      [user.id]
    );

    if (membershipsResult.rows.length === 0) {
      return NextResponse.json(
        { error: "No active workspace found for this account" },
        { status: 403 }
      );
    }

    // Pick the right company
    let selectedMembership = membershipsResult.rows[0];
    if (companyId) {
      const match = membershipsResult.rows.find(
        (m: Record<string, unknown>) => m.company_id === companyId
      );
      if (match) selectedMembership = match;
    }

    await createSession(user.id, selectedMembership.company_id);

    // Audit
    await query(
      `INSERT INTO audit_events (company_id, actor_membership_id, action, entity_type, entity_id)
       VALUES ($1, $2, 'user.login', 'user', $3)`,
      [selectedMembership.company_id, selectedMembership.id, user.id]
    );

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
      membership: {
        id: selectedMembership.id,
        companyId: selectedMembership.company_id,
        role: selectedMembership.role,
        companyName: selectedMembership.company_name,
      },
      companies:
        membershipsResult.rows.length > 1
          ? membershipsResult.rows.map((m: Record<string, unknown>) => ({
              companyId: m.company_id,
              companyName: m.company_name,
              role: m.role,
            }))
          : undefined,
    });
  } catch (error: unknown) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
