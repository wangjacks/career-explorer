import { describe, it, expect } from "vitest";
import {
  STUDENT_NAV_ITEMS,
  STUDENT_ROOT_PATH,
  isStudentNavActive,
  studentActiveKey,
  type StudentNavItem,
} from "../lib/student-nav";

function item(key: string): StudentNavItem {
  const found = STUDENT_NAV_ITEMS.find((nav) => nav.key === key);
  expect(found, `导航里应有 ${key}`).toBeDefined();
  return found!;
}

describe("学生侧边栏导航数据（#222 / #101 / #361）", () => {
  it("五项：我的档案 / 我的小组 / 职业测评 / 我的班级（占位）/ 成长记录（占位）", () => {
    expect(STUDENT_NAV_ITEMS.map((nav) => nav.label)).toEqual([
      "我的档案",
      "我的小组",
      "职业测评",
      "我的班级",
      "成长记录",
    ]);
    expect(item("profile").href).toBe("/dashboard/student");
    expect(item("group").href).toBe("/dashboard/student/group");
    expect(item("assessment").href).toBe("/dashboard/student/assessment");
    expect(item("class").soon).toBe(true);
    expect(item("growth").soon).toBe(true);
  });

  it("已上线条目都有面板内路由；占位项没有 href（不产生死链）", () => {
    for (const nav of STUDENT_NAV_ITEMS) {
      if (nav.soon) {
        expect(nav.href).toBeUndefined();
      } else {
        expect(nav.href).toMatch(/^\/dashboard\/student/);
      }
    }
  });

  it("根路径与历史提交都算「我的档案」，路由边界不误判", () => {
    expect(studentActiveKey(STUDENT_ROOT_PATH)).toBe("profile");
    expect(studentActiveKey(`${STUDENT_ROOT_PATH}/history`)).toBe("profile");
    expect(studentActiveKey(`${STUDENT_ROOT_PATH}/history/`)).toBe("profile");
    expect(studentActiveKey(`${STUDENT_ROOT_PATH}/group`)).toBe("group");
    expect(studentActiveKey(`${STUDENT_ROOT_PATH}/group/x`)).toBe("group");
    expect(studentActiveKey(`${STUDENT_ROOT_PATH}/assessment`)).toBe("assessment");
    expect(studentActiveKey(`${STUDENT_ROOT_PATH}/assessment/quiz`)).toBe("assessment");
    expect(studentActiveKey(`${STUDENT_ROOT_PATH}/assessment2`)).toBe("profile");
    expect(studentActiveKey(null)).toBe("profile");
  });
});

describe("isStudentNavActive", () => {
  it("档案 / 小组 / 测评按当前路由高亮，历史提交仍高亮我的档案", () => {
    expect(isStudentNavActive("/dashboard/student", item("profile"))).toBe(true);
    expect(isStudentNavActive("/dashboard/student/history", item("profile"))).toBe(true);
    expect(isStudentNavActive("/dashboard/student/group", item("group"))).toBe(true);
    expect(isStudentNavActive("/dashboard/student/assessment", item("assessment"))).toBe(true);
    expect(isStudentNavActive("/dashboard/student/assessment/quiz", item("assessment"))).toBe(true);
    expect(isStudentNavActive("/dashboard/student", item("group"))).toBe(false);
    expect(isStudentNavActive("/dashboard/student/group", item("profile"))).toBe(false);
    expect(isStudentNavActive("/dashboard/student", item("assessment"))).toBe(false);
  });

  it("占位项永不 active，pathname 缺失也不高亮", () => {
    expect(isStudentNavActive("/dashboard/student", item("class"))).toBe(false);
    expect(isStudentNavActive("/dashboard/student", item("growth"))).toBe(false);
    expect(isStudentNavActive(null, item("profile"))).toBe(false);
    expect(isStudentNavActive(undefined, item("assessment"))).toBe(false);
  });
});
