import { describe, it, expect } from "vitest";
import {
  DEMO_HIDDEN_TAB_KEYS,
  DEMO_STATUS_CARDS,
  demoCreatePasswordBody,
  demoCredentialCopyText,
  demoCredentialRows,
  isDemoHiddenTab,
} from "@/lib/demo-admin";

const CODES = { admin: "900001001", teacher: "99001001", student: "900010000001" };

describe("demoCreatePasswordBody（#258）", () => {
  it("留空表示服务端生成，请求体必须不带 password 键", () => {
    const result = demoCreatePasswordBody("");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual({});
      expect("password" in result.body).toBe(false);
    }
  });

  it("少于 8 位拒绝，与后端同口径", () => {
    const result = demoCreatePasswordBody("1234567");
    expect(result).toEqual({ ok: false, error: "密码须至少 8 位" });
  });

  it("8 位及以上原样传递，不 trim", () => {
    expect(demoCreatePasswordBody("12345678")).toEqual({
      ok: true,
      body: { password: "12345678" },
    });
    expect(demoCreatePasswordBody(" 1234567 ")).toEqual({
      ok: true,
      body: { password: " 1234567 " },
    });
  });
});

describe("demoCredentialRows / demoCredentialCopyText（#258）", () => {
  it("按 管理员 → 教师 → 学生 → 密码 排列，姓名可选", () => {
    expect(demoCredentialRows({ codes: CODES, password: "pass1234" })).toEqual([
      { label: "管理员编号", value: CODES.admin },
      { label: "教师编号", value: CODES.teacher },
      { label: "学生编号", value: CODES.student },
      { label: "密码", value: "pass1234" },
    ]);
    expect(demoCredentialRows({ name: "演示访客", codes: CODES, password: "pass1234" })[0]).toEqual({
      label: "姓名",
      value: "演示访客",
    });
  });

  it("复制文本包含三个编号与密码，且与展示同序", () => {
    const text = demoCredentialCopyText({ name: "演示访客", codes: CODES, password: "pass1234" });
    expect(text.split("\n")).toEqual([
      "姓名：演示访客",
      `管理员编号：${CODES.admin}`,
      `教师编号：${CODES.teacher}`,
      `学生编号：${CODES.student}`,
      "密码：pass1234",
    ]);
  });

  it("无姓名时不输出空姓名行", () => {
    expect(demoCredentialCopyText({ codes: CODES, password: "pass1234" })).not.toContain("姓名");
  });
});

describe("DEMO_STATUS_CARDS（#258）", () => {
  it("固定顺序与键名", () => {
    expect(DEMO_STATUS_CARDS.map((card) => card.key)).toEqual([
      "classes",
      "students",
      "teachers",
      "submittedProfiles",
      "demoFiles",
      "visitorAccounts",
    ]);
  });
});

describe("demo 会话隐藏 Tab（#258）", () => {
  it("完全无权的五个 Tab 隐藏", () => {
    expect([...DEMO_HIDDEN_TAB_KEYS]).toEqual([
      "demo",
      "settings",
      "teachers",
      "storage",
      "media",
    ]);
    for (const key of DEMO_HIDDEN_TAB_KEYS) expect(isDemoHiddenTab(key)).toBe(true);
  });

  it("只读可用的 Tab 不隐藏", () => {
    for (const key of [
      "overview",
      "screen",
      "students",
      "classes",
      "grouping",
      "export",
      "tags",
      "profile-config",
      "submissions",
      "audit-logs",
    ]) {
      expect(isDemoHiddenTab(key)).toBe(false);
    }
  });
});
