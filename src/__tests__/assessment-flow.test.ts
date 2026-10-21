import { describe, it, expect } from "vitest";
import {
  answerProgress,
  filterAnswersToBank,
  firstUnansweredIndex,
  formatResultTime,
  isValidAnswerValue,
  isValidQuestionIndex,
  mergeAnswer,
  parseAnswers,
  parseDimensions,
  parseScores,
  resumeIndex,
  resultSummaryCopy,
} from "../lib/assessment-flow";

describe("作答值校验", () => {
  it("题号与作答值只接受整数区间内的数字", () => {
    expect(isValidAnswerValue(1)).toBe(true);
    expect(isValidAnswerValue(5)).toBe(true);
    expect(isValidAnswerValue(0)).toBe(false);
    expect(isValidAnswerValue(6)).toBe(false);
    expect(isValidAnswerValue(4.5)).toBe(false);
    expect(isValidAnswerValue("4")).toBe(false); // 接口层严格：不接受字符串数字
    expect(isValidQuestionIndex(1)).toBe(true);
    expect(isValidQuestionIndex(0)).toBe(false);
    expect(isValidQuestionIndex(1.5)).toBe(false);
  });

  it("作答值仍与计分引擎的 1-5 量程对齐", () => {
    expect(isValidAnswerValue(1)).toBe(true);
    expect(isValidAnswerValue(5)).toBe(true);
    expect(isValidAnswerValue(0)).toBe(false);
    expect(isValidAnswerValue(6)).toBe(false);
  });
});

describe("结果摘要按计分模式分流（#289）", () => {
  it("typological：三字码 + 六型得分，提交文案讲三字码", () => {
    const copy = resultSummaryCopy("typological");
    expect(copy.showTypeCode).toBe(true);
    expect(copy.headline).toBe("你的职业兴趣三字码");
    expect(copy.scoresTitle).toBe("六型兴趣得分");
    expect(copy.answerGroupLabel).toBe("选择你对这个活动的意愿");
    expect(copy.submitHint).toContain("三字码");
    expect(copy.confirmMessage(30)).toContain("全部 30 题");
  });

  it("dimensional：五大画像 + 五维得分，任何文案都不出现三字码", () => {
    const copy = resultSummaryCopy("dimensional");
    expect(copy.showTypeCode).toBe(false);
    expect(copy.headline).toBe("五大人格画像");
    expect(copy.scoresTitle).toBe("五维人格得分");
    expect(copy.answerGroupLabel).toBe("选择这句话与你的符合程度");
    expect(copy.submitHint).toContain("五大人格得分");
    expect(copy.submitHint).not.toContain("三字码");
    expect(copy.confirmMessage(50)).toContain("全部 50 题");
    expect(copy.confirmMessage(50)).toContain("五大人格得分");
    expect(copy.confirmMessage(50)).not.toContain("三字码");
  });
});

describe("parseAnswers", () => {
  it("解析合法作答；容忍脏键（非法题号 / 非法值直接忽略）", () => {
    const raw = JSON.stringify({ "1": 4, "2": "5", "3": 9, "0": 2, abc: 1, "4": null });
    expect(parseAnswers(raw)).toEqual({ 1: 4, 2: 5 });
  });

  it("非法 JSON / 非对象 / 空值都返回空对象，不抛错", () => {
    expect(parseAnswers("not-json")).toEqual({});
    expect(parseAnswers("[1,2,3]")).toEqual({});
    expect(parseAnswers(null)).toEqual({});
    expect(parseAnswers("")).toEqual({});
  });
});

describe("filterAnswersToBank", () => {
  it("只保留当前题库存在的题号（题库换版后旧草稿的超纲题号不能带进计分）", () => {
    expect(filterAnswersToBank({ 1: 4, 2: 5, 31: 3 }, [1, 2, 3])).toEqual({ 1: 4, 2: 5 });
  });
});

