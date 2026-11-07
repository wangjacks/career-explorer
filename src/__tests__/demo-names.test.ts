import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { pick, pickName, normalizeDemoName, DEMO_NAME_MAX } from "@/lib/demo-names";
import { mulberry32 } from "@/lib/demo-accounts";

describe("demo-names 客户端安全护栏（#369）", () => {
  const src = readFileSync(path.resolve("src/lib/demo-names.ts"), "utf8");
  it("零依赖：模块不含任何 import，绝不把 db/auth 带进客户端包", () => {
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/from\s+["']@\/lib\/(db|auth)["']/);
  });
});

describe("pickName", () => {
  it("同一种子确定输出", () => {
    expect(pickName(mulberry32(42))).toBe(pickName(mulberry32(42)));
  });
  it("长度 2~3 字（姓 1 + 名 1~2）", () => {
    for (let i = 0; i < 60; i++) {
      const name = pickName(mulberry32(i + 1));
      expect(name.length).toBeGreaterThanOrEqual(2);
      expect(name.length).toBeLessThanOrEqual(3);
    }
  });
  it("pick 命中数组内元素", () => {
    const arr = ["a", "b", "c"] as const;
    expect(arr).toContain(pick(arr, () => 0));
    expect(arr).toContain(pick(arr, () => 0.999));
  });
});

describe("normalizeDemoName", () => {
  it("trim 两端空白", () => {
    expect(normalizeDemoName("  演示访客  ")).toBe("演示访客");
  });
  it("内部空白/控制字符折叠为单空格", () => {
    expect(normalizeDemoName("张\n\t三")).toBe("张 三");
    expect(normalizeDemoName("a\u0000b")).toBe("a b");
  });
  it("仅空白 → 空串（按留空处理）", () => {
    expect(normalizeDemoName("   \t\n ")).toBe("");
  });
  it("undefined / 非字符串 → 空串", () => {
    expect(normalizeDemoName()).toBe("");
    expect(normalizeDemoName(undefined)).toBe("");
  });
});

describe("DEMO_NAME_MAX", () => {
  it("对齐 MySQL users.name VARCHAR(50)", () => {
    expect(DEMO_NAME_MAX).toBe(50);
  });
});
