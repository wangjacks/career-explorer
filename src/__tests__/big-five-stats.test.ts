import { describe, expect, it } from "vitest";
import { IPIP_DIMENSIONS } from "@/lib/assessment-data";
import type { DimensionalResultScoreRow } from "@/lib/db";
import { parseDimensionalBands } from "@/lib/big-five-stats";

const DIMS = IPIP_DIMENSIONS;

type Entry = { key: string; standard?: unknown; band?: unknown };

/** 五维齐全的快照；`overrides` 可改单维的分值/档位，或塞入额外维度 */
function snapshot(overrides: Record<string, Partial<Entry>> = {}): string {
  return JSON.stringify(
    DIMS.map(({ key }) => ({
      key,
      standard: 50,
      band: "medium",
      ...(overrides[key] ?? {}),
    }))
  );
}

function row(
  user_id: number,
  scores_json: string | null,
  completed_at: string | null = "2026-10-18 15:42:00"
): DimensionalResultScoreRow {
  return { user_id, scores_json, completed_at };
}

function countOf(result: ReturnType<typeof parseDimensionalBands>, key: string) {
  const dimension = result.dimensions.find((item) => item.key === key);
  if (!dimension) throw new Error(`missing dimension ${key}`);
  return { low: dimension.low, medium: dimension.medium, high: dimension.high };
}

describe("parseDimensionalBands（#312 人格三档计数）", () => {
  it("三档计数直接读快照里的 band，维度顺序恒为量表定义顺序", () => {
    const rows = [
      row(
        1,
        snapshot({
          N: { band: "high" },
          E: { band: "low" },
          O: { band: "medium" },
          A: { band: "high" },
          C: { band: "low" },
        })
      ),
      row(2, snapshot({ N: { band: "low" } })),
    ];
    const result = parseDimensionalBands(rows, DIMS);

    expect(result.dimensions.map((item) => item.key)).toEqual(["N", "E", "O", "A", "C"]);
    expect(result.dimensions.map((item) => item.label)).toEqual([
      "神经质",
      "外向性",
      "开放性",
      "宜人性",
      "尽责性",
    ]);
    expect(countOf(result, "N")).toEqual({ low: 1, medium: 0, high: 1 });
    expect(countOf(result, "E")).toEqual({ low: 1, medium: 1, high: 0 });
    expect(countOf(result, "A")).toEqual({ low: 0, medium: 1, high: 1 });
    expect(result.invalidCount).toBe(0);
    expect(result.lastSubmittedAt).toBe("2026-10-18 15:42:00");
  });

  it("缺 band 时用 bandOf(standard) 兜底，阈值 66.7 / 33.3 与计分引擎一致", () => {
    const rows = [
      row(1, snapshot({ N: { band: undefined, standard: 66.7 } })),
      row(2, snapshot({ N: { band: undefined, standard: 33.3 } })),
      row(3, snapshot({ N: { band: undefined, standard: 33.2 } })),
    ];
    const result = parseDimensionalBands(rows, DIMS);
    expect(countOf(result, "N")).toEqual({ low: 1, medium: 1, high: 1 });
  });

  it("脏数据只计入 invalidCount，不影响其余记录", () => {
    const rows = [
      row(1, snapshot({ N: { band: "high" } })),
      row(2, "{not json"),
      row(3, JSON.stringify([{ key: "N", standard: null }])),
      row(4, JSON.stringify([{ key: "N", standard: "50" }])),
      row(5, JSON.stringify([{ key: "N", standard: 50 }])),
    ];
    const result = parseDimensionalBands(rows, DIMS);

    expect(result.invalidCount).toBe(4);
    expect(countOf(result, "N")).toEqual({ low: 0, medium: 0, high: 1 });
    // 守恒：low + medium + high = 已测 - invalidCount
    for (const dimension of result.dimensions) {
      expect(dimension.low + dimension.medium + dimension.high).toBe(rows.length - result.invalidCount);
    }
  });

  it("缺维度/非数组快照整行判脏，不让分布只加一部分", () => {
    const rows = [
      row(1, snapshot()),
      row(2, "[]"),
      row(3, JSON.stringify([DIMS[0], DIMS[1]].map(({ key }) => ({ key, standard: 50 })))),
    ];
    const result = parseDimensionalBands(rows, DIMS);

    expect(result.invalidCount).toBe(2);
    expect(countOf(result, "N")).toEqual({ low: 0, medium: 1, high: 0 });
    expect(countOf(result, "E")).toEqual({ low: 0, medium: 1, high: 0 });
  });

  it("同一学生多条当前记录只认完成时间最新的一条", () => {
    const rows = [
      row(1, "{bad", "2026-10-18 09:00:00"),
      row(1, snapshot({ N: { band: "high" } }), "2026-10-18 10:00:00"),
      row(2, snapshot({ N: { band: "low" } }), "2026-10-17 08:00:00"),
    ];
    const result = parseDimensionalBands(rows, DIMS);

    expect(result.invalidCount).toBe(0);
    expect(countOf(result, "N")).toEqual({ low: 1, medium: 0, high: 1 });
    expect(result.lastSubmittedAt).toBe("2026-10-18 10:00:00");
  });

  it("空输入与空维度定义都不抛错；没有维度定义时所有行计为 invalid", () => {
    expect(parseDimensionalBands([], DIMS)).toEqual({
      dimensions: DIMS.map((dimension) => ({ ...dimension, low: 0, medium: 0, high: 0 })),
      invalidCount: 0,
      lastSubmittedAt: null,
    });
    const empty = parseDimensionalBands([row(1, snapshot(), null)], []);
    expect(empty.dimensions).toEqual([]);
    expect(empty.invalidCount).toBe(1);
    expect(empty.lastSubmittedAt).toBeNull();
  });

  it("scores_json 为 null / 空白时间 / 非数组对象都按脏数据处理", () => {
    const rows = [
      row(1, null, "  "),
      row(2, JSON.stringify({ N: 50 }), ""),
      row(3, snapshot(), "2026-10-18 12:00:00"),
    ];
    const result = parseDimensionalBands(rows, DIMS);
    expect(result.invalidCount).toBe(2);
    expect(result.lastSubmittedAt).toBe("2026-10-18 12:00:00");
  });

  it("重复的维度定义只计一次，顺序保持首次出现位置", () => {
    const duplicated = [...DIMS, { key: "N", label: "重复的神经质" }];
    const result = parseDimensionalBands([row(1, snapshot({ N: { band: "high" } }))], duplicated);
    expect(result.dimensions.map((item) => item.key)).toEqual(["N", "E", "O", "A", "C"]);
    expect(result.dimensions[0]).toEqual({ key: "N", label: "神经质", low: 0, medium: 0, high: 1 });
  });

  it("输出不含任何个人分数（raw / standard）", () => {
    const result = parseDimensionalBands([row(1, snapshot({ N: { standard: 88, band: "high" } }))], DIMS);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("standard");
    expect(serialized).not.toContain("raw");
    expect(serialized).not.toContain("user_id");
  });
});
