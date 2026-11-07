import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";

/** 声明式权限表：teacher 可用的 manage 路由（前缀 + 允许的 HTTP 方法） */
const TEACHER_ALLOWED: { prefix: string; methods: "all" | string[] }[] = [
  { prefix: "/api/manage/classes", methods: "all" },
  // #171：学生写入的班级归属在路由内判定（前缀匹配连 batch-password 一起放行，权限表判不了单条记录归属）
  { prefix: "/api/manage/students", methods: "all" },
  // #171：预设标签与档案功能设置全站生效，教师只读，写入只归管理员
  { prefix: "/api/manage/tags", methods: ["GET"] },
  { prefix: "/api/manage/export", methods: "all" }, // startsWith 覆盖 export-images
  { prefix: "/api/manage/stats", methods: ["GET"] }, // startsWith 覆盖 stats/assessment（#229 聚合，学生不可见）
  // #229 测评名册：含姓名/学号，前缀整体放行后由路由按 teacher_classes 收窄到归属班级，并每次读取记审计
  { prefix: "/api/manage/assessment", methods: ["GET"] },
  { prefix: "/api/manage/profiles", methods: ["GET", "DELETE"] },
  { prefix: "/api/manage/profile-config", methods: ["GET"] },
  { prefix: "/api/manage/audit-logs", methods: ["GET"] }, // #110：教师仅可查询本人记录，路由内强制 actor_id = 本人
  // #101 分组：读不限（可看全校名单），写操作由路由用 canModifyClass 收紧到所带班级
  { prefix: "/api/manage/groups", methods: "all" },
];

/**
 * 演示管理员可用（#274）：演示班相关的读 + 演示内的教师级写（分组/导出）。
 * 全站级配置 / 存储 / 备份 / 媒体 / 教师账户 / 演示生命周期 / 学生与标签的写一律拒绝。
 * 重点：`/api/manage/test-db` 不在表内——它绕过演示作用域、可按请求体打开任意 SQLite/MySQL，
 * 是 demo-admin 唯一能触达生产库的入口。
 * 与 `TEACHER_ALLOWED` 同构；改代码须同步 `docs/architecture.md` 权限表。
 */
const DEMO_ALLOWED: { prefix: string; methods: "all" | string[] }[] = [
  { prefix: "/api/manage/classes", methods: ["GET"] }, // 含 [id] 的 GET 与 poster
  { prefix: "/api/manage/students", methods: ["GET"] }, // 只读名册，禁增删改/批量改密
  { prefix: "/api/manage/tags", methods: ["GET"] }, // 禁标签写/导入/恢复
  { prefix: "/api/manage/profile-config", methods: ["GET"] },
  { prefix: "/api/manage/profiles", methods: ["GET", "DELETE"] }, // cleanup POST 被方法拦下
  { prefix: "/api/manage/groups", methods: "all" },
  { prefix: "/api/manage/export", methods: "all" }, // 含 export-images
  { prefix: "/api/manage/stats", methods: ["GET"] },
  { prefix: "/api/manage/assessment", methods: ["GET"] },
  { prefix: "/api/manage/audit-logs", methods: ["GET"] },
];

/** 前缀 + 方法是否命中声明式权限表 */
function allowedBy(
  table: { prefix: string; methods: "all" | string[] }[],
  pathname: string,
  method: string
): boolean {
  return table.some(
    (rule) =>
      pathname.startsWith(rule.prefix) &&
      (rule.methods === "all" || rule.methods.includes(method))
  );
}

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
    // 演示管理员按 DEMO_ALLOWED 收敛，不再享受生产 admin 的全放行（#274）
    if (result.demo === true && !allowedBy(DEMO_ALLOWED, request.nextUrl.pathname, request.method)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.next();
  }
  if (result.role === "teacher") {
    if (allowedBy(TEACHER_ALLOWED, request.nextUrl.pathname, request.method)) {
      return NextResponse.next();
    }
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export const config = {
  // Protect admin pages and manage API routes
  matcher: ["/dashboard/admin/:path*", "/api/manage/:path*"],
};
