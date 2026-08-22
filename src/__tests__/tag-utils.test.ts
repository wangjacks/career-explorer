import { describe, it, expect } from "vitest";
import { normalizeTagNames, extractCustomTags } from "@/lib/tag-utils";
import type { TagRow } from "@/lib/db";

const PRESET_TAGS: TagRow[] = [
  { id: 1, name: "兴趣", type: "category", parent_id: null, class_id: 0, category_order: 0, sort_order: 0, active: 1 },
  { id: 2, name: "阅读", type: "tag", parent_id: 1, class_id: 0, category_order: 0, sort_order: 0, active: 1 },
  { id: 3, name: "编程", type: "tag", parent_id: 1, class_id: 0, category_order: 0, sort_order: 1, active: 1 },
];

describe("normalizeTagNames（#94 文本直存入库前规范化）", () => {
  it("转字符串 + trim + 去空 + 去重", () => {
    expect(normalizeTagNames([" 阅读 ", "阅读", "", "  ", "编程", 123])).toEqual(["阅读", "编程", "123"]);
  });

  it("全无效输入返回空数组", () => {
    expect(normalizeTagNames(["", "  ", null, undefined])).toEqual([]);
  });
});

describe("extractCustomTags（自定义标签提取，用于上限校验）", () => {
  it("预设标签不计入自定义", () => {
    expect(extractCustomTags(["阅读", "编程"], PRESET_TAGS)).toEqual([]);
  });

  it("不在预设内的名称视为自定义", () => {
    expect(extractCustomTags(["阅读", "摄影", "自定义爱好"], PRESET_TAGS)).toEqual(["摄影", "自定义爱好"]);
  });

  it("分类名本身不算预设标签（仅二级标签参与匹配）", () => {
    expect(extractCustomTags(["兴趣"], PRESET_TAGS)).toEqual(["兴趣"]);
  });
});
