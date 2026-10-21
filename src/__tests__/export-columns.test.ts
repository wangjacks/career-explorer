import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_EXPORT_COLUMN_KEYS,
  EXPORT_COLUMNS,
  EXPORT_COLUMN_GROUPS,
  SCORE_COLUMN_KEYS,
  buildClassNameMap,
  classNameOf,
  columnLetter,
  formatAssessmentStatus,
  formatSixScores,
  formatTopCareers,
  imageColumnIndex,
  isAssessmentColumn,
  isImageColumn,
  parseColumnKeys,
  resolveExportColumns,
} from "../lib/export-columns";

describe("列定义与分组（#233）", () => {
  it("分两组且班级是基础组首位、测评列都在测评组", () => {
    expect(EXPORT_COLUMN_GROUPS.map((group) => group.label)).toEqual(["基础信息", "职业兴趣测评"]);

    const base = EXPORT_COLUMNS.filter((column) => column.group === "base").map((column) => column.key);
    expect(base[0]).toBe("class_name");
    expect(base).toEqual([
      "class_name",
      "student_id",
      "name",
      "tags",
      "avatar_url",
      "evaluation_url",
      "evaluation_text_1",
      "evaluation_text_2",
      "evaluation_text_3",
      "avatar_link",
      "evaluation_link",
      "created_at",
    ]);

    const assessment = EXPORT_COLUMNS.filter((column) => column.group === "assessment").map((column) => column.key);
    expect(assessment).toEqual([
      "assessment_status",
      "assessment_completed_at",
      "assessment_code",
      "assessment_scores",
      "score_R",
      "score_I",
      "score_A",
      "score_S",
      "score_E",
      "score_C",
      "careers",
    ]);
  });

  it("默认列集合在 #233 基线上增加三条他人评价（#162）", () => {
    expect(DEFAULT_EXPORT_COLUMN_KEYS).toEqual([
      "student_id",
      "name",
      "tags",
      "avatar_url",
      "evaluation_url",
      "evaluation_text_1",
      "evaluation_text_2",
      "evaluation_text_3",
      "created_at",
    ]);
  });

  it("列 key 唯一、宽度为正数", () => {
    const keys = EXPORT_COLUMNS.map((column) => column.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const column of EXPORT_COLUMNS) {
      expect(column.width).toBeGreaterThan(0);
      expect(column.label.trim()).not.toBe("");
    }
  });

  it("六型拆列 key 与 RIASEC 一一对应", () => {
    expect(SCORE_COLUMN_KEYS).toEqual(["score_R", "score_I", "score_A", "score_S", "score_E", "score_C"]);
    const defs = EXPORT_COLUMNS.filter((column) => column.scoreKey);
    expect(defs.map((column) => column.scoreKey)).toEqual(["R", "I", "A", "S", "E", "C"]);
  });

  it("分组判定：测评列 / 图片列", () => {
    expect(isAssessmentColumn("assessment_status")).toBe(true);
    expect(isAssessmentColumn("careers")).toBe(true);
    expect(isAssessmentColumn("class_name")).toBe(false);
    expect(isImageColumn("avatar_url")).toBe(true);
    expect(isImageColumn("evaluation_url")).toBe(true);
    expect(isImageColumn("evaluation_text_1")).toBe(false);
    expect(isImageColumn("avatar_link")).toBe(false);
  });
});

describe("列选择解析（parseColumnKeys / resolveExportColumns）", () => {
  it("按列定义顺序输出，未知 key 丢弃、重复去重", () => {
    expect(parseColumnKeys("name,class_name,student_id,bogus,class_name")).toEqual([
      "class_name",
      "student_id",
      "name",
    ]);
  });

  it("空参数 / null 返回空数组（由调用方决定是否回落默认列）", () => {
    expect(parseColumnKeys("")).toEqual([]);
    expect(parseColumnKeys(null)).toEqual([]);
    expect(parseColumnKeys(undefined)).toEqual([]);
  });

  it("表头按导出格式切换：图片列在 CSV 是 URL、在 Excel 是图片", () => {
    const csv = resolveExportColumns(["avatar_url", "evaluation_url"], "csv");
    expect(csv.map((column) => column.header)).toEqual(["学生头像URL", "评价词云图片URL（历史）"]);
    const xlsx = resolveExportColumns(["avatar_url", "evaluation_url"], "xlsx");
    expect(xlsx.map((column) => column.header)).toEqual(["学生头像", "评价词云图片（历史）"]);
  });

  it("三条他人评价列为普通文本列，CSV/Excel 表头一致", () => {
    const columns = resolveExportColumns(
      ["evaluation_text_1", "evaluation_text_2", "evaluation_text_3"],
      "csv"
    );
    expect(columns.map((column) => column.header)).toEqual(["他人评价1", "他人评价2", "他人评价3"]);
    expect(columns.every((column) => column.width > 0)).toBe(true);
  });

  it("普通列两种格式表头一致，且保留宽度", () => {
    const columns = resolveExportColumns(["class_name", "assessment_code"], "xlsx");
    expect(columns).toEqual([
      { key: "class_name", header: "班级", width: 18 },
      { key: "assessment_code", header: "霍兰德三字码", width: 14 },
    ]);
  });
});

