import { describe, it, expect } from "vitest";
import {
  DEFAULT_HIGH_BAND,
  DEFAULT_MEDIUM_BAND,
  HOLLAND_TIE_BREAK_ORDER,
  LIKERT_MAX,
  LIKERT_MIN,
  REVERSE_FACTOR,
  bandOf,
  buildTypeCode,
  rankDimensions,
  scoreAssessment,
  scoreItem,
  standardizeLinear,
  type DimensionConfig,
  type DimensionScore,
  type QuestionConfig,
} from "../lib/assessment-scoring";

/* ---------- RIASEC 30 题模拟题库：每维 5 题，每维末题为反向计分 ---------- */

const RIASEC_DIMENSIONS: DimensionConfig[] = [
  { key: "R", label: "现实型" },
  { key: "I", label: "研究型" },
  { key: "A", label: "艺术型" },
  { key: "S", label: "社会型" },
  { key: "E", label: "企业型" },
  { key: "C", label: "常规型" },
];

const RIASEC_QUESTIONS: QuestionConfig[] = RIASEC_DIMENSIONS.flatMap((dimension, dimIndex) =>
  [0, 1, 2, 3, 4].map((offset) => ({
    index: dimIndex * 5 + offset + 1,
    dimension: dimension.key,
    reverseScored: offset === 4,
  }))
);

function answersFor(pick: (index: number, dimension: string, reverseScored: boolean) => number): Record<number, number> {
  const answers: Record<number, number> = {};
  for (const question of RIASEC_QUESTIONS) {
    answers[question.index] = pick(question.index, question.dimension, Boolean(question.reverseScored));
  }
  return answers;
}

function scoreOf(result: ReturnType<typeof scoreAssessment>, key: string): DimensionScore {
  return result.scores.find((score) => score.key === key)!;
}

describe("scoreItem", () => {
  it("正向题原样、反向题按 6 - x 取反", () => {
    expect(scoreItem(LIKERT_MIN)).toBe(1);
    expect(scoreItem(LIKERT_MAX)).toBe(5);
    expect(scoreItem(1, true)).toBe(5);
    expect(scoreItem(2, true)).toBe(4);
    expect(scoreItem(3, true)).toBe(3);
    expect(scoreItem(5, true)).toBe(1);
    expect(REVERSE_FACTOR).toBe(6);
  });

  it("取反在量表两端对合（两次取反回到原值）", () => {
    for (let value = LIKERT_MIN; value <= LIKERT_MAX; value++) {
      expect(scoreItem(scoreItem(value, true), true)).toBe(value);
    }
  });
});

describe("standardizeLinear", () => {
  const base = { minPossible: 5, maxPossible: 25, answered: 5, questionCount: 5, dimension: { key: "R", label: "现实型" } };

  it("量程两端与中点映射到 0 / 50 / 100", () => {
    expect(standardizeLinear({ ...base, raw: 5 })).toBe(0);
    expect(standardizeLinear({ ...base, raw: 15 })).toBe(50);
    expect(standardizeLinear({ ...base, raw: 25 })).toBe(100);
  });

  it("保留一位小数", () => {
    expect(standardizeLinear({ raw: 13, minPossible: 4, maxPossible: 20, answered: 4, questionCount: 4, dimension: { key: "I", label: "研究型" } })).toBe(56.3);
  });

  it("无题可折算（该维度未作答）时回落到 0 而不是 NaN", () => {
    expect(standardizeLinear({ raw: 0, minPossible: 0, maxPossible: 0, answered: 0, questionCount: 5, dimension: { key: "A", label: "艺术型" } })).toBe(0);
  });

  it("越界输入钳制在 0-100", () => {
    expect(standardizeLinear({ ...base, raw: 0 })).toBe(0);
    expect(standardizeLinear({ ...base, raw: 99 })).toBe(100);
  });
});

