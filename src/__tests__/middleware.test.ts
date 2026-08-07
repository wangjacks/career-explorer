import { describe, it, expect } from "vitest";
import { middleware, config } from "@/middleware";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/auth";

function createRequest(path: string, cookies?: Record<string, string>): NextRequest {
  const url = new URL(path, "http://localhost:3000");
  const cookieHeader = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
    : "";
  return new NextRequest(url, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

describe("middleware", () => {
  describe("config.matcher", () => {
    it("should match admin pages and admin API routes", () => {
      expect(config.matcher).toEqual(
        expect.arrayContaining(["/dashboard/admin/:path*", "/api/admin/:path*"])
      );
    });
  });

  describe("auth login endpoint bypass", () => {
    it("should allow /api/admin/auth without token", async () => {
      const req = createRequest("/api/admin/auth");
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });
  });

  describe("non-API page routes", () => {
    it("should allow page routes without auth", async () => {
      const req = createRequest("/dashboard/admin/page");
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it("should allow root path without auth", async () => {
      const req = createRequest("/");
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });
  });

  describe("API route authentication", () => {
    it("should return 401 when no token is provided", async () => {
      const req = createRequest("/api/admin/students");
      const res = await middleware(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("should allow access with valid token", async () => {
      const token = await signToken();
      const req = createRequest("/api/admin/students", { admin_token: token });
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it("should return 401 and clear cookie with invalid token", async () => {
      const req = createRequest("/api/admin/students", { admin_token: "invalid-token" });
      const res = await middleware(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Token expired");

      // Check that the response deletes the cookie
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain("admin_token=");
    });
  });
});
