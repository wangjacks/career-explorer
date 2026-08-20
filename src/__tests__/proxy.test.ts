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
    it("should allow teacher all methods on classes/students/tags/export", async () => {
      const token = await signToken({ role: "teacher", uid: 3, name: "测试教师" });
      const paths = [
        "/api/manage/classes",
        "/api/manage/students",
        "/api/manage/students/batch-password",
        "/api/manage/tags",
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

    it("should allow teacher GET-only on stats (including sub routes)", async () => {
      const token = await signToken({ role: "teacher", uid: 3, name: "测试教师" });
      for (const path of ["/api/manage/stats", "/api/manage/stats/trends", "/api/manage/stats/distribution", "/api/manage/stats/compare"]) {
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

  describe("type safety", () => {
    it("Role type should cover three roles", () => {
      const roles: Role[] = ["admin", "teacher", "student"];
      expect(roles).toHaveLength(3);
    });
  });
});
