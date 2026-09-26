import { describe, it, expect } from "vitest";
import {
  normalizeTagNames,
  extractCustomTags,
  summarizeSelection,
  toggleCategorySelection,
  toggleTagSelection,
  previewTagImport,
  buildTagExportRows,
} from "@/lib/tag-utils";
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

describe("summarizeSelection（#163 已选统计）", () => {
  it("分别统计分类与二级标签，并给出实际影响行数", () => {
    expect(summarizeSelection(new Set([1, 2, 3]), PRESET_TAGS)).toEqual({
      categories: 1,
      tags: 2,
      affected: 3,
    });
  });

  it("已不存在的 id 不计入影响行数（避免计数虚高）", () => {
    expect(summarizeSelection(new Set([1, 999]), PRESET_TAGS)).toEqual({
      categories: 1,
      tags: 0,
      affected: 1,
    });
  });
});

describe("toggleCategorySelection（#163 分类级联选择）", () => {
  it("勾选分类时级联包含其下全部二级标签", () => {
    expect(Array.from(toggleCategorySelection(new Set(), 1, [2, 3])).sort()).toEqual([1, 2, 3]);
  });

  it("分类与其下标签全选中时，再次点击全部取消", () => {
    expect(Array.from(toggleCategorySelection(new Set([1, 2, 3]), 1, [2, 3]))).toEqual([]);
  });

  it("部分选中（仅有子标签）时点击分类补齐为全选", () => {
    expect(Array.from(toggleCategorySelection(new Set([2]), 1, [2, 3])).sort()).toEqual([1, 2, 3]);
  });
});

describe("toggleTagSelection（#163 二级标签选择）", () => {
  it("勾选二级标签", () => {
    expect(Array.from(toggleTagSelection(new Set(), 2, 1))).toEqual([2]);
  });

  it("取消子标签时同时取消其父分类，保证选中集合等于删除范围", () => {
    expect(Array.from(toggleTagSelection(new Set([1, 2, 3]), 2, 1)).sort()).toEqual([3]);
  });

  it("取消无父分类的项不受影响", () => {
    expect(Array.from(toggleTagSelection(new Set([5]), 5, null))).toEqual([]);
  });
});

describe("previewTagImport（#163 导入影响面预览）", () => {
  it("已存在分类 + 新标签 → 计入导入，且不标记新建分类", () => {
    const preview = previewTagImport([{ category: "兴趣", name: "摄影" }], PRESET_TAGS);
    expect(preview.importCount).toBe(1);
    expect(preview.skipCount).toBe(0);
    expect(preview.newCategoryCount).toBe(0);
    expect(preview.rows[0]).toEqual({
      category: "兴趣",
      name: "摄影",
      createsCategory: false,
      skips: false,
    });
  });

  it("「分类 + 标签名」已存在 → 标记跳过", () => {
    const preview = previewTagImport([{ category: "兴趣", name: "阅读" }], PRESET_TAGS);
    expect(preview.importCount).toBe(0);
    expect(preview.skipCount).toBe(1);
    expect(preview.rows[0].skips).toBe(true);
  });

  it("不存在的分类 → 标记将新建，且同名分类在批次内只计一次", () => {
    const preview = previewTagImport(
      [
        { category: "运动", name: "篮球" },
        { category: "运动", name: "足球" },
      ],
      PRESET_TAGS
    );
    expect(preview.newCategoryCount).toBe(1);
    expect(preview.importCount).toBe(2);
    expect(preview.rows.map((row) => row.createsCategory)).toEqual([true, false]);
  });

  it("批次内重复条目 → 第二条跳过", () => {
    const preview = previewTagImport(
      [
        { category: "运动", name: "篮球" },
        { category: "运动", name: "篮球" },
      ],
      PRESET_TAGS
    );
    expect(preview.importCount).toBe(1);
    expect(preview.skipCount).toBe(1);
  });
});

describe("buildTagExportRows（#163 导出数据）", () => {
  const withOrder = [
    { id: 1, name: "兴趣", type: "category" as const, parent_id: null, category_order: 0, sort_order: 0 },
    { id: 3, name: "编程", type: "tag" as const, parent_id: 1, category_order: 0, sort_order: 1 },
    { id: 2, name: "阅读", type: "tag" as const, parent_id: 1, category_order: 0, sort_order: 0 },
    { id: 4, name: "空分类", type: "category" as const, parent_id: null, category_order: 1, sort_order: 0 },
  ];

  it("按分类/标签排序输出「分类,标签名」行，可直接回导", () => {
    expect(buildTagExportRows(withOrder).pairs).toEqual([
      ["兴趣", "阅读"],
      ["兴趣", "编程"],
    ]);
  });

  it("分类清单包含空分类（便于人工核对）", () => {
    expect(buildTagExportRows(withOrder).categories).toEqual([["兴趣"], ["空分类"]]);
  });
});
