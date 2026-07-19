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

  const token = request.cookies.get("admin_token")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  try {
    await jwtVerify(token, JWT_SECRET);
    return NextResponse.next();
  } catch {
    const response = NextResponse.redirect(new URL("/admin/login", request.url));
    response.cookies.delete("admin_token");
    return response;
  }
}

export const config = {
  // Protect admin pages and API routes, except the auth endpoint
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
