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
  // - /api/admin/students：teacher 仅 GET 只读（教师面板学生归属展示）
  if (result.role !== "admin") {
    const { pathname } = request.nextUrl;
    const classesAllowed = result.role === "teacher" && pathname.startsWith("/api/admin/classes");
    const studentsReadOnly =
      result.role === "teacher" && request.method === "GET" && pathname === "/api/admin/students";
    if (!classesAllowed && !studentsReadOnly) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  // Protect admin pages and admin API routes
  matcher: ["/dashboard/admin/:path*", "/api/admin/:path*"],
};
