import { describe, it, expect } from "vitest";
import { STUDENT_NAV_ITEMS, isStudentNavActive, type StudentNavItem } from "../lib/student-nav";

function item(key: string): StudentNavItem {
  const found = STUDENT_NAV_ITEMS.find((nav) => nav.key === key);
  expect(found, `导航里应有 ${key}`).toBeDefined();
  return found!;
}

describe("学生侧边栏导航数据（#222）", () => {
  it("四项：我的档案 / 职业测评 / 我的班级（占位）/ 成长记录（占位）", () => {
    expect(STUDENT_NAV_ITEMS.map((nav) => nav.label)).toEqual(["我的档案", "职业测评", "我的班级", "成长记录"]);
    expect(item("profile").href).toBe("/dashboard/student");
    expect(item("assessment").href).toBe("/dashboard/student/assessment");
    expect(item("class").soon).toBe(true);
    expect(item("growth").soon).toBe(true);
  });

  it("有地址的条目才可点击；占位项没有 href（不产生死链）", () => {
    for (const nav of STUDENT_NAV_ITEMS) {
      if (nav.soon) expect(nav.href).toBeUndefined();
      else expect(nav.href).toMatch(/^\/dashboard\/student/);
    }
  });
});

describe("isStudentNavActive", () => {
  it("我的档案只在自己那一页高亮（精确匹配，避免与职业测评同时点亮）", () => {
    expect(isStudentNavActive("/dashboard/student", item("profile"))).toBe(true);
    expect(isStudentNavActive("/dashboard/student/assessment", item("profile"))).toBe(false);
  });

  it("职业测评在测评中心与答题页都高亮（前缀匹配覆盖子路由）", () => {
    expect(isStudentNavActive("/dashboard/student/assessment", item("assessment"))).toBe(true);
    expect(isStudentNavActive("/dashboard/student/assessment/quiz", item("assessment"))).toBe(true);
    expect(isStudentNavActive("/dashboard/student", item("assessment"))).toBe(false);
  });

  it("前缀判定要求路径分段边界：相似前缀不误判", () => {
    expect(isStudentNavActive("/dashboard/student/assessment2", item("assessment"))).toBe(false);
    expect(isStudentNavActive("/dashboard/student/assessment/quiz/extra", item("assessment"))).toBe(true);
  });

  it("占位项永不 active，pathname 缺失也不高亮", () => {
    expect(isStudentNavActive("/dashboard/student", item("class"))).toBe(false);
    expect(isStudentNavActive("/dashboard/student", item("growth"))).toBe(false);
    expect(isStudentNavActive(null, item("profile"))).toBe(false);
    expect(isStudentNavActive(undefined, item("profile"))).toBe(false);
  });
});