describe("图片锚点（columnLetter / imageColumnIndex）", () => {
  it("列下标（1 起）→ Excel 列字母", () => {
    expect(columnLetter(1)).toBe("A");
    expect(columnLetter(2)).toBe("B");
    expect(columnLetter(26)).toBe("Z");
    expect(columnLetter(27)).toBe("AA");
    expect(columnLetter(52)).toBe("AZ");
    expect(columnLetter(53)).toBe("BA");
  });

  it("图片列下标随前插列变化（插入班级列后头像从第 1 列变第 2 列）", () => {
    expect(imageColumnIndex([{ key: "avatar_url" }, { key: "evaluation_url" }], "avatar_url")).toBe(1);
    expect(
      imageColumnIndex([{ key: "class_name" }, { key: "name" }, { key: "avatar_url" }], "avatar_url")
    ).toBe(3);
  });

  it("列不在最终列集里返回 0（调用方跳过锚点）", () => {
    expect(imageColumnIndex([{ key: "student_id" }], "avatar_url")).toBe(0);
    expect(imageColumnIndex([], "evaluation_url")).toBe(0);
  });
});

describe("班级名内存关联（buildClassNameMap / classNameOf）", () => {
  it("按 class_id 取班级名，未分班或班级被删时为空串", () => {
    const names = buildClassNameMap([
      { id: 1, name: "2025级1班" },
      { id: 2, name: "2025级2班" },
    ]);
    expect(classNameOf(1, names)).toBe("2025级1班");
    expect(classNameOf(null, names)).toBe("");
    expect(classNameOf(undefined, names)).toBe("");
    expect(classNameOf(99, names)).toBe("");
  });
});

describe("六型得分格式化（formatSixScores）", () => {
  const parsed = JSON.stringify([
    { key: "R", standard: 42.4 },
    { key: "I", standard: 38 },
    { key: "A", standard: 20 },
    { key: "S", standard: 74.6 },
    { key: "E", standard: 31 },
    { key: "C", standard: 25 },
  ]);

  it("合成一列：固定 RIASEC 顺序、取整、空格分隔", () => {
    const values = formatSixScores(parsed);
    expect(values.hasScores).toBe(true);
    expect(values.composite).toBe("R42 I38 A20 S75 E31 C25");
    expect(values.perDimension).toEqual({ R: "42", I: "38", A: "20", S: "75", E: "31", C: "25" });
  });

  it("越界钳制到 0–100；非 RIASEC 维度忽略", () => {
    const values = formatSixScores(
      JSON.stringify([
        { key: "R", standard: 150 },
        { key: "I", standard: -20 },
        { key: "O", standard: 88 },
      ])
    );
    expect(values.composite).toBe("R100 I0");
    expect(values.perDimension.A).toBe("");
  });

  it("缺失 / 空 / 非法 JSON 视为无分数（整格留空，不填 0）", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const input of [null, undefined, "", "not-json", "{}", "[]"]) {
      const values = formatSixScores(input);
      expect(values.hasScores).toBe(false);
      expect(values.composite).toBe("");
      expect(values.perDimension).toEqual({ R: "", I: "", A: "", S: "", E: "", C: "" });
    }
    // 非法 JSON 会留一条错误日志（禁止静默吞错），但导出继续
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("非数组或维度项损坏时按可用维度输出，不抛错", () => {
    const values = formatSixScores(JSON.stringify([{ key: "S", standard: Number.NaN }, "x", null]));
    expect(values.hasScores).toBe(false);
    expect(values.composite).toBe("");
  });
});

describe("测评状态与推荐职业（formatAssessmentStatus / formatTopCareers）", () => {
  it("有当前有效结果 → 已测，否则 → 未测", () => {
    expect(formatAssessmentStatus(true)).toBe("已测");
    expect(formatAssessmentStatus(false)).toBe("未测");
  });

  it("推荐职业：中文名优先、英文名兜底、默认 Top3、空项丢弃", () => {
    expect(
      formatTopCareers([
        { nameZh: "软件开发工程师", name: "Software Developers" },
        { nameZh: "", name: "Registered Nurses" },
        { name: "  ", nameZh: null },
        { nameZh: "注册护士", name: "Registered Nurses" },
        { nameZh: "电工", name: "Electricians" },
      ])
    ).toBe("软件开发工程师;Registered Nurses;注册护士");

    expect(formatTopCareers([])).toBe("");
    expect(formatTopCareers(null)).toBe("");
    expect(formatTopCareers([{ nameZh: "甲" }], 1)).toBe("甲");
  });
});
