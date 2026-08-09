import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";

export async function proxy(request: NextRequest) {
  // Allow auth endpoint through without auth check (all methods)
  if (request.nextUrl.pathname === "/api/admin/auth") {
    return NextResponse.next();
  }

  // Page routes: let client-side handle login state (via GET /api/admin/auth)
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // API routes: enforce JWT auth + role permission
  const token = request.cookies.get("auth_token")?.value;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await verifyToken(token);
  if (!result.valid) {
    const response = NextResponse.json(
      { error: "Token expired" },
      { status: 401 }
    );
    response.cookies.delete("auth_token");
    return response;
  }

  // /api/admin/* requires admin role
  if (result.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  // Protect admin pages and API routes, auth endpoint bypassed inside proxy
  matcher: ["/dashboard/admin/:path*", "/api/admin/:path*"],
};
