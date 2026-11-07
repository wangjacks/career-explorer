import { describe, it, expect } from "vitest";
import { shouldShowMenu } from "../components/UserMenu";

describe("全局用户菜单的页面判定（#361）", () => {
  it("面板根路径显示菜单", () => {
    expect(shouldShowMenu("/dashboard/admin")).toBe(true);
    expect(shouldShowMenu("/dashboard/teacher")).toBe(true);
    expect(shouldShowMenu("/dashboard/student")).toBe(true);
  });

  it("面板子路由同样显示菜单（刷新 / 深链不会丢菜单）", () => {
    expect(shouldShowMenu("/dashboard/admin/students")).toBe(true);
    expect(shouldShowMenu("/dashboard/teacher/audit-logs/9")).toBe(true);
    expect(shouldShowMenu("/dashboard/student/history")).toBe(true);
    expect(shouldShowMenu("/dashboard/student/assessment/quiz")).toBe(true);
    expect(shouldShowMenu("/dashboard/student/reports")).toBe(true); // 未知子路由仍属面板范围
  });

  it("认证 / 安装页不显示菜单", () => {
    for (const path of ["/login", "/activate", "/setup"]) {
      expect(shouldShowMenu(path)).toBe(false);
    }
  });

  it("非面板页面与缺失 pathname 不显示菜单", () => {
    expect(shouldShowMenu("/privacy")).toBe(false);
    expect(shouldShowMenu("/dashboard")).toBe(false);
    expect(shouldShowMenu("/dashboard/administrator")).toBe(false);
    expect(shouldShowMenu(null)).toBe(false);
  });
});
