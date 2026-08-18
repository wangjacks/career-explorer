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
    it("should match admin pages and admin API routes", () => {
      expect(config.matcher).toEqual(
        expect.arrayContaining(["/dashboard/admin/:path*", "/api/admin/:path*"])
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
      const req = createRequest("/api/admin/students");
      const res = await proxy(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("should allow access with valid admin token", async () => {
      const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
      const req = createRequest("/api/admin/students", { auth_token: token });
      const res = await proxy(req);
      expect(res.status).toBe(200);
    });

    it("should return 401 and clear cookie with invalid token", async () => {
      const req = createRequest("/api/admin/students", { auth_token: "invalid-token" });
      const res = await proxy(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Token expired");

      // Check that the response deletes the cookie
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain("auth_token=");
    });
  });

  describe("role permission", () => {
    it("should return 403 for student token on /api/admin/*", async () => {
      const token = await signToken({ role: "student", uid: 2, name: "测试学生" });
      const req = createRequest("/api/admin/students", { auth_token: token });
      const res = await proxy(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Forbidden");
    });

    it("should return 403 for teacher token on non-whitelisted /api/admin/*", async () => {
      const token = await signToken({ role: "teacher", uid: 3, name: "测试教师" });
      const req = createRequest("/api/admin/settings", { auth_token: token });
      const res = await proxy(req);
      expect(res.status).toBe(403);
    });

    it("should allow teacher token on /api/admin/classes*", async () => {
      const token = await signToken({ role: "teacher", uid: 3, name: "测试教师" });
      const req = createRequest("/api/admin/classes", { auth_token: token });
      const res = await proxy(req);
      expect(res.status).toBe(200);
    });

    it("should allow teacher GET /api/admin/students but reject writes", async () => {
      const token = await signToken({ role: "teacher", uid: 3, name: "测试教师" });
      const getRes = await proxy(createRequest("/api/admin/students", { auth_token: token }, "GET"));
      expect(getRes.status).toBe(200);
      const postRes = await proxy(createRequest("/api/admin/students", { auth_token: token }, "POST"));
      expect(postRes.status).toBe(403);
    });

    it("should return 403 for student token on /api/admin/classes", async () => {
      const token = await signToken({ role: "student", uid: 2, name: "测试学生" });
      const req = createRequest("/api/admin/classes", { auth_token: token });
      const res = await proxy(req);
      expect(res.status).toBe(403);
    });
  });

  describe("type safety", () => {
    it("Role type should cover three roles", () => {
      const roles: Role[] = ["admin", "teacher", "student"];
      expect(roles).toHaveLength(3);
    });
  });
});
