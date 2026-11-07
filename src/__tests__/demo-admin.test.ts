import { describe, it, expect } from "vitest";
import {
  DEMO_HIDDEN_TAB_KEYS,
  DEMO_STATUS_CARDS,
  demoCreateAccountBody,
  demoCredentialCopyText,
  demoCredentialRows,
  isDemoHiddenTab,
} from "@/lib/demo-admin";

const CODES = { admin: "900001001", teacher: "99001001", student: "900010000001" };

describe("demoCreateAccountBody（#258 密码 + #369 名称）", () => {
  it("密码与名称均留空 → 请求体不带 password / name 键", () => {
    const result = demoCreateAccountBody({ rawName: "", rawPassword: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual({});
      expect("password" in result.body).toBe(false);
      expect("name" in result.body).toBe(false);
    }
  });

  it("少于 8 位密码拒绝，与后端同口径", () => {
    expect(demoCreateAccountBody({ rawName: "", rawPassword: "1234567" })).toEqual({
      ok: false,
      error: "密码须至少 8 位",
    });
  });

  it("8 位及以上密码原样传递，不 trim", () => {
    expect(demoCreateAccountBody({ rawName: "", rawPassword: "12345678" })).toEqual({
      ok: true,
      body: { password: "12345678" },
    });
    expect(demoCreateAccountBody({ rawName: "", rawPassword: " 1234567 " })).toEqual({
      ok: true,
      body: { password: " 1234567 " },
    });
  });

  it("名称归一(trim)后发送，与后端同口径", () => {
    expect(demoCreateAccountBody({ rawName: "  演示访客  ", rawPassword: "" })).toEqual({
      ok: true,
      body: { name: "演示访客" },
    });
  });

  it("仅空白的名称按留空处理，省略 name 键", () => {
    const result = demoCreateAccountBody({ rawName: "   \t ", rawPassword: "" });
    expect(result.ok).toBe(true);
    if (result.ok) expect("name" in result.body).toBe(false);
  });

  it("内部换行/制表折叠为单空格，避免破坏凭据复制文本", () => {
    expect(demoCreateAccountBody({ rawName: "张\n\t三", rawPassword: "" })).toEqual({
      ok: true,
      body: { name: "张 三" },
    });
  });

  it("超过 50 字的名称拒绝，与后端同口径", () => {
    expect(demoCreateAccountBody({ rawName: "名".repeat(51), rawPassword: "" })).toEqual({
      ok: false,
      error: "名称须为 1-50 字",
    });
  });

  it("名称与密码同时给出", () => {
    expect(demoCreateAccountBody({ rawName: "演示访客", rawPassword: "abcdefgh" })).toEqual({
      ok: true,
      body: { name: "演示访客", password: "abcdefgh" },
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
