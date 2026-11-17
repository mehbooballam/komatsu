import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/auth/middleware";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({
      user: session.user,
      membership: session.membership,
      company: session.company,
    });
  } catch (error: unknown) {
    console.error("Get profile error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { displayName, preferences } = await request.json();

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (displayName !== undefined) {
      updates.push(`display_name = $${idx++}`);
      values.push(displayName.trim());
    }
    if (preferences !== undefined) {
      updates.push(`preferences = $${idx++}`);
      values.push(JSON.stringify(preferences));
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    values.push(session.user.id);
    const result = await query(
      `UPDATE user_profiles SET ${updates.join(", ")} WHERE id = $${idx}
       RETURNING id, email, display_name, preferences`,
      values
    );

    return NextResponse.json({ user: result.rows[0] });
  } catch (error: unknown) {
    console.error("Update profile error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
