import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";

/** 声明式权限表：teacher 可用的 manage 路由（前缀 + 允许的 HTTP 方法） */
const TEACHER_ALLOWED: { prefix: string; methods: "all" | string[] }[] = [
  { prefix: "/api/manage/classes", methods: "all" },
  { prefix: "/api/manage/students", methods: "all" },
  { prefix: "/api/manage/tags", methods: "all" },
  { prefix: "/api/manage/export", methods: "all" }, // startsWith 覆盖 export-images
  { prefix: "/api/manage/stats", methods: ["GET"] },
  { prefix: "/api/manage/profiles", methods: ["GET", "DELETE"] },
  { prefix: "/api/manage/profile-config", methods: "all" },
  { prefix: "/api/manage/audit-logs", methods: ["GET"] }, // #110：教师仅可查询本人记录，路由内强制 actor_id = 本人
];

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

  // /api/manage/*：admin 全部放行；teacher 按权限表放行；其余角色 403
  // /api/shared/*、/api/auth、/api/setup 等不在 matcher 内，由路由自行鉴权
  if (result.role === "admin") {
    return NextResponse.next();
  }
  if (result.role === "teacher") {
    const { pathname } = request.nextUrl;
    const allowed = TEACHER_ALLOWED.some(
      (rule) =>
        pathname.startsWith(rule.prefix) &&
        (rule.methods === "all" || rule.methods.includes(request.method))
    );
    if (allowed) {
      return NextResponse.next();
    }
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export const config = {
  // Protect admin pages and manage API routes
  matcher: ["/dashboard/admin/:path*", "/api/manage/:path*"],
};
