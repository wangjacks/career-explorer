import { describe, it, expect } from "vitest";
import { sanitizeMetadata, stripSensitiveKeys, truncateError } from "@/lib/audit";

describe("stripSensitiveKeys（#110 敏感键递归剔除）", () => {
  it("顶层敏感键被剔除", () => {
    const result = stripSensitiveKeys({ password: "123", token: "abc", name: "张三" }) as Record<string, unknown>;
    expect(result.password).toBeUndefined();
    expect(result.token).toBeUndefined();
    expect(result.name).toBe("张三");
  });

  it("嵌套对象与数组内的敏感键同样剔除", () => {
    const result = stripSensitiveKeys({
      user: { auth_token: "x", age: 20 },
      list: [{ secret: "y", ok: 1 }],
    }) as { user: Record<string, unknown>; list: Record<string, unknown>[] };
    expect(result.user.auth_token).toBeUndefined();
    expect(result.user.age).toBe(20);
    expect(result.list[0].secret).toBeUndefined();
    expect(result.list[0].ok).toBe(1);
  });

  it("键名大小写不敏感", () => {
    const result = stripSensitiveKeys({ Password: "1", Cookie: "2" }) as Record<string, unknown>;
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("原始值直接返回", () => {
    expect(stripSensitiveKeys("text")).toBe("text");
    expect(stripSensitiveKeys(42)).toBe(42);
    expect(stripSensitiveKeys(null)).toBe(null);
  });
});

describe("sanitizeMetadata（脱敏 + 序列化 + 截断）", () => {
  it("敏感键不落库，其余字段保留", () => {
    const json = sanitizeMetadata({ password_hash: "$2b$...", ids: [1, 2] });
    expect(json).not.toContain("password_hash");
    expect(json).toContain("[1,2]");
  });

  it("超长内容截断到 2000 字符", () => {
    const json = sanitizeMetadata({ data: "a".repeat(5000) });
    expect(json).not.toBeNull();
    expect(json!.length).toBe(2000);
  });

  it("null/undefined 返回 null", () => {
    expect(sanitizeMetadata(null)).toBeNull();
    expect(sanitizeMetadata(undefined)).toBeNull();
  });
});

describe("truncateError（错误信息截断）", () => {
  it("超过 200 字符截断", () => {
    expect(truncateError("x".repeat(300))!.length).toBe(200);
  });

  it("空值返回 null", () => {
    expect(truncateError(null)).toBeNull();
    expect(truncateError("")).toBeNull();
    expect(truncateError(undefined)).toBeNull();
  });
});
