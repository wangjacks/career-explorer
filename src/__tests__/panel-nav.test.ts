import { describe, it, expect } from "vitest";
import {
  ADMIN_NAV_ITEMS,
  ADMIN_ROOT_PATH,
  TEACHER_NAV_ITEMS,
  TEACHER_ROOT_PATH,
  normalizePanelPath,
  panelNavItems,
  panelPath,
  resolvePanelKey,
} from "../lib/panel-nav";

const ALL = [
  { role: "admin" as const, items: ADMIN_NAV_ITEMS, root: ADMIN_ROOT_PATH },
  { role: "teacher" as const, items: TEACHER_NAV_ITEMS, root: TEACHER_ROOT_PATH },
];

describe("面板导航路由配置（#361）", () => {
  it("管理面板 15 个 Tab、教师面板 11 个 Tab，key 与路径都唯一", () => {
    expect(ADMIN_NAV_ITEMS).toHaveLength(15);
    expect(TEACHER_NAV_ITEMS).toHaveLength(11);
    for (const { items } of ALL) {
      expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
      expect(new Set(items.map((item) => item.path)).size).toBe(items.length);
    }
  });

  it("每个路径都在本角色面板下，根路径就是默认 Tab", () => {
    for (const { items, root } of ALL) {
      for (const item of items) {
        expect(item.path === root || item.path.startsWith(`${root}/`)).toBe(true);
      }
      expect(items[0].path).toBe(root);
    }
  });

  it("panelPath 与 panelNavItems 只认本角色配置", () => {
    expect(panelPath("admin", "students")).toBe("/dashboard/admin/students");
    expect(panelPath("teacher", "students")).toBe("/dashboard/teacher/students");
    expect(panelPath("admin", "home")).toBeUndefined();
    expect(panelPath("teacher", "home")).toBe("/dashboard/teacher");
    expect(panelPath("teacher", "overview")).toBe("/dashboard/teacher/overview");
    expect(panelNavItems("admin")).toBe(ADMIN_NAV_ITEMS);
    expect(panelNavItems("teacher")).toBe(TEACHER_NAV_ITEMS);
  });
});

describe("resolvePanelKey", () => {
  it("根路径精确命中默认 Tab，而不是按前缀吞掉所有子路由", () => {
    expect(resolvePanelKey("/dashboard/admin", ADMIN_NAV_ITEMS)).toBe("overview");
    expect(resolvePanelKey("/dashboard/teacher", TEACHER_NAV_ITEMS)).toBe("home");
    expect(resolvePanelKey("/dashboard/admin/", ADMIN_NAV_ITEMS)).toBe("overview");
  });

  it("子路由精确命中；多级子路由按最长前缀命中", () => {
    expect(resolvePanelKey("/dashboard/admin/students", ADMIN_NAV_ITEMS)).toBe("students");
    expect(resolvePanelKey("/dashboard/admin/students/123", ADMIN_NAV_ITEMS)).toBe("students");
    expect(resolvePanelKey("/dashboard/teacher/audit-logs/9", TEACHER_NAV_ITEMS)).toBe("audit-logs");
    expect(resolvePanelKey("/dashboard/teacher/screen", TEACHER_NAV_ITEMS)).toBe("screen");
  });

  it("分段边界：相似前缀不误判", () => {
    expect(resolvePanelKey("/dashboard/admin/students2", ADMIN_NAV_ITEMS)).toBe("overview");
    expect(resolvePanelKey("/dashboard/teacher/screens", TEACHER_NAV_ITEMS)).toBe("home");
  });

  it("未知路径 / 缺失 pathname 回落到默认 Tab", () => {
    expect(resolvePanelKey("/dashboard/admin/nope", ADMIN_NAV_ITEMS)).toBe("overview");
    expect(resolvePanelKey(null, ADMIN_NAV_ITEMS)).toBe("overview");
    expect(resolvePanelKey(undefined, TEACHER_NAV_ITEMS)).toBe("home");
    expect(resolvePanelKey("/dashboard/teacher", [])).toBe("");
  });

  it("normalizePanelPath 去尾斜杠但保留根路径", () => {
    expect(normalizePanelPath("/dashboard/admin/")).toBe("/dashboard/admin");
    expect(normalizePanelPath("/")).toBe("/");
    expect(normalizePanelPath("")).toBe("");
    expect(normalizePanelPath(null)).toBe("");
  });
});
