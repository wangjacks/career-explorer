import { describe, it, expect } from "vitest";
import type { DimensionScore } from "../lib/assessment-scoring";
import { RIASEC_KEYS, RIASEC_LABELS } from "../lib/assessment-match";
import {
  BIG_FIVE_INTERPRETATIONS,
  CROSS_SCALE_LINKS,
  RIASEC_INTERPRETATIONS,
  buildBigFiveBars,
  buildBigFiveHeadline,
  buildBigFiveInterpretations,
  buildCareerCards,
  buildRadarPoints,
  buildResultTrailing,
  buildRiasecBars,
  buildRiasecInterpretations,
  describeTypeCode,
  parseTypeCodeParts,
  resultCardMode,
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

  it("轻量快照（只有维度 + 标准分）也能画条形，中文型名回退 RIASEC_LABELS", () => {
    // 教师端数据列表（#234）下发的是 { key, standard }，没有 label / raw / band
    const bars = buildRiasecBars(
      [
        { key: "R", standard: 40 },
        { key: "I", standard: 90 },
        { key: "A", standard: 10 },
      ],
      "IRA"
    );
    expect(bars.map((b) => b.key)).toEqual(["I", "R", "A", "S", "E", "C"]);
    expect(bars[0]).toMatchObject({ label: "研究型", standard: 90, percent: 90, isTop: true });
    expect(bars[3]).toMatchObject({ label: "社会型", standard: 0, isTop: false });
  });
});

