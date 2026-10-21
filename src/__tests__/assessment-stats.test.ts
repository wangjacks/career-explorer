import { describe, it, expect } from "vitest";
import type { AssessmentStatsRaw } from "../lib/db";
import {
  ASSESSMENT_CODES_TOP_N,
  completionRate,
  finalizeAssessmentStats,
} from "../lib/assessment-stats";

const DIMENSIONS = [
  { key: "R", label: "现实型" },
  { key: "I", label: "研究型" },
  { key: "A", label: "艺术型" },
  { key: "S", label: "社会型" },
  { key: "E", label: "企业型" },
  { key: "C", label: "常规型" },
];

function raw(overrides: Partial<AssessmentStatsRaw> = {}): AssessmentStatsRaw {
  return {
    classes: [],
    types: [],
    classTypes: [],
    codes: [],
    total: { enrolled: 0, assessed: 0, last_completed_at: null },
    ...overrides,
  };
}

describe("completionRate", () => {
  it("按百分比返回一位小数，分母为 0 记 0", () => {
    expect(completionRate(0, 0)).toBe(0);
    expect(completionRate(1, 3)).toBe(33.3);
    expect(completionRate(2, 3)).toBe(66.7);
    expect(completionRate(4, 4)).toBe(100);
  });

  it("脏数据（assessed > enrolled）钳到 100 以内，负数归 0", () => {
    expect(completionRate(5, 4)).toBe(100);
    expect(completionRate(-1, 4)).toBe(0);
    expect(completionRate(Number.NaN, 4)).toBe(0);
  });
});

describe("finalizeAssessmentStats", () => {
  it("班级完成度：未测评学生计入分母，按班名升序（不依赖库排序）", () => {
    const stats = finalizeAssessmentStats(
      raw({
        classes: [
          { class_id: 9, name: "B班", enrolled: 2, assessed: 0 },
          { class_id: 7, name: "A班", enrolled: 5, assessed: 4 },
        ],
      }),
      DIMENSIONS
    );
    expect(stats.classes).toEqual([
      { classId: 7, name: "A班", enrolled: 5, assessed: 4, rate: 80 },
      { classId: 9, name: "B班", enrolled: 2, assessed: 0, rate: 0 },
    ]);
  });

  it("同名班级按 classId 稳定排序；assessed 超过 enrolled 被钳住", () => {
    const stats = finalizeAssessmentStats(
      raw({
        classes: [
          { class_id: 12, name: "同名班", enrolled: 2, assessed: 5 },
          { class_id: 8, name: "同名班", enrolled: 0, assessed: 0 },
        ],
      }),
      DIMENSIONS
    );
    expect(stats.classes.map((c) => c.classId)).toEqual([8, 12]);
    expect(stats.classes[1]).toMatchObject({ enrolled: 2, assessed: 2, rate: 100 });
    expect(stats.classes[0].rate).toBe(0);
  });

  it("六型按量表维度顺序输出、缺失补 0，非 RIASEC 键被忽略", () => {
    const stats = finalizeAssessmentStats(
      raw({
        types: [
          { key: "S", count: 4 },
          { key: "R", count: 2 },
          { key: "X", count: 99 },
        ],
      }),
      DIMENSIONS
    );
    expect(stats.types.map((t) => t.key)).toEqual(["R", "I", "A", "S", "E", "C"]);
    expect(stats.types.map((t) => t.count)).toEqual([2, 0, 0, 4, 0, 0]);
    expect(stats.types.every((t) => t.label.length > 0)).toBe(true);
  });

  it("班级六型构成：按班名与 classId 稳定排序，六型补齐 0", () => {
    const stats = finalizeAssessmentStats(
      raw({
        classes: [
          { class_id: 12, name: "B班", enrolled: 2, assessed: 1 },
          { class_id: 8, name: "A班", enrolled: 0, assessed: 0 },
          { class_id: 3, name: "A班", enrolled: 4, assessed: 2 },
        ],
        classTypes: [
          { class_id: 12, key: "S", count: 1 },
          { class_id: 3, key: "R", count: 2 },
          { class_id: 3, key: "X", count: 99 },
        ],
      }),
      DIMENSIONS
    );

    expect(stats.byClass.map((row) => row.classId)).toEqual([3, 8, 12]);
    expect(stats.byClass[0]).toEqual({
      classId: 3,
      name: "A班",
      assessed: 2,
      types: [
        { key: "R", count: 2 },
        { key: "I", count: 0 },
        { key: "A", count: 0 },
        { key: "S", count: 0 },
        { key: "E", count: 0 },
        { key: "C", count: 0 },
      ],
    });
    expect(stats.byClass[1].types.every((item) => item.count === 0)).toBe(true);
    expect(stats.byClass[2].types.find((item) => item.key === "S")?.count).toBe(1);
  });

  it("三字码排行：count 降序、同数按 code 升序，附首位类型中文标记", () => {
    const stats = finalizeAssessmentStats(
      raw({
        codes: [
          { code: "SIA", count: 2 },
          { code: "RIC", count: 1 },
          { code: "ASE", count: 2 },
          { code: "  ", count: 9 },
        ],
      }),
      DIMENSIONS
    );
    expect(stats.codes.map((c) => c.code)).toEqual(["ASE", "SIA", "RIC"]);
    expect(stats.codes[0]).toMatchObject({ count: 2, lead: "A", leadLabel: "艺术型" });
    expect(stats.codes[2]).toMatchObject({ count: 1, lead: "R", leadLabel: "现实型" });
  });

  it("三字码默认只取前 10 名（Top-N 可调），总数与完成率单列", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      code: `R${String.fromCharCode(65 + i)}C`,
      count: 14 - i,
    }));
    const defaultTop = finalizeAssessmentStats(raw({ codes: many }), DIMENSIONS);
    expect(defaultTop.codes).toHaveLength(ASSESSMENT_CODES_TOP_N);
    expect(defaultTop.codes[0].code).toBe("RAC");

    const top3 = finalizeAssessmentStats(
      raw({
        codes: many,
        total: { enrolled: 20, assessed: 6, last_completed_at: "2026-10-19 10:00:00" },
      }),
      DIMENSIONS,
      { topN: 3 }
    );
    expect(top3.codes).toHaveLength(3);
    expect(top3.total).toEqual({
      enrolled: 20,
      assessed: 6,
      rate: 30,
      lastSubmittedAt: "2026-10-19 10:00:00",
    });
  });

  it("总计数：assessed 钳到 enrolled 以内；空串/空白完成时间视为没有时间", () => {
    const stats = finalizeAssessmentStats(
      raw({ total: { enrolled: 3, assessed: 9, last_completed_at: "  " } }),
      DIMENSIONS
    );
    expect(stats.total).toEqual({ enrolled: 3, assessed: 3, rate: 100, lastSubmittedAt: null });
    expect(
      finalizeAssessmentStats(raw({ total: { enrolled: 0, assessed: 0, last_completed_at: "" } }), DIMENSIONS).total
        .lastSubmittedAt
    ).toBeNull();
  });

  it("空数据也能渲染：六型齐全、班级/三字码为空数组", () => {
    const stats = finalizeAssessmentStats(raw(), DIMENSIONS);
    expect(stats.classes).toEqual([]);
    expect(stats.byClass).toEqual([]);
    expect(stats.codes).toEqual([]);
    expect(stats.types).toHaveLength(6);
    expect(stats.total).toEqual({ enrolled: 0, assessed: 0, rate: 0, lastSubmittedAt: null });
  });
});
