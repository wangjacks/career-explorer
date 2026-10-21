import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_HOME, roleHome, resolveExploreHref } from "@/lib/role-home";

describe("role-home", () => {
  describe("ROLE_HOME", () => {
    it("defines exactly the three role dashboards", () => {
      expect(ROLE_HOME).toEqual({
        admin: "/dashboard/admin",
        teacher: "/dashboard/teacher",
        student: "/dashboard/student",
      });
    });
  });

  describe("roleHome", () => {
    it("returns the panel for each known role", () => {
      expect(roleHome("admin")).toBe("/dashboard/admin");
      expect(roleHome("teacher")).toBe("/dashboard/teacher");
      expect(roleHome("student")).toBe("/dashboard/student");
    });

    it("returns undefined for a missing role", () => {
      expect(roleHome(undefined)).toBeUndefined();
      expect(roleHome(null)).toBeUndefined();
      expect(roleHome("")).toBeUndefined();
    });

    it("returns undefined for an unknown role instead of guessing one", () => {
      expect(roleHome("guardian")).toBeUndefined();
      expect(roleHome("Admin")).toBeUndefined();
      expect(roleHome("/dashboard/student")).toBeUndefined();
    });
  });

  describe("resolveExploreHref", () => {
    it("sends a valid session straight to its own panel for all three roles", () => {
      expect(resolveExploreHref({ valid: true, role: "admin" })).toBe("/dashboard/admin");
      expect(resolveExploreHref({ valid: true, role: "teacher" })).toBe("/dashboard/teacher");
      expect(resolveExploreHref({ valid: true, role: "student" })).toBe("/dashboard/student");
    });

    it("sends visitors without a session to /login", () => {
      expect(resolveExploreHref({ valid: false })).toBe("/login");
    });

    it("falls back to /login for an expired or tampered cookie", () => {
      // verifyToken 在过期/签名无效时只返回 { valid: false }
      expect(resolveExploreHref({ valid: false, role: undefined })).toBe("/login");
    });

    it("falls back to /login when the role is missing or unexpected", () => {
      expect(resolveExploreHref({ valid: true })).toBe("/login");
      expect(resolveExploreHref({ valid: true, role: "" })).toBe("/login");
      expect(resolveExploreHref({ valid: true, role: "guardian" })).toBe("/login");
      // 绝不能把非学生账号默认送进学生面板
      expect(resolveExploreHref({ valid: true, role: "unknown" })).not.toBe("/dashboard/student");
    });

    it("routes demo sessions by role; the demo flag does not change the target", () => {
      for (const role of ["admin", "teacher", "student"] as const) {
        expect(resolveExploreHref({ valid: true, role, demo: true })).toBe(
          resolveExploreHref({ valid: true, role })
        );
      }
    });
  });

  describe("single-source guard", () => {
    const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
    const LOGIN_PAGE = read("src/app/login/page.tsx");
    const HOME_PAGE = read("src/app/page.tsx");

    it("login page takes the landing map from role-home instead of its own copy", () => {
      expect(LOGIN_PAGE).toContain('from "@/lib/role-home"');
      expect(LOGIN_PAGE).not.toMatch(/const\s+ROLE_HOME\s*[:=]/);
    });

    it("homepage resolves the CTA target through the shared pure function", () => {
      expect(HOME_PAGE).toContain('from "@/lib/role-home"');
      expect(HOME_PAGE).toContain("resolveExploreHref(");
      // 首页只在服务端读 cookie 判定，不走客户端会话探测
      expect(HOME_PAGE).toContain("cookies()");
      expect(HOME_PAGE).not.toContain("useSession");
    });
  });
});
