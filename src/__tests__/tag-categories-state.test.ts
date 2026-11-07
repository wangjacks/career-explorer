import { describe, it, expect } from "vitest";
import {
  nextTagCategoriesState,
  type TagCategoriesEvent,
  type TagCategoriesState,
} from "@/lib/tag-categories-state";

describe("nextTagCategoriesState（#261 标签目录加载状态）", () => {
  it("首次加载成功（包括返回空数组）→ ready", () => {
    expect(nextTagCategoriesState("loading", "success")).toBe("ready");
  });

  it("首次加载失败 → failed", () => {
    expect(nextTagCategoriesState("loading", "failure")).toBe("failed");
  });

  it("失败后重试 → loading，成功 → ready", () => {
    const retrying = nextTagCategoriesState("failed", "start");
    expect(retrying).toBe("loading");
    expect(nextTagCategoriesState(retrying, "success")).toBe("ready");
  });

  it("ready 不因数组为空回退 loading：成功与后台刷新开始都保持 ready", () => {
    expect(nextTagCategoriesState("ready", "success")).toBe("ready");
    expect(nextTagCategoriesState("ready", "start")).toBe("ready");
  });

  it("已 ready 后后台刷新失败不撤掉可用选择器", () => {
    expect(nextTagCategoriesState("ready", "failure")).toBe("ready");
  });

  const CASES: [TagCategoriesState, TagCategoriesEvent, TagCategoriesState][] = [
    ["loading", "start", "loading"],
    ["loading", "success", "ready"],
    ["loading", "failure", "failed"],
    ["ready", "start", "ready"],
    ["ready", "success", "ready"],
    ["ready", "failure", "ready"],
    ["failed", "start", "loading"],
    ["failed", "success", "ready"],
    ["failed", "failure", "failed"],
  ];

  it.each(CASES)("%s + %s → %s", (current, event, expected) => {
    expect(nextTagCategoriesState(current, event)).toBe(expected);
  });
});
