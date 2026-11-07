import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOGIN_ENDPOINTS,
  isDemoLoginParam,
  resolveLoginMode,
} from "@/lib/login-mode";

describe("演示登录模式（#350）", () => {
  describe("isDemoLoginParam", () => {
    it("仅精确的 demo=1 开启演示模式", () => {
      expect(isDemoLoginParam("1")).toBe(true);
    });

    it("其它取值一律按生产登录处理", () => {
      for (const value of ["0", "true", "yes", "", " 1 ", null, undefined]) {
        expect(isDemoLoginParam(value)).toBe(false);
      }
    });
  });

  describe("resolveLoginMode", () => {
    it("生产模式提交到 /api/auth，保留激活入口", () => {
      const mode = resolveLoginMode(false);
      expect(mode.demo).toBe(false);
      expect(mode.endpoint).toBe("/api/auth");
      expect(mode.showActivation).toBe(true);
      expect(mode.title).toBe("登录");
      expect(mode.description).toBe("使用编号和密码登录（管理员 / 教师 / 学生）");
      expect(mode.submitLabel).toBe("登录");
      expect(mode.loadingLabel).toBe("登录中...");
    });

    it("演示模式提交到 /api/auth/demo，隐藏激活入口并带演示标识", () => {
      const mode = resolveLoginMode(true);
      expect(mode.demo).toBe(true);
      expect(mode.endpoint).toBe(LOGIN_ENDPOINTS.demo);
      expect(mode.showActivation).toBe(false);
      expect(mode.navTitle).toContain("演示");
      expect(mode.title).toContain("演示");
      expect(mode.description).toContain("演示");
      expect(mode.submitLabel).toContain("演示");
      expect(mode.loadingLabel).toContain("演示");
    });
  });

  describe("登录页源码守卫", () => {
    const LOGIN_PAGE = readFileSync(
      join(process.cwd(), "src/app/login/page.tsx"),
      "utf8"
    );

    it("从 login-mode 取模式与端点，不内联端点字面量", () => {
      expect(LOGIN_PAGE).toContain('from "@/lib/login-mode"');
      expect(LOGIN_PAGE).toContain("resolveLoginMode(");
      expect(LOGIN_PAGE).toContain("isDemoLoginParam(");
      expect(LOGIN_PAGE).toContain("fetch(mode.endpoint");
      expect(LOGIN_PAGE).not.toContain('"/api/auth"');
      expect(LOGIN_PAGE).not.toContain('"/api/auth/demo"');
    });

    it("保留 useSearchParams 所需的 Suspense 边界", () => {
      expect(LOGIN_PAGE).toContain("Suspense");
    });
  });
});
