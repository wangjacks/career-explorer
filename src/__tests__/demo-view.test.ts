import { describe, it, expect } from "vitest";
import { isDemoSession, demoSwitchTargets } from "@/lib/demo-view";

describe("演示视图模型（#256）", () => {
  it("切换目标排除当前角色且顺序固定", () => {
    expect(demoSwitchTargets("student").map((t) => t.role)).toEqual(["admin", "teacher"]);
    expect(demoSwitchTargets("teacher").map((t) => t.role)).toEqual(["admin", "student"]);
    expect(demoSwitchTargets("admin").map((t) => t.role)).toEqual(["teacher", "student"]);
    expect(demoSwitchTargets("student").map((t) => t.label)).toEqual(["管理员", "教师"]);
    // 未知角色：三个都可切（防御）
    expect(demoSwitchTargets("weird")).toHaveLength(3);
  });

  it("isDemoSession 只认 demo === true", () => {
    expect(isDemoSession({ demo: true })).toBe(true);
    expect(isDemoSession({ demo: false })).toBe(false);
    expect(isDemoSession({})).toBe(false);
    expect(isDemoSession(null)).toBe(false);
    expect(isDemoSession(undefined)).toBe(false);
  });
});