describe("mergeAnswer", () => {
  it("返回新对象且覆盖同一题；非法入参抛错", () => {
    const before = { 1: 4 };
    const merged = mergeAnswer(before, 2, 5);
    expect(merged).toEqual({ 1: 4, 2: 5 });
    expect(before).toEqual({ 1: 4 }); // 不改入参
    expect(mergeAnswer(before, 1, 2)).toEqual({ 1: 2 });
    expect(() => mergeAnswer(before, 0, 3)).toThrow(/题号非法/);
    expect(() => mergeAnswer(before, 1, 6)).toThrow(/作答值非法/);
  });
});

describe("进度与续答落点", () => {
  const bank = [1, 2, 3, 4];

  it("进度只统计题库内的已答题", () => {
    expect(answerProgress({ 1: 4, 2: 3 }, bank)).toEqual({ answered: 2, total: 4, percent: 50 });
    expect(answerProgress({}, bank)).toEqual({ answered: 0, total: 4, percent: 0 });
    expect(answerProgress({ 1: 4 }, [])).toEqual({ answered: 0, total: 0, percent: 0 });
  });

  it("第一个未答题；全答完返回 null", () => {
    expect(firstUnansweredIndex({ 1: 4 }, bank)).toBe(2);
    expect(firstUnansweredIndex({ 1: 4, 2: 3, 3: 2, 4: 1 }, bank)).toBeNull();
  });

  it("续答落点：首个未答；已全部答完则停在末题（便于检查后再提交）", () => {
    expect(resumeIndex({ 1: 4 }, bank)).toBe(2);
    expect(resumeIndex({}, bank)).toBe(1);
    expect(resumeIndex({ 1: 4, 2: 3, 3: 2, 4: 1 }, bank)).toBe(4);
    expect(resumeIndex({}, [])).toBe(1); // 空题库不除零、不返回 0
  });
});

describe("解析快照与元信息", () => {
  it("parseDimensions：逐项忽略脏数据", () => {
    expect(parseDimensions(JSON.stringify([{ key: "R", label: "现实型" }, { key: 1 }, null, { label: "x" }]))).toEqual([
      { key: "R", label: "现实型" },
    ]);
    expect(parseDimensions("not-json")).toEqual([]);
    expect(parseDimensions(null)).toEqual([]);
  });

  it("parseScores：缺 standard / 非数值的条目被丢弃，其余字段补默认值（渲染层不会拿到会崩的形状）", () => {
    const complete = [
      {
        key: "R",
        label: "现实型",
        standard: 75,
        questionCount: 5,
        answered: 5,
        raw: 20,
        minPossible: 5,
        maxPossible: 25,
      },
    ];
    expect(parseScores(JSON.stringify(complete))).toEqual(complete);

    // 缺 standard 的条目会让结果页 `standard.toFixed(1)` 崩，必须丢弃
    expect(parseScores(JSON.stringify([{ key: "R" }, { label: "无 key" }, { key: "I", standard: "80" }, 3, null]))).toEqual([]);

    // 其它字段缺失时补默认值，拿到的是可直接渲染的完整形状
    expect(parseScores(JSON.stringify([{ key: "S", standard: 60 }]))).toEqual([
      {
        key: "S",
        label: "S",
        questionCount: 0,
        answered: 0,
        raw: 0,
        minPossible: 0,
        maxPossible: 0,
        standard: 60,
      },
    ]);
    // band 只在合法时才透传
    expect(parseScores(JSON.stringify([{ key: "E", label: "企业型", standard: 50, band: "high" }]))[0].band).toBe("high");
    expect(parseScores(JSON.stringify([{ key: "C", standard: 40, band: "unknown" }]))[0].band).toBeUndefined();

    expect(parseScores("not-json")).toEqual([]);
    expect(parseScores(null)).toEqual([]);
  });

  it("formatResultTime：库内 TEXT 原样保留，ISO 串去掉 T 并裁到分钟", () => {
    expect(formatResultTime("2026-10-20 10:30:00")).toBe("2026-10-20 10:30");
    expect(formatResultTime("2026-10-20T10:30:00.000Z")).toBe("2026-10-20 10:30");
    expect(formatResultTime(null)).toBe("");
    expect(formatResultTime("  ")).toBe("");
  });
});
