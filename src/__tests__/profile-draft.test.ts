import { describe, it, expect } from "vitest";
import {
  hasMeaningfulDraft,
  parseJsonOrNull,
  toggleTag,
  type DraftMeta,
} from "@/lib/profile-draft";

describe("parseJsonOrNull（草稿 JSON 容错解析）", () => {
  it("合法 JSON 正常解析", () => {
    expect(parseJsonOrNull<string[]>('["阅读","编程"]')).toEqual(["阅读", "编程"]);
  });

  it("空值返回 null", () => {
    expect(parseJsonOrNull(null)).toBeNull();
    expect(parseJsonOrNull("")).toBeNull();
  });

  it("损坏 JSON 返回 null 不抛错", () => {
    expect(parseJsonOrNull("{broken")).toBeNull();
  });
});

describe("hasMeaningfulDraft（草稿存在性判定）", () => {
  it("无标签且无图片元数据 → 无草稿", () => {
    expect(hasMeaningfulDraft([], null)).toBe(false);
    expect(hasMeaningfulDraft([], {})).toBe(false);
  });

  it("有标签 → 有草稿", () => {
    expect(hasMeaningfulDraft(["阅读"], null)).toBe(true);
  });

  it("仅图片元数据 → 有草稿（刷新后 File 丢失但元数据仍在）", () => {
    const meta: DraftMeta = { evaluation: true };
    expect(hasMeaningfulDraft([], meta)).toBe(true);
    expect(hasMeaningfulDraft([], { avatar: true })).toBe(true);
  });
});

describe("toggleTag（标签切换）", () => {
  it("未选则勾选，已选则取消", () => {
    const once = toggleTag([], "阅读");
    expect(once).toEqual(["阅读"]);
    expect(toggleTag(once, "阅读")).toEqual([]);
  });

  it("不改动其他已选标签", () => {
    expect(toggleTag(["阅读", "编程"], "认真")).toEqual(["阅读", "编程", "认真"]);
  });
});