describe("雷达图顶点", () => {
  const riasecRadar = RIASEC_KEYS.map((key) => ({ key, label: RIASEC_LABELS[key] }));

  it("按传入的维度顺序（RIASEC 为 R I A S E C），不随得分排序，缺失维度补 0", () => {
    const points = buildRadarPoints([score("S", 88), score("C", 42)], riasecRadar);
    expect(points.map((p) => p.key)).toEqual([...RIASEC_KEYS]);
    expect(points.map((p) => p.standard)).toEqual([0, 0, 0, 88, 0, 42]);
    expect(points.find((p) => p.key === "S")?.label).toBe("社会型");
  });

  it("越界分数钳到 0–100（雷达图量程固定）", () => {
    const points = buildRadarPoints([score("R", 130), score("I", -8)], riasecRadar);
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

describe("五大人格结果（#292）", () => {
  const BIG_FIVE_DIMENSIONS = [
    { key: "N", label: "神经质" },
    { key: "E", label: "外向性" },
    { key: "O", label: "开放性" },
    { key: "A", label: "宜人性" },
    { key: "C", label: "尽责性" },
  ];

  function five(partial: Partial<Record<string, number>>): DimensionScore[] {
    return BIG_FIVE_DIMENSIONS.map(({ key, label }) => score(key, partial[key] ?? 0, label));
  }

  it("条形按标准分降序、同分按量表维度顺序，前两维标「主要特质」", () => {
    const bars = buildBigFiveBars(five({ N: 52, E: 80, O: 30, A: 80, C: 90 }), BIG_FIVE_DIMENSIONS);
    expect(bars.map((b) => b.key)).toEqual(["C", "E", "A", "N", "O"]);
    expect(bars.map((b) => b.isPrimary)).toEqual([true, true, false, false, false]);
    expect(bars[0]).toMatchObject({ label: "尽责性", standard: 90, percent: 90 });
    expect(bars.find((b) => b.key === "N")?.label).toBe("神经质");
  });

  it("画像标签取最高两维，前缀与逐维解读同口径：高尽责性 · 高外向性", () => {
    expect(buildBigFiveHeadline(five({ C: 90, E: 70 }), BIG_FIVE_DIMENSIONS)).toBe("高尽责性 · 高外向性");
    // 最高两维都没过中线时不能自称「高」，否则与下方逐维的「偏低」自相矛盾
    expect(buildBigFiveHeadline(five({ N: 40, E: 30, O: 20, A: 10, C: 0 }), BIG_FIVE_DIMENSIONS)).toBe(
      "偏低神经质 · 偏低外向性"
    );
    // 50 分恰好在中线上，与解读一致算「高」
    expect(buildBigFiveHeadline(five({ A: 50, C: 50 }), BIG_FIVE_DIMENSIONS)).toBe("高宜人性 · 高尽责性");
  });

  it("逐维解读以 50 分为中线取高分 / 低分文案（3 分折算恒为 50，算高分）", () => {
    const items = buildBigFiveInterpretations(five({ N: 50, E: 49, O: 100, A: 0, C: 75 }), BIG_FIVE_DIMENSIONS);
    const byKey = new Map(items.map((item) => [item.key, item]));
    expect(byKey.get("N")).toMatchObject({ level: "high", text: BIG_FIVE_INTERPRETATIONS.N.high });
    expect(byKey.get("E")).toMatchObject({ level: "low", text: BIG_FIVE_INTERPRETATIONS.E.low });
    expect(byKey.get("A")).toMatchObject({ level: "low", text: BIG_FIVE_INTERPRETATIONS.A.low });
    expect(byKey.get("O")).toMatchObject({ level: "high", text: BIG_FIVE_INTERPRETATIONS.O.high });
    // 顺序与条状排名一致，前两维标主要特质
    expect(items.map((item) => item.key)).toEqual(["O", "C", "N", "E", "A"]);
    expect(items.slice(0, 2).every((item) => item.isPrimary)).toBe(true);
  });

  it("十段解读齐全、不出现统计/工程术语", () => {
    expect(Object.keys(BIG_FIVE_INTERPRETATIONS).sort()).toEqual(["A", "C", "E", "N", "O"]);
    for (const key of Object.keys(BIG_FIVE_INTERPRETATIONS)) {
      for (const level of ["high", "low"] as const) {
        const text = BIG_FIVE_INTERPRETATIONS[key][level];
        expect(text.length, `${key}.${level} 太短`).toBeGreaterThan(10);
        for (const jargon of ["标准分", "维度", "口径"]) {
          expect(text, `${key}.${level} 的解读出现术语「${jargon}」`).not.toContain(jargon);
        }
      }
    }
  });

  it("雷达按量表自己的维度顺序排布，大五的 E/A/C 不会被当成霍兰德字母", () => {
    const points = buildRadarPoints(five({ E: 80, A: 60 }), BIG_FIVE_DIMENSIONS);
    expect(points.map((p) => p.key)).toEqual(["N", "E", "O", "A", "C"]);
    expect(points.map((p) => p.standard)).toEqual([0, 80, 0, 60, 0]);
    expect(points.find((p) => p.key === "E")?.label).toBe("外向性");
    expect(points.find((p) => p.key === "A")?.label).toBe("宜人性");
    expect(points.find((p) => p.key === "C")?.label).toBe("尽责性");
  });

  it("提示卡的三组对应关系：S↔宜人性、E↔外向性、C↔尽责性，文案面向学生", () => {
    expect(CROSS_SCALE_LINKS.map((link) => `${link.riasec}-${link.bigFive}`)).toEqual(["S-A", "E-E", "C-C"]);
    for (const link of CROSS_SCALE_LINKS) {
      expect(link.riasecLabel.length).toBeGreaterThan(0);
      expect(link.bigFiveLabel.length).toBeGreaterThan(0);
      expect(link.text).toContain(link.riasecLabel);
      expect(link.text).toContain(link.bigFiveLabel);
      expect(link.text).not.toContain("维度");
      // 通用科普不能对学生实际结果下判断：文案写成条件句，而不是断言两边的分都高
      expect(link.text).toContain("两边都高");
    }
  });
});

describe("结果卡分流与口径行（#292）", () => {
  it("按计分模式在入口分流：dimensional → 大五卡，其余 → 霍兰德卡", () => {
    expect(resultCardMode({ scoringMode: "dimensional" })).toBe("big-five");
    expect(resultCardMode({ scoringMode: "typological" })).toBe("holland");
    // 老接口没下发 scoringMode 时沿用霍兰德卡，不靠 typeCode 是否为 null 反推
    expect(resultCardMode({})).toBe("holland");
    expect(resultCardMode(null)).toBe("holland");
    expect(resultCardMode({ scoringMode: "unknown-mode" })).toBe("holland");
  });

  it("口径行：题量 · 完成时间 · 第几次；版本数撞上限显示 10+", () => {
    expect(buildResultTrailing({ questionCount: 30, completedAt: "2026-10-21 14:30", historyCount: 2 })).toBe(
      "本次 30 题 · 完成于 2026-10-21 14:30 · 第 2 次"
    );
    expect(buildResultTrailing({ completedAt: "", historyCount: 10 })).toBe("第 10+ 次");
    expect(buildResultTrailing({ questionCount: 0, historyCount: 0 })).toBe("已完成");
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