describe("scoreAssessment · RIASEC 30 题", () => {
  it("正向题全选 5、反向题全选 1：六维标准分都是 100，全并列时按 R>I>A>S>E>C 取前三", () => {
    const result = scoreAssessment(RIASEC_DIMENSIONS, RIASEC_QUESTIONS, answersFor((_index, _dimension, reverse) => (reverse ? 1 : 5)));

    expect(result.mode).toBe("typological");
    expect(result.questionCount).toBe(30);
    expect(result.answeredCount).toBe(30);
    expect(result.complete).toBe(true);
    expect(result.missingIndexes).toEqual([]);
    expect(result.scores.map((score) => score.raw)).toEqual([25, 25, 25, 25, 25, 25]);
    expect(result.scores.map((score) => score.standard)).toEqual([100, 100, 100, 100, 100, 100]);
    expect(result.code).toBe("RIA");
    expect(result.rankedKeys).toEqual(["R", "I", "A", "S", "E", "C"]);
  });

  it("正向题全选 1、反向题全选 5：六维标准分都是 0", () => {
    const result = scoreAssessment(RIASEC_DIMENSIONS, RIASEC_QUESTIONS, answersFor((_index, _dimension, reverse) => (reverse ? 5 : 1)));

    expect(result.scores.map((score) => score.raw)).toEqual([5, 5, 5, 5, 5, 5]);
    expect(result.scores.map((score) => score.standard)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(result.code).toBe("RIA");
  });

  it("整卷不分正反向全选 5 分时，反向题把每维拉回 21 分（80）", () => {
    const result = scoreAssessment(RIASEC_DIMENSIONS, RIASEC_QUESTIONS, answersFor(() => 5));

    // 每维 4 道正向题各 5 分 + 1 道反向题 6-5=1 分
    expect(result.scores.map((score) => score.raw)).toEqual([21, 21, 21, 21, 21, 21]);
    expect(result.scores.map((score) => score.standard)).toEqual([80, 80, 80, 80, 80, 80]);
  });

  it("整卷全选 1 分时反向题把每维推到 9 分（20），证明反向题不是简单累加", () => {
    const result = scoreAssessment(RIASEC_DIMENSIONS, RIASEC_QUESTIONS, answersFor(() => 1));

    // 4 道正向题各 1 分 + 1 道反向题 6-1=5 分
    expect(result.scores.map((score) => score.raw)).toEqual([9, 9, 9, 9, 9, 9]);
    expect(result.scores.map((score) => score.standard)).toEqual([20, 20, 20, 20, 20, 20]);
  });

  it("逐维手工核对：原始分、量程与标准分互相吻合", () => {
    const result = scoreAssessment(
      RIASEC_DIMENSIONS,
      RIASEC_QUESTIONS,
      answersFor((index, dimension, reverseScored) => {
        if (dimension === "S") return 5;
        if (dimension === "I") return reverseScored ? 1 : 4;
        return index % 2 === 0 ? 3 : 2;
      })
    );

    // S：4 道正向题 20 + 反向题 (6-5)=1 → 21 / 量程 5-25 → 80
    expect(scoreOf(result, "S")).toMatchObject({ raw: 21, standard: 80 });
    // I：4 道正向题 16 + 反向题 (6-1)=5 → 21 → 80
    expect(scoreOf(result, "I")).toMatchObject({ raw: 21, standard: 80 });
    // R/A/E：正向题 2+3+2+3 计 10，反向题 6-2=4 或 6-3=3 → 14 / 量程 5-25 → 45
    expect(scoreOf(result, "R")).toMatchObject({ raw: 14, standard: 45 });
    expect(scoreOf(result, "A")).toMatchObject({ raw: 14, standard: 45 });
    expect(scoreOf(result, "E")).toMatchObject({ raw: 14, standard: 45 });
    // C：反向题落在偶数题号，6-3=3 → 13 → 40
    expect(scoreOf(result, "C")).toMatchObject({ raw: 13, standard: 40 });
    expect(result.code).toBe("ISR");
  });

  it("得分快照带题数、量程与中文标签，可直接写进 assessment_results 的得分 JSON", () => {
    const result = scoreAssessment(RIASEC_DIMENSIONS, RIASEC_QUESTIONS, answersFor(() => 3));

    expect(result.scores.every((score) => score.questionCount === 5 && score.answered === 5)).toBe(true);
    expect(result.scores.every((score) => score.minPossible === 5 && score.maxPossible === 25)).toBe(true);
    expect(result.scores.map((score) => score.label)).toEqual(["现实型", "研究型", "艺术型", "社会型", "企业型", "常规型"]);
  });
});

describe("scoreAssessment · 反向计分极端用例", () => {
  const dimensions: DimensionConfig[] = [{ key: "R", label: "现实型" }];
  const allReverse: QuestionConfig[] = [1, 2, 3].map((index) => ({ index, dimension: "R", reverseScored: true }));

  it("整维反向题时，最低作答反而得满分", () => {
    const result = scoreAssessment(dimensions, allReverse, { 1: 1, 2: 1, 3: 1 });
    expect(result.scores[0].raw).toBe(15);
    expect(result.scores[0].standard).toBe(100);
  });

  it("整维反向题时，最高作答得 0 分", () => {
    const result = scoreAssessment(dimensions, allReverse, { 1: 5, 2: 5, 3: 5 });
    expect(result.scores[0].raw).toBe(3);
    expect(result.scores[0].standard).toBe(0);
  });

  it("正向与反向混编时，同一倾向不会把两题推向相反极端", () => {
    const mixed: QuestionConfig[] = [
      { index: 1, dimension: "R" },
      { index: 2, dimension: "R", reverseScored: true },
    ];
    expect(scoreAssessment(dimensions, mixed, { 1: 5, 2: 1 }).scores[0].standard).toBe(100);
    expect(scoreAssessment(dimensions, mixed, { 1: 1, 2: 5 }).scores[0].standard).toBe(0);
    // 两题取中间值时不偏不倚
    expect(scoreAssessment(dimensions, mixed, { 1: 3, 2: 3 }).scores[0].standard).toBe(50);
  });
});

describe("scoreAssessment · 并列破平", () => {
  /** 每维一道正向题，分值直接决定标准分（量程 1-5 → 0/50/100） */
  const onePerDimension: QuestionConfig[] = RIASEC_DIMENSIONS.map((dimension, i) => ({ index: i + 1, dimension: dimension.key }));

  function scoreWith(values: Record<string, number>) {
    const answers: Record<number, number> = {};
    for (const question of onePerDimension) answers[question.index] = values[question.dimension];
    return scoreAssessment(RIASEC_DIMENSIONS, onePerDimension, answers);
  }

  it("六维并列时得到固定码 RIA", () => {
    expect(scoreWith({ R: 4, I: 4, A: 4, S: 4, E: 4, C: 4 }).code).toBe("RIA");
  });

  it("R 缺席时 I/A/S/E 四者并列仍取 IAS", () => {
    const result = scoreWith({ R: 1, I: 5, A: 5, S: 5, E: 5, C: 1 });
    expect(result.rankedKeys).toEqual(["I", "A", "S", "E", "R", "C"]);
    expect(result.code).toBe("IAS");
  });

  it("S/E 与 A 并列时按 A > S > E", () => {
    expect(scoreWith({ R: 1, I: 1, A: 5, S: 5, E: 5, C: 1 }).code).toBe("ASE");
  });

  it("C 与 R 并列时 R 优先", () => {
    expect(scoreWith({ R: 5, I: 1, A: 1, S: 1, E: 1, C: 5 }).code).toBe("RCI");
  });

  it("传入自定义优先序即可反转破平结果（大五不必沿用 RIASEC）", () => {
    const reversed = [...HOLLAND_TIE_BREAK_ORDER].reverse();
    const result = scoreAssessment(RIASEC_DIMENSIONS, onePerDimension, { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5 }, { tieBreakOrder: reversed });
    expect(result.code).toBe("CES");
  });

  it("未登记在优先序里的维度 key 排在已登记 key 之后", () => {
    const custom: DimensionConfig[] = [
      { key: "X", label: "额外维度" },
      { key: "R", label: "现实型" },
    ];
    const questions: QuestionConfig[] = [
      { index: 1, dimension: "X" },
      { index: 2, dimension: "R" },
    ];
    const result = scoreAssessment(custom, questions, { 1: 5, 2: 5 }, { codeLength: 2 });
    expect(result.rankedKeys).toEqual(["R", "X"]);
    expect(result.code).toBe("RX");
  });

  it("rankDimensions / buildTypeCode 可单独使用，未作答维度不参与取码", () => {
    const scores: DimensionScore[] = [
      { key: "S", label: "社会型", questionCount: 1, answered: 1, raw: 5, minPossible: 1, maxPossible: 5, standard: 90 },
      { key: "E", label: "企业型", questionCount: 1, answered: 1, raw: 5, minPossible: 1, maxPossible: 5, standard: 90 },
      { key: "R", label: "现实型", questionCount: 1, answered: 1, raw: 5, minPossible: 1, maxPossible: 5, standard: 100 },
      { key: "C", label: "常规型", questionCount: 1, answered: 0, raw: 0, minPossible: 0, maxPossible: 0, standard: 0 },
    ];
    const ranked = rankDimensions(scores, HOLLAND_TIE_BREAK_ORDER);
    expect(ranked).toEqual(["R", "S", "E"]);
    expect(buildTypeCode(ranked)).toBe("RSE");
  });
});

describe("scoreAssessment · dimensional 模式（大五等）", () => {
  const dimensions: DimensionConfig[] = [
    { key: "O", label: "开放性" },
    { key: "A", label: "宜人性" },
  ];
  const questions: QuestionConfig[] = [
    { index: 1, dimension: "O" },
    { index: 2, dimension: "O" },
    { index: 3, dimension: "A" },
    { index: 4, dimension: "A", reverseScored: true },
  ];

  it("输出各维度标准分与高/中/低档，不产出三字码", () => {
    const result = scoreAssessment(dimensions, questions, { 1: 5, 2: 5, 3: 4, 4: 5 }, { mode: "dimensional" });

    expect(result.code).toBeUndefined();
    expect(result.rankedKeys).toBeUndefined();
    expect(result.scores.map((score) => [score.key, score.standard, score.band])).toEqual([
      ["O", 100, "high"],
      ["A", 37.5, "medium"],
    ]);
  });

  it("分段边界：达到 highBand 为 high，达到 mediumBand 为 medium，其余 low", () => {
    expect(bandOf(DEFAULT_HIGH_BAND)).toBe("high");
    expect(bandOf(DEFAULT_MEDIUM_BAND)).toBe("medium");
    expect(bandOf(100)).toBe("high");
    expect(bandOf(0)).toBe("low");
  });

  it("阈值可按量表覆盖，默认口径为 66.7 / 33.3", () => {
    const neutral = scoreAssessment(dimensions, questions, { 1: 3, 2: 3, 3: 3, 4: 3 }, { mode: "dimensional" });
    expect(neutral.scores.map((score) => [score.standard, score.band])).toEqual([
      [50, "medium"],
      [50, "medium"],
    ]);
    expect(
      scoreAssessment(dimensions, questions, { 1: 3, 2: 3, 3: 3, 4: 3 }, { mode: "dimensional", highBand: 50 }).scores.map((s) => s.band)
    ).toEqual(["high", "high"]);
    expect(
      scoreAssessment(dimensions, questions, { 1: 3, 2: 3, 3: 3, 4: 3 }, { mode: "dimensional", mediumBand: 55 }).scores.map((s) => s.band)
    ).toEqual(["low", "low"]);
  });
});

describe("scoreAssessment · 草稿续答", () => {
  it("缺答时标记未完成、列出升序缺答题号，标准分按已答题折算", () => {
    const partial = answersFor((index) => (index <= 10 ? 5 : 3));
    delete partial[3];
    delete partial[7];

    const result = scoreAssessment(RIASEC_DIMENSIONS, RIASEC_QUESTIONS, partial);

    expect(result.complete).toBe(false);
    expect(result.answeredCount).toBe(28);
    expect(result.missingIndexes).toEqual([3, 7]);
    // R 维序号 1-5，缺第 3 题 → 已答 4 题：正向 5+5+5，反向题 6-5=1 → 16 / 量程 4-20 → 75
    expect(scoreOf(result, "R")).toMatchObject({ answered: 4, questionCount: 5, raw: 16, minPossible: 4, maxPossible: 20, standard: 75 });
    // I 维序号 6-10，缺第 7 题 → 5+5+5 + 反向题 6-5=1 → 16 / 量程 4-20 → 75
    expect(scoreOf(result, "I")).toMatchObject({ answered: 4, raw: 16, standard: 75 });
    // A 维 11-15 全答，均为 3 分 → 4×3 + (6-3) = 15 / 量程 5-25 → 50
    expect(scoreOf(result, "A")).toMatchObject({ answered: 5, raw: 15, standard: 50 });
  });

  it("一题未答时全部维度为 0，且未作答维度不占三字码名额", () => {
    const result = scoreAssessment(RIASEC_DIMENSIONS, RIASEC_QUESTIONS, {});
    expect(result.complete).toBe(false);
    expect(result.scores.every((score) => score.standard === 0 && score.answered === 0)).toBe(true);
    expect(result.code).toBe("");
  });

  it("只答了一个维度时，三字码只有一位", () => {
    const result = scoreAssessment(RIASEC_DIMENSIONS, RIASEC_QUESTIONS, { 1: 5, 2: 5, 3: 5, 4: 5, 5: 1 });
    expect(result.code).toBe("R");
    expect(result.rankedKeys).toEqual(["R"]);
  });
});

describe("scoreAssessment · 非法输入", () => {
  const dimensions: DimensionConfig[] = [{ key: "R", label: "现实型" }];
  const questions: QuestionConfig[] = [{ index: 1, dimension: "R" }];

  it("量表外取值直接报错（0、6、小数、NaN）", () => {
    for (const value of [0, 6, 2.5, NaN]) {
      expect(() => scoreAssessment(dimensions, questions, { 1: value })).toThrowError(/第 1 题的作答值必须是 1-5 的整数/);
    }
  });

  it("题库里不存在的题号报错", () => {
    expect(() => scoreAssessment(dimensions, questions, { 9: 3 })).toThrowError(/题库里不存在的题号：9/);
  });

  it("非法题号键报错", () => {
    expect(() => scoreAssessment(dimensions, questions, { "0": 3 })).toThrowError(/作答题号非法/);
  });

  it("维度 key 重复、题目指向未定义维度、空配置都报错", () => {
    expect(() => scoreAssessment([{ key: "R", label: "a" }, { key: "R", label: "b" }], questions, { 1: 3 })).toThrowError(/维度 key 重复：R/);
    expect(() => scoreAssessment(dimensions, [{ index: 1, dimension: "X" }], { 1: 3 })).toThrowError(/未定义的维度：X/);
    expect(() => scoreAssessment([], questions, {})).toThrowError(/至少一个维度/);
    expect(() => scoreAssessment(dimensions, [], {})).toThrowError(/至少一道题/);
  });

  it("题目序号重复或非法报错", () => {
    expect(() => scoreAssessment(dimensions, [{ index: 1, dimension: "R" }, { index: 1, dimension: "R" }], { 1: 3 })).toThrowError(/题目序号重复：1/);
    expect(() => scoreAssessment(dimensions, [{ index: 0, dimension: "R" }], {})).toThrowError(/题目序号非法：0/);
  });

  it("数据库草稿常见的字符串题号键同样接受", () => {
    const result = scoreAssessment(dimensions, questions, { "1": 5 });
    expect(result.scores[0].standard).toBe(100);
    expect(result.complete).toBe(true);
  });
});

describe("scoreAssessment · 常模替换位（#227）", () => {
  it("注入换算函数即可替换线性折算，三字码与其余输出不受影响", () => {
    const toZ = ({ raw, minPossible, maxPossible }: { raw: number; minPossible: number; maxPossible: number }) =>
      Math.round(((raw - (minPossible + maxPossible) / 2) / (maxPossible - (minPossible + maxPossible) / 2) + 2) * 50);

    const linear = scoreAssessment(RIASEC_DIMENSIONS, RIASEC_QUESTIONS, answersFor(() => 5));
    const zResult = scoreAssessment(RIASEC_DIMENSIONS, RIASEC_QUESTIONS, answersFor(() => 5), { standardize: toZ });

    expect(linear.scores.map((score) => score.standard)).toEqual([80, 80, 80, 80, 80, 80]);
    // 每维 raw 21、量程 5-25 → (21-15)/10 + 2 = 2.6 → 130
    expect(zResult.scores.map((score) => score.standard)).toEqual([130, 130, 130, 130, 130, 130]);
    expect(zResult.code).toBe("RIA");
    expect(zResult.scores.map((score) => score.raw)).toEqual([21, 21, 21, 21, 21, 21]);
  });
});
