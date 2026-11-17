import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";

export async function POST(request: Request) {
  try {
    await destroySession();
    // This endpoint is submitted by a regular HTML form. A 303 converts the
    // completed POST into a GET so the user lands on the login page instead of
    // seeing a raw JSON response.
    return NextResponse.redirect(new URL("/login", request.url), 303);
  } catch (error: unknown) {
    console.error("Logout error:", error);
    // destroySession clears both auth cookies before attempting server-side
    // revocation, so the user is logged out in this browser even on DB failure.
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }
}
