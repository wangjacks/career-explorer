import { describe, it, expect } from "vitest";
import {
  ALPHA_ACCEPTABLE,
  ALPHA_GOOD,
  BAND_LABELS,
  CITC_MIN,
  NORM_MIN_SAMPLE,
  NORM_PERCENTILES,
  NORM_RECOMMENDED_SAMPLE,
  RETEST_ACCEPTABLE,
  bandOf,
  correctedItemTotalCorrelations,
  cronbachAlpha,
  normSampleBand,
  pearsonCorrelation,
  percentileRank,
  percentileTable,
  summarizeDimension,
} from "../lib/assessment-validation";

/** 参考值由 numpy 计算（同一份固定数据），用来锁公式口径 */
const MATRIX = [
  [4, 4, 5],
  [3, 3, 2],
  [5, 4, 4],
  [2, 3, 2],
  [4, 5, 4],
  [1, 2, 2],
];
const PERFECT = [
  [1, 1, 1],
  [2, 2, 2],
  [3, 3, 3],
  [4, 4, 4],
  [5, 5, 5],
];

describe("cronbachAlpha", () => {
  it("与 numpy 参考值一致（0.9177…）", () => {
    expect(cronbachAlpha(MATRIX)).toBeCloseTo(0.9177377892030847, 10);
  });

  it("题目完全平行时为 1（上限钳制）", () => {
    expect(cronbachAlpha(PERFECT)).toBe(1);
  });

  it("无法计算时返回 null：样本不足 / 单题 / 常量总分 / 空输入", () => {
    expect(cronbachAlpha([[1, 2]])).toBeNull(); // 1 人
    expect(cronbachAlpha([[1], [2], [3]])).toBeNull(); // 单题
    expect(cronbachAlpha([])).toBeNull();
    // 所有人总分一样 → 总分方差 0
    expect(
      cronbachAlpha([
        [1, 5],
        [5, 1],
        [3, 3],
      ])
    ).toBeNull();
  });

  it("含非数值/列数不一致的行被丢弃（脏数据不污染系数）", () => {
    const withJunk: unknown[][] = [...MATRIX, [Number.NaN, 3, 4], [4, 5]];
    expect(cronbachAlpha(withJunk as number[][])).toBeCloseTo(0.9177377892030847, 10);
  });
});

describe("correctedItemTotalCorrelations", () => {
  it("与 numpy 参考值一致（每题与其余题之和的相关）", () => {
    const citc = correctedItemTotalCorrelations(MATRIX);
    expect(citc[0]).toBeCloseTo(0.8652069102, 6);
    expect(citc[1]).toBeCloseTo(0.8608105786, 6);
    expect(citc[2]).toBeCloseTo(0.82831537, 6);
  });

  it("题目完全平行时每题 CITC 为 1", () => {
    expect(correctedItemTotalCorrelations(PERFECT)).toEqual([1, 1, 1]);
  });

  it("单题 / 样本不足 / 常数列返回 null", () => {
    expect(correctedItemTotalCorrelations([[1], [2], [3]])).toEqual([null]);
    expect(correctedItemTotalCorrelations([[1, 2], [2, 3]])).toEqual([null, null]); // 2 人
    expect(
      correctedItemTotalCorrelations([
        [3, 1],
        [3, 2],
        [3, 3],
        [3, 4],
      ])
    ).toEqual([null, null]); // 第 1 题是常量
  });
});

