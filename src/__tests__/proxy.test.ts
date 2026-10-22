import { describe, it, expect } from "vitest";
import { proxy, config } from "@/proxy";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";
import type { Role } from "@/lib/token";

function createRequest(path: string, cookies?: Record<string, string>, method = "GET"): NextRequest {
  const url = new URL(path, "http://localhost:3000");
  const cookieHeader = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
    : "";
  return new NextRequest(url, {
    method,
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

describe("proxy", () => {
  describe("config.matcher", () => {
    it("should match admin pages and manage API routes", () => {
      expect(config.matcher).toEqual(
        expect.arrayContaining(["/dashboard/admin/:path*", "/api/manage/:path*"])
      );
    });
  });

  describe("non-API page routes", () => {
    it("should allow page routes without auth", async () => {
      const req = createRequest("/dashboard/admin/page");
      const res = await proxy(req);
      expect(res.status).toBe(200);
    });

    it("should allow root path without auth", async () => {
      const req = createRequest("/");
      const res = await proxy(req);
      expect(res.status).toBe(200);
    });
  });

  describe("API route authentication", () => {
    it("should return 401 when no token is provided", async () => {
      const req = createRequest("/api/manage/students");
      const res = await proxy(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("should allow access with valid admin token", async () => {
      const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
      const req = createRequest("/api/manage/students", { auth_token: token });
      const res = await proxy(req);
      expect(res.status).toBe(200);
    });

    it("should return 401 and clear cookie with invalid token", async () => {
      const req = createRequest("/api/manage/students", { auth_token: "invalid-token" });
      const res = await proxy(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Token expired");

      // Check that the response deletes the cookie
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain("auth_token=");
    });
  });

  describe("admin role", () => {
    it("should allow admin all methods on admin-only routes", async () => {
      const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
      for (const path of ["/api/manage/teachers", "/api/manage/settings", "/api/manage/backup", "/api/manage/test-db"]) {
        const res = await proxy(createRequest(path, { auth_token: token }, "POST"));
        expect(res.status).toBe(200);
      }
    });
  });

  describe("teacher role", () => {
    it("should allow teacher all methods on classes/students/export（写入归属由路由内判定，#171）", async () => {
      const token = await signToken({ role: "teacher", uid: 3, name: "测试教师" });
      const paths = [
        "/api/manage/classes",
        "/api/manage/students",
        "/api/manage/students/batch-password",
        "/api/manage/export",
        "/api/manage/export-images",
      ];
      for (const path of paths) {
        for (const method of ["GET", "POST", "PUT", "DELETE"]) {
          const res = await proxy(createRequest(path, { auth_token: token }, method));
          expect(res.status).toBe(200);
        }
      }
    });

    it("should allow teacher GET-only on tags and profile-config（全站生效配置写入归管理员，#171）", async () => {
      const token = await signToken({ role: "teacher", uid: 3, name: "测试教师" });
      for (const path of ["/api/manage/tags", "/api/manage/profile-config"]) {
        const getRes = await proxy(createRequest(path, { auth_token: token }, "GET"));
        expect(getRes.status).toBe(200);
        for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
          const res = await proxy(createRequest(path, { auth_token: token }, method));
          expect(res.status).toBe(403);
        }
      }
      // 子路由同样只读（前缀匹配覆盖 tags/batch 与 tags/restore）
      for (const path of ["/api/manage/tags/batch", "/api/manage/tags/restore"]) {
        const res = await proxy(createRequest(path, { auth_token: token }, "POST"));
        expect(res.status).toBe(403);
      }
    });

    it("should allow teacher GET-only on stats (including sub routes)", async () => {
      const token = await signToken({ role: "teacher", uid: 3, name: "测试教师" });
      for (const path of [
        "/api/manage/stats",
        "/api/manage/stats/trends",
        "/api/manage/stats/distribution",
        "/api/manage/stats/compare",
        "/api/manage/stats/class-roster",
      ]) {
        const getRes = await proxy(createRequest(path, { auth_token: token }, "GET"));
        expect(getRes.status).toBe(200);
        const postRes = await proxy(createRequest(path, { auth_token: token }, "POST"));
        expect(postRes.status).toBe(403);
      }
    });

    it("should allow teacher GET and DELETE on profiles but reject other methods", async () => {
      const token = await signToken({ role: "teacher", uid: 3, name: "测试教师" });
      const getRes = await proxy(createRequest("/api/manage/profiles", { auth_token: token }, "GET"));
      expect(getRes.status).toBe(200);
      const deleteRes = await proxy(createRequest("/api/manage/profiles", { auth_token: token }, "DELETE"));
      expect(deleteRes.status).toBe(200);
      const postRes = await proxy(createRequest("/api/manage/profiles", { auth_token: token }, "POST"));
      expect(postRes.status).toBe(403);
    });

    it("should allow teacher GET-only on audit-logs（#110 审计只读）", async () => {
      const token = await signToken({ role: "teacher", uid: 3, name: "测试教师" });
      const getRes = await proxy(createRequest("/api/manage/audit-logs", { auth_token: token }, "GET"));
      expect(getRes.status).toBe(200);
      const postRes = await proxy(createRequest("/api/manage/audit-logs", { auth_token: token }, "POST"));
      expect(postRes.status).toBe(403);
      const deleteRes = await proxy(createRequest("/api/manage/audit-logs", { auth_token: token }, "DELETE"));
      expect(deleteRes.status).toBe(403);
    });

    it("should return 403 for teacher on admin-only routes", async () => {
      const token = await signToken({ role: "teacher", uid: 3, name: "测试教师" });
      for (const path of ["/api/manage/teachers", "/api/manage/settings", "/api/manage/backup", "/api/manage/test-db"]) {
        const res = await proxy(createRequest(path, { auth_token: token }, "GET"));
        expect(res.status).toBe(403);
      }
    });
  });

  describe("student role", () => {
    it("should return 403 for student token on /api/manage/*", async () => {
      const token = await signToken({ role: "student", uid: 2, name: "测试学生" });
      for (const path of ["/api/manage/students", "/api/manage/classes", "/api/manage/stats", "/api/manage/settings"]) {
        const res = await proxy(createRequest(path, { auth_token: token }, "GET"));
        expect(res.status).toBe(403);
      }
    });
  });

  describe("demo admin role（#274）", () => {
    const demoAdminToken = () => signToken({ role: "admin", uid: 1, name: "演示管理员", demo: true });

    it("按 DEMO_ALLOWED 放行演示班读与教师级写", async () => {
      const token = await demoAdminToken();
      const allowed: [string, string][] = [
        ["/api/manage/classes", "GET"],
        ["/api/manage/classes/1/poster", "GET"],
        ["/api/manage/students", "GET"],
        ["/api/manage/tags", "GET"],
        ["/api/manage/profile-config", "GET"],
        ["/api/manage/profiles", "GET"],
        ["/api/manage/profiles", "DELETE"],
        ["/api/manage/profiles/submissions", "GET"],
        ["/api/manage/groups", "POST"],
        ["/api/manage/groups/batches", "GET"],
        ["/api/manage/export", "GET"],
        ["/api/manage/export-images", "GET"],
        ["/api/manage/stats/assessment", "GET"],
        ["/api/manage/assessment/roster", "GET"],
        ["/api/manage/audit-logs", "GET"],
      ];
      for (const [path, method] of allowed) {
        const res = await proxy(createRequest(path, { auth_token: token }, method));
        expect(res.status, `${method} ${path}`).toBe(200);
      }
    });

    it("拒绝全站级/管理级端点与写操作（含 test-db）", async () => {
      const token = await demoAdminToken();
      const denied: [string, string][] = [
        ["/api/manage/test-db", "POST"],
        ["/api/manage/settings", "GET"],
        ["/api/manage/settings", "PUT"],
        ["/api/manage/storage", "GET"],
        ["/api/manage/storage/test", "POST"],
        ["/api/manage/storage/migrate", "POST"],
        ["/api/manage/backup", "GET"],
        ["/api/manage/backup", "POST"],
        ["/api/manage/media/status", "GET"],
        ["/api/manage/media/orphans/cleanup", "POST"],
        ["/api/manage/teachers", "GET"],
        ["/api/manage/teachers", "POST"],
        ["/api/manage/students", "POST"],
        ["/api/manage/students", "PUT"],
        ["/api/manage/students", "DELETE"],
        ["/api/manage/students/batch-password", "POST"],
        ["/api/manage/classes", "POST"],
        ["/api/manage/tags", "POST"],
        ["/api/manage/tags/batch", "POST"],
        ["/api/manage/profile-config", "PUT"],
        ["/api/manage/profiles/submissions/cleanup", "POST"],
        ["/api/manage/demo/status", "GET"],
        ["/api/manage/demo/reset", "POST"],
      ];
      for (const [path, method] of denied) {
        const res = await proxy(createRequest(path, { auth_token: token }, method));
        expect(res.status, `${method} ${path}`).toBe(403);
      }
    });

    it("不影响生产 admin、demo-teacher 与 demo-student 的既有规则", async () => {
      const prodAdmin = await signToken({ role: "admin", uid: 1, name: "管理员" });
      for (const [path, method] of [
        ["/api/manage/test-db", "POST"],
        ["/api/manage/settings", "PUT"],
        ["/api/manage/backup", "POST"],
      ] as [string, string][]) {
        expect((await proxy(createRequest(path, { auth_token: prodAdmin }, method))).status).toBe(200);
      }

      const demoTeacher = await signToken({ role: "teacher", uid: 3, name: "演示教师", demo: true });
      expect((await proxy(createRequest("/api/manage/groups", { auth_token: demoTeacher }, "POST"))).status).toBe(200);
      expect((await proxy(createRequest("/api/manage/settings", { auth_token: demoTeacher }, "GET"))).status).toBe(403);

      const demoStudent = await signToken({ role: "student", uid: 2, name: "演示学生", demo: true });
      expect((await proxy(createRequest("/api/manage/stats", { auth_token: demoStudent }, "GET"))).status).toBe(403);
    });
  });

  describe("type safety", () => {
    it("Role type should cover three roles", () => {
      const roles: Role[] = ["admin", "teacher", "student"];
      expect(roles).toHaveLength(3);
    });
  });
});
