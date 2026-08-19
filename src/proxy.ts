import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";

export async function proxy(request: NextRequest) {
  // Page routes: let client-side handle login state (via GET /api/auth)
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

  // /api/admin/* 默认仅 admin；例外：
  // - /api/admin/classes*：admin + teacher（班级管理，步骤 8）
  // - /api/admin/students*：admin + teacher（教师可管理所有班级学生，步骤 10）
  // - /api/admin/stats*：teacher 仅 GET 只读；/api/admin/profiles：teacher GET+DELETE（数据列表）
  // - /api/admin/tags*、/api/admin/export*：admin + teacher（标签管理、数据导出）
  // - /api/admin/teachers*：仅 admin（教师账户由管理员创建）
  if (result.role !== "admin") {
    if (result.role !== "teacher") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { pathname } = request.nextUrl;
    const method = request.method;
    const allowed =
      pathname.startsWith("/api/admin/classes") ||
      pathname.startsWith("/api/admin/students") ||
      (pathname.startsWith("/api/admin/stats") && method === "GET") ||
      (pathname === "/api/admin/profiles" && (method === "GET" || method === "DELETE")) ||
      pathname.startsWith("/api/admin/tags") ||
      pathname.startsWith("/api/admin/export");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  // Protect admin pages and admin API routes
  matcher: ["/dashboard/admin/:path*", "/api/admin/:path*"],
};