describe("pearsonCorrelation", () => {
  it("与 numpy 参考值一致（重测数据）", () => {
    const first = [20, 40, 60, 80, 100, 35];
    const second = [22, 38, 65, 79, 96, 40];
    expect(pearsonCorrelation(first, second)).toBeCloseTo(0.9939475835239981, 10);
  });

  it("本身较强相关时为正、方向相反时为负，并钳在 [-1, 1]", () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBe(1);
    expect(pearsonCorrelation([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
  });

  it("长度不一致 / 样本不足 / 常量列返回 null", () => {
    expect(pearsonCorrelation([1, 2, 3], [1, 2])).toBeNull();
    expect(pearsonCorrelation([1], [2])).toBeNull();
    expect(pearsonCorrelation([2, 2, 2], [1, 2, 3])).toBeNull();
  });
});

describe("summarizeDimension", () => {
  it("汇总 α / 档位 / 逐题 CITC / 低 CITC 题号", () => {
    const summary = summarizeDimension("R", [1, 6, 11], MATRIX);
    expect(summary.dimension).toBe("R");
    expect(summary.itemCount).toBe(3);
    expect(summary.sampleSize).toBe(6);
    expect(summary.alpha).toBeCloseTo(0.9177377892030847, 10);
    expect(summary.band).toBe("good");
    expect(summary.citc.map((item) => item.index)).toEqual([1, 6, 11]);
    expect(summary.lowCitc).toEqual([]);
  });

  it("CITC 低于阈值（含无法计算）的题被点名", () => {
    // 第 3 题是常量 3 → 与其余题之和相关无法计算 → 计入 lowCitc
    const summary = summarizeDimension("I", [1, 2, 3], [
      [1, 2, 3],
      [2, 4, 3],
      [3, 1, 3],
      [4, 5, 3],
      [5, 3, 3],
    ]);
    expect(summary.lowCitc).toContain(3);
  });

  it("样本不足时 α / 档位为 null，但仍返回题数", () => {
    const summary = summarizeDimension("A", [1, 2], []);
    expect(summary.sampleSize).toBe(0);
    expect(summary.alpha).toBeNull();
    expect(summary.band).toBeNull();
    expect(summary.itemCount).toBe(2);
  });
});

describe("percentileTable / percentileRank", () => {
  it("百分位与 numpy 线性插值口径一致", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentileTable(values)).toEqual({
      sampleSize: 10,
      p10: 19,
      p25: 32.5,
      p50: 55,
      p75: 77.5,
      p90: 91,
    });
  });

  it("乱序输入先排序；单样本所有百分位相同；空样本返回 null", () => {
    expect(percentileTable([100, 10, 50])).toMatchObject({ sampleSize: 3, p50: 50 });
    expect(percentileTable([42])).toMatchObject({ p10: 42, p90: 42 });
    expect(percentileTable([])).toBeNull();
    expect(percentileTable([Number.NaN])).toBeNull();
  });

  it("百分位排名：不高于该分数的占比（1 位小数），越界钳在 0/100", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentileRank(values, 55)).toBe(50);
    expect(percentileRank(values, 5)).toBe(0);
    expect(percentileRank(values, 150)).toBe(100);
    expect(percentileRank(values, 30)).toBe(30);
    expect(percentileRank([], 30)).toBeNull();
  });
});

describe("阈值与档位", () => {
  it("档位边界：≥0.8 良好、≥0.7 可接受、否则未达标", () => {
    expect(bandOf(0.85)).toBe("good");
    expect(bandOf(0.8)).toBe("good");
    expect(bandOf(0.75)).toBe("acceptable");
    expect(bandOf(0.7)).toBe("acceptable");
    expect(bandOf(0.69)).toBe("below");
    // 重测信度只有「是否达标」一档：可达线 = 良好线 = 0.7
    expect(bandOf(RETEST_ACCEPTABLE, RETEST_ACCEPTABLE, RETEST_ACCEPTABLE)).toBe("good");
    expect(bandOf(RETEST_ACCEPTABLE - 0.01, RETEST_ACCEPTABLE, RETEST_ACCEPTABLE)).toBe("below");
    expect(BAND_LABELS).toEqual({ good: "良好", acceptable: "可接受", below: "未达标" });
  });

  it("常模样本量档位：<60 不足、60–99 刚够、≥100 推荐", () => {
    expect(normSampleBand(NORM_MIN_SAMPLE - 1)).toBe("insufficient");
    expect(normSampleBand(NORM_MIN_SAMPLE)).toBe("minimum");
    expect(normSampleBand(NORM_RECOMMENDED_SAMPLE - 1)).toBe("minimum");
    expect(normSampleBand(NORM_RECOMMENDED_SAMPLE)).toBe("recommended");
  });

  it("阈值常量与方案文档口径一致（改文档必须同步）", () => {
    expect(ALPHA_ACCEPTABLE).toBe(0.7);
    expect(ALPHA_GOOD).toBe(0.8);
    expect(CITC_MIN).toBe(0.3);
    expect(RETEST_ACCEPTABLE).toBe(0.7);
    expect(NORM_MIN_SAMPLE).toBe(60);
    expect(NORM_RECOMMENDED_SAMPLE).toBe(100);
    expect([...NORM_PERCENTILES]).toEqual([10, 25, 50, 75, 90]);
  });
});
