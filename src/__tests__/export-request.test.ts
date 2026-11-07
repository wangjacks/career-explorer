import { describe, it, expect } from "vitest";
import { EXPORT_COLUMNS } from "../lib/export-columns";
import {
  ROSTER_DEFAULT_COLUMN_KEYS,
  ROSTER_LOCKED_COLUMN_KEYS,
  ROSTER_MORE_COLUMN_CHOICES,
  ROSTER_PRIMARY_COLUMN_CHOICES,
  buildExportSearchParams,
  isChoiceSelected,
} from "../lib/export-request";

const ALL_KEYS = new Set(EXPORT_COLUMNS.map((column) => column.key));

describe("导出名单默认勾选（#331）", () => {
  it("姓名固定且默认包含；主列表列默认勾选，更多列默认不勾选", () => {
    expect(ROSTER_LOCKED_COLUMN_KEYS).toEqual(["name"]);
    expect(ROSTER_DEFAULT_COLUMN_KEYS).toContain("name");
    for (const choice of ROSTER_PRIMARY_COLUMN_CHOICES) {
      for (const key of choice.keys) expect(ROSTER_DEFAULT_COLUMN_KEYS).toContain(key);
    }
    for (const choice of ROSTER_MORE_COLUMN_CHOICES) {
      for (const key of choice.keys) expect(ROSTER_DEFAULT_COLUMN_KEYS).not.toContain(key);
    }
  });

  it("所有勾选项都指向真实导出列", () => {
    for (const choice of [...ROSTER_PRIMARY_COLUMN_CHOICES, ...ROSTER_MORE_COLUMN_CHOICES]) {
      expect(choice.label.trim()).not.toBe("");
      for (const key of choice.keys) expect(ALL_KEYS.has(key)).toBe(true);
    }
  });

  it("勾选判定按整组全部选中", () => {
    const choice = { label: "图片 URL", keys: ["avatar_link", "evaluation_link"] };
    expect(isChoiceSelected(choice, new Set(["avatar_link"]))).toBe(false);
    expect(isChoiceSelected(choice, new Set(["avatar_link", "evaluation_link"]))).toBe(true);
  });
});

describe("buildExportSearchParams（共享导出请求，#331）", () => {
  it("xlsx 带图片放置方式与行高，筛选参数原样下推且不包含排序/分页", () => {
    const params = buildExportSearchParams({
      format: "xlsx",
      columns: ["name", "personality_traits"],
      filters: {
        q: "张三",
        tags: ["运动", "阅读"],
        interest: { mode: "letters", keys: ["S", "A"] },
        sortKey: "studentName",
        sortDir: "asc",
      },
    });
    expect(params.get("format")).toBe("xlsx");
    expect(params.get("scope")).toBe("all");
    expect(params.get("columns")).toBe("name,personality_traits");
    expect(params.get("imagePlacement")).toBe("in-cell");
    expect(params.get("rowHeight")).toBe("45");
    expect(params.get("q")).toBe("张三");
    expect(params.getAll("tag")).toEqual(["运动", "阅读"]);
    expect(params.get("interest")).toBe("S,A");
    expect(params.has("sortKey")).toBe(false);
    expect(params.has("page")).toBe(false);
  });

  it("csv 不带图片放置参数；图片列由导出接口输出链接", () => {
    const params = buildExportSearchParams({
      format: "csv",
      columns: ["name", "avatar_url"],
      filters: { personality: { mode: "dimension", key: "C", dir: "high" } },
    });
    expect(params.has("imagePlacement")).toBe(false);
    expect(params.has("rowHeight")).toBe(false);
    expect(params.get("personality")).toBe("C:high");
  });

  it("按学号 / 按时间范围保留既有 scope 语义", () => {
    const byIds = buildExportSearchParams({
      format: "csv",
      columns: ["name"],
      scope: "byIds",
      ids: "S001,S002",
    });
    expect(byIds.get("scope")).toBe("byIds");
    expect(byIds.get("ids")).toBe("S001,S002");

    const date = buildExportSearchParams({
      format: "csv",
      columns: ["name"],
      scope: "date",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
    expect(date.get("dateFrom")).toBe("2026-01-01");
    expect(date.get("dateTo")).toBe("2026-01-31");
  });
});
