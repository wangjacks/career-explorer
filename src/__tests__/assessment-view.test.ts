import { describe, it, expect } from "vitest";
import type { DimensionScore } from "../lib/assessment-scoring";
import { RIASEC_KEYS, RIASEC_LABELS } from "../lib/assessment-match";
import {
  RIASEC_INTERPRETATIONS,
  buildCareerCards,
  buildRadarPoints,
  buildRiasecBars,
  buildRiasecInterpretations,
  describeTypeCode,
  parseTypeCodeParts,
} from "../lib/assessment-view";

function score(key: string, standard: number, label?: string): DimensionScore {
  return {
    key,
    label: label ?? RIASEC_LABELS[key as keyof typeof RIASEC_LABELS] ?? key,
    questionCount: 5,
    answered: 5,
    raw: 20,
    minPossible: 5,
    maxPossible: 25,
    standard,
  };
}

/** R I A S E C 顺序的完整六维 */
function six(partial: Partial<Record<string, number>>): DimensionScore[] {
  return RIASEC_KEYS.map((key) => score(key, partial[key] ?? 0));
}

describe("三字码展示", () => {
  it("规范化：小写 / 多余字母 / 重复字母都收敛成有效徽章", () => {
    expect(parseTypeCodeParts("sia").map((p) => p.key)).toEqual(["S", "I", "A"]);
    expect(parseTypeCodeParts("SIAX").map((p) => p.key)).toEqual(["S", "I", "A"]);
    expect(parseTypeCodeParts("SSSR").map((p) => p.key)).toEqual(["S", "R"]);
    expect(parseTypeCodeParts("")).toEqual([]);
    expect(parseTypeCodeParts(null)).toEqual([]);
    expect(parseTypeCodeParts("XYZ")).toEqual([]);
  });

  it("每枚字母带中文型名；describeTypeCode 拼成可读串", () => {
    expect(parseTypeCodeParts("SIA")).toEqual([
      { key: "S", label: "社会型" },
      { key: "I", label: "研究型" },
      { key: "A", label: "艺术型" },
    ]);
    expect(describeTypeCode("SIA")).toBe("社会型 · 研究型 · 艺术型");
    expect(describeTypeCode(null)).toBe("");
  });
});

describe("条状排名", () => {
  it("按标准分降序，同分按 RIASEC 固有序（稳定）", () => {
    const bars = buildRiasecBars(six({ R: 50, I: 50, A: 90, S: 10 }), null);
    expect(bars.map((b) => b.key)).toEqual(["A", "R", "I", "S", "E", "C"]);
    expect(bars.map((b) => b.standard)).toEqual([90, 50, 50, 10, 0, 0]);
    expect(bars[0].percent).toBe(90);
  });

  it("三字码成员标 isTop（其余不算）", () => {
    const bars = buildRiasecBars(six({ R: 10, I: 80, A: 30, S: 90 }), "SIA");
    expect(bars.filter((b) => b.isTop).map((b) => b.key).sort()).toEqual(["A", "I", "S"]);
    expect(bars.find((b) => b.key === "R")?.isTop).toBe(false);
  });

  it("缺失维度补 0 且回退中文型名；越界与非法值被钳制", () => {
    const scores = [score("R", 150), score("S", -20), score("A", Number.NaN), { ...score("O", 99) }];
    const bars = buildRiasecBars(scores, null);
    expect(bars).toHaveLength(6);
    expect(bars.find((b) => b.key === "R")?.standard).toBe(100);
    expect(bars.find((b) => b.key === "S")?.standard).toBe(0);
    expect(bars.find((b) => b.key === "A")?.standard).toBe(0);
    expect(bars.find((b) => b.key === "I")?.label).toBe("研究型");
    // 非 RIASEC 键（O）被忽略，不会出现在排名里
    expect(bars.map((b) => String(b.key))).not.toContain("O");
  });
});

describe("雷达图顶点", () => {
  it("固定 R I A S E C 顺序（不随得分排序），缺失维度补 0", () => {
    const points = buildRadarPoints([score("S", 88), score("C", 42)]);
    expect(points.map((p) => p.key)).toEqual([...RIASEC_KEYS]);
    expect(points.map((p) => p.standard)).toEqual([0, 0, 0, 88, 0, 42]);
    expect(points.find((p) => p.key === "S")?.label).toBe("社会型");
  });

  it("越界分数钳到 0–100（雷达图量程固定）", () => {
    const points = buildRadarPoints([score("R", 130), score("I", -8)]);
    expect(points[0].standard).toBe(100);
    expect(points[1].standard).toBe(0);
  });
});

describe("六型逐条解读", () => {
  it("六型都有通俗说明，且不出现统计/工程术语", () => {
    expect(Object.keys(RIASEC_INTERPRETATIONS).sort()).toEqual([...RIASEC_KEYS].sort());
    for (const key of RIASEC_KEYS) {
      const text = RIASEC_INTERPRETATIONS[key];
      expect(text.length).toBeGreaterThan(10);
      for (const jargon of ["标准分", "维度", "口径", "在册"]) {
        expect(text, `${key} 的解读出现术语「${jargon}」`).not.toContain(jargon);
      }
    }
  });

  it("按排名顺序输出六条，isTop 与条状排名一致", () => {
    const items = buildRiasecInterpretations(six({ A: 95, S: 70, I: 60 }), "ASI");
    expect(items).toHaveLength(6);
    expect(items.map((i) => i.key)).toEqual(["A", "S", "I", "R", "E", "C"]);
    expect(items.filter((i) => i.isTop).map((i) => i.key).sort()).toEqual(["A", "I", "S"]);
    expect(items[0].text).toBe(RIASEC_INTERPRETATIONS.A);
  });
});

describe("推荐职业卡片", () => {
  it("中文名优先；无译名时回退英文名且不重复展示副标题", () => {
    const cards = buildCareerCards([
      {
        code: "15-1252.00",
        name: "Software Developers",
        nameZh: "软件开发工程师",
        cluster: "计算机与数学",
        educationLevel: "本科",
      },
      { code: "11-1011.00", name: "Chief Executives", nameZh: null, cluster: "管理", educationLevel: "研究生" },
    ]);
    expect(cards[0]).toEqual({
      code: "15-1252.00",
      displayName: "软件开发工程师",
      englishName: "Software Developers",
      hasChineseName: true,
      meta: "计算机与数学 · 本科",
    });
    expect(cards[1]).toMatchObject({ displayName: "Chief Executives", hasChineseName: false });
  });

  it("缺字段的脏行整行丢弃；meta 只拼有值的部分", () => {
    const cards = buildCareerCards([
      { code: "  ", name: "No Code" },
      { code: "99-0001.00", name: "  " },
      { code: "99-0002.00", name: "Only Name" },
      "not-an-object" as never,
      null as never,
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ code: "99-0002.00", displayName: "Only Name", meta: "" });
  });

  it("空/非数组入参返回空列表（推荐区块据此整块不渲染）", () => {
    expect(buildCareerCards([])).toEqual([]);
    expect(buildCareerCards(null)).toEqual([]);
    expect(buildCareerCards(undefined)).toEqual([]);
  });
});
