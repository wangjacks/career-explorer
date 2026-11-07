import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_NAV_ITEMS, TEACHER_NAV_ITEMS, type PanelNavItemDef } from "../lib/panel-nav";

function routeFileFor(role: "admin" | "teacher", item: PanelNavItemDef): string {
  const root = join(process.cwd(), "src/app/dashboard", role);
  const relative = item.path.replace(`/dashboard/${role}`, "").replace(/^\//, "");
  return relative ? join(root, relative, "page.tsx") : join(root, "page.tsx");
}

describe("面板 Tab 路由结构（#361）", () => {
  it("管理与教师面板每个 Tab 都有独立 page.tsx", () => {
    for (const { role, items } of [
      { role: "admin" as const, items: ADMIN_NAV_ITEMS },
      { role: "teacher" as const, items: TEACHER_NAV_ITEMS },
    ]) {
      for (const item of items) {
        expect(existsSync(routeFileFor(role, item)), `${role}/${item.key} 缺少路由页`).toBe(true);
      }
    }
  });

  it("学生档案 / 历史 / 小组是路由组下的独立页，职业测评保持独立页", () => {
    for (const rel of [
      "src/app/dashboard/student/(panel)/page.tsx",
      "src/app/dashboard/student/(panel)/history/page.tsx",
      "src/app/dashboard/student/(panel)/group/page.tsx",
      "src/app/dashboard/student/assessment/page.tsx",
      "src/app/dashboard/student/assessment/quiz/page.tsx",
    ]) {
      expect(existsSync(join(process.cwd(), rel)), `${rel} 不存在`).toBe(true);
    }
  });

  it("不再保留单页 Tab 状态组件：旧学生页已删除，三个面板都有 layout", () => {
    expect(existsSync(join(process.cwd(), "src/app/dashboard/student/page.tsx"))).toBe(false);
    for (const rel of [
      "src/app/dashboard/admin/layout.tsx",
      "src/app/dashboard/teacher/layout.tsx",
      "src/app/dashboard/student/(panel)/layout.tsx",
    ]) {
      expect(existsSync(join(process.cwd(), rel)), `${rel} 不存在`).toBe(true);
    }
  });
});
