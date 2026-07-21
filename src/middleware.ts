import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "career-explorer-default-secret-change-me"
);

export async function middleware(request: NextRequest) {
  // Allow auth login endpoint through without auth check
  if (request.nextUrl.pathname === "/api/admin/auth") {
    return NextResponse.next();
  }

  // Page routes: let client-side handle login state
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // API routes: enforce JWT auth, return 401 JSON on failure
  const token = request.cookies.get("admin_token")?.value;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await jwtVerify(token, JWT_SECRET);
    return NextResponse.next();
  } catch {
    const response = NextResponse.json({ error: "Token expired" }, { status: 401 });
    response.cookies.delete("admin_token");
    response.cookies.delete("admin_logged_in");
    return response;
  }
}

export const config = {
  // Protect admin pages and API routes, except the auth endpoint
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
