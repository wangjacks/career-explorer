import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_LABELS, roleLabel } from "@/lib/role-labels";

describe("role-labels（#329）", () => {
  it("角色中文标签只有三个键且文案不变", () => {
    expect(ROLE_LABELS).toEqual({ admin: "管理员", teacher: "教师", student: "学生" });
  });

  it("roleLabel 返回三个已知角色的标签", () => {
    expect(roleLabel("admin")).toBe("管理员");
    expect(roleLabel("teacher")).toBe("教师");
    expect(roleLabel("student")).toBe("学生");
  });

  it("未知或缺失角色返回 undefined，由调用方保留原值", () => {
    expect(roleLabel("guardian")).toBeUndefined();
    expect(roleLabel("Admin")).toBeUndefined();
    expect(roleLabel("")).toBeUndefined();
    expect(roleLabel(null)).toBeUndefined();
    expect(roleLabel(undefined)).toBeUndefined();
  });

  describe("单一来源守卫", () => {
    const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
    const SOURCES = [
      "src/lib/demo-view.ts",
      "src/components/UserMenu.tsx",
      "src/components/admin/AuditLogsTab.tsx",
      "src/components/DemoBanner.tsx",
      "src/components/admin/DemoTab.tsx",
      "src/lib/demo-admin.ts",
    ];

    it("调用点都从 role-labels 取值，不再各自定义", () => {
      for (const file of SOURCES) {
        const source = read(file);
        expect(source).toContain("role-labels");
        // 定义形如 `const ROLE_LABEL... = {`；import/取值不会命中
        expect(source).not.toMatch(/ROLE_LABELS?\s*(?::\s*[^=]+)?=\s*\{/);
      }
    });

    it("定义只存在于 role-labels 一处", () => {
      const source = read("src/lib/role-labels.ts");
      expect(source.match(/export const ROLE_LABELS/g) ?? []).toHaveLength(1);
    });
  });
});
