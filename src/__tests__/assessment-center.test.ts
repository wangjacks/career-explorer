import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  ESTIMATE_SECONDS_PER_QUESTION,
  MIN_ESTIMATED_MINUTES,
  deriveAssessmentCenter,
  estimateMinutes,
  progressPercent,
} from "../lib/assessment-center";
import { MAX_RESULT_VERSIONS } from "../lib/assessment-flow";

describe("estimateMinutes / progressPercent", () => {
  it("耗时按单题秒数向上取整，最少 1 分钟，题量非法返回 0", () => {
    expect(estimateMinutes(30)).toBe(Math.ceil((30 * ESTIMATE_SECONDS_PER_QUESTION) / 60));
    expect(estimateMinutes(30)).toBe(4); // 30 题 ≈ 4 分钟
    expect(estimateMinutes(1)).toBe(MIN_ESTIMATED_MINUTES);
    expect(estimateMinutes(0)).toBe(0);
    expect(estimateMinutes(Number.NaN)).toBe(0);
    expect(estimateMinutes(-5)).toBe(0);
  });

  it("进度百分比：四舍五入、钳在 0–100、总数为 0 不出 NaN", () => {
    expect(progressPercent(10, 30)).toBe(33);
    expect(progressPercent(0, 30)).toBe(0);
    expect(progressPercent(30, 30)).toBe(100);
    expect(progressPercent(30, 0)).toBe(0);
    expect(progressPercent(-3, 10)).toBe(0);
    expect(progressPercent(99, 10)).toBe(100);
  });
});

describe("档案页耗时文案（#286）", () => {
  it("复用测评中心的题量与耗时视图，不再写死题量或分钟数", () => {
    const source = readFileSync(
      new URL("../components/student/AssessmentResultCard.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("const assessmentView = deriveAssessmentCenter(data)");
    expect(source).toContain("assessmentView.questionCount");
    expect(source).toContain("assessmentView.estimatedMinutes");
    expect(source).not.toMatch(/\d+\s*道题/);
    expect(source).not.toMatch(/\d+\s*分钟/);
  });
});

describe("题量口径来源守卫（#283）", () => {
  const SOURCES = [
    "../app/dashboard/student/assessment/page.tsx",
    "../app/dashboard/student/assessment/quiz/page.tsx",
    "../components/student/AssessmentResultCard.tsx",
  ] as const;

  it("学生端不写死题量与分钟数（一律来自接口字段或 estimateMinutes）", () => {
    for (const rel of SOURCES) {
      const source = readFileSync(new URL(rel, import.meta.url), "utf8");
      // 允许「每次 {view.questionCount} 题」这类表达式，不允许出现字面量数字 + 题/分钟
      expect(source, rel).not.toMatch(/\d+\s*(?:道题|题|分钟)/);
    }
  });

  it("题库规模只出现在测评中心 Fact 与答题页抽题说明里，且取自接口的 poolSize", () => {
    const center = readFileSync(new URL(SOURCES[0], import.meta.url), "utf8");
    const quiz = readFileSync(new URL(SOURCES[1], import.meta.url), "utf8");
    const card = readFileSync(new URL(SOURCES[2], import.meta.url), "utf8");

    expect(center).toContain("view.poolSize");
    expect(quiz).toContain("start.assessment.poolSize");
    // 档案侧只关心本人作答量，不出现题库规模
    expect(card).not.toContain("poolSize");
  });

  it("档案页的草稿进度复用归一视图，不再自己读接口的 answered / total（两处口径同一来源）", () => {
    const card = readFileSync(new URL(SOURCES[2], import.meta.url), "utf8");
    expect(card).toContain("上次答到 {assessmentView.answered}/{assessmentView.total} 题");
    expect(card).not.toMatch(/inProgress\.\s*(answered|total)/);
  });
});

const ASSESSMENT = { questionCount: 30, enabled: true };

describe("列表接口只下发条数（#291）", () => {
  it("没有 history 数组时用 historyCount 算结果版本数，撞上限同样标记 historyCapped", () => {
    const view = deriveAssessmentCenter({
      assessment: ASSESSMENT,
      current: { typeCode: "RIA", completedAt: "2026-10-19 10:00:00" },
      historyCount: 3,
      inProgress: null,
    });
    expect(view.historyCount).toBe(3);
    expect(view.historyCapped).toBe(false);

    const capped = deriveAssessmentCenter({
      assessment: ASSESSMENT,
      current: { typeCode: "RIA", completedAt: "2026-10-19 10:00:00" },
      historyCount: MAX_RESULT_VERSIONS,
    });
    expect(capped.historyCapped).toBe(true);
  });

  it("history 数组优先于 historyCount（results 接口仍按数组长度），脏计数不产生 NaN", () => {
    const view = deriveAssessmentCenter({
      assessment: ASSESSMENT,
      current: { typeCode: "RIA", completedAt: "2026-10-19 10:00:00" },
      history: [{ id: 1 }, { id: 2 }],
      historyCount: 99,
    });
    expect(view.historyCount).toBe(2);

    const dirty = deriveAssessmentCenter({ assessment: ASSESSMENT, historyCount: "3" });
    expect(dirty.historyCount).toBe(0);
  });
});

describe("deriveAssessmentCenter：三种状态分支（#222）", () => {
  it("未开始：无结果无草稿 → 给出题量与耗时，进度为 0", () => {
    const view = deriveAssessmentCenter({ assessment: ASSESSMENT, current: null, history: [], inProgress: null });
    expect(view.status).toBe("not-started");
    expect(view.questionCount).toBe(30);
    expect(view.estimatedMinutes).toBe(4);
    expect(view.answered).toBe(0);
    expect(view.total).toBe(30);
    expect(view.percent).toBe(0);
    expect(view.typeCode).toBeNull();
    expect(view.completedAt).toBe("");
    expect(view.historyCount).toBe(0);
    expect(view.enabled).toBe(true);
  });

  it("进行中：草稿有进度 → 已答 / 总题数与百分比，并保留上次三字码", () => {
    const view = deriveAssessmentCenter({
      assessment: ASSESSMENT,
      current: { typeCode: "RIA", completedAt: "2026-10-19 10:00:00" },
      history: [{ id: 1 }],
      inProgress: { answered: 12, total: 30 },
    });
    // 重测时草稿优先：最该做的是把这一轮答完
    expect(view.status).toBe("in-progress");
    expect(view.answered).toBe(12);
    expect(view.total).toBe(30);
    expect(view.percent).toBe(40);
    expect(view.typeCode).toBe("RIA");
    expect(view.completedAt).toBe("2026-10-19 10:00");
    expect(view.historyCount).toBe(1);
    expect(view.draftComplete).toBe(false);
  });

  it("进行中且题目全部答完（只差提交）：draftComplete=true，文案切「去提交」而不是「答到第 30 题」", () => {
    const view = deriveAssessmentCenter({
      assessment: ASSESSMENT,
      current: null,
      history: [],
      inProgress: { answered: 30, total: 30 },
    });
    expect(view.status).toBe("in-progress");
    expect(view.draftComplete).toBe(true);
    expect(view.answered).toBe(30);
    expect(view.percent).toBe(100);
  });

  it("结果版本数撞接口上限时标记 historyCapped（页面显示 10+ 而不是谎报 10 次）", () => {
    const atCap = deriveAssessmentCenter({
      assessment: ASSESSMENT,
      current: { typeCode: "SIA", completedAt: "2026-10-20 09:30:00" },
      history: Array.from({ length: MAX_RESULT_VERSIONS }, (_, i) => ({ id: i + 1 })),
      inProgress: null,
    });
    expect(atCap.historyCount).toBe(MAX_RESULT_VERSIONS);
    expect(atCap.historyCapped).toBe(true);

    const belowCap = deriveAssessmentCenter({
      assessment: ASSESSMENT,
      current: { typeCode: "SIA", completedAt: "2026-10-20 09:30:00" },
      history: [{ id: 1 }, { id: 2 }],
      inProgress: null,
    });
    expect(belowCap.historyCapped).toBe(false);
  });

  it("已完成：有当前结果 → 三字码 + 完成时间（ISO 串裁到分钟）", () => {
    const view = deriveAssessmentCenter({
      assessment: ASSESSMENT,
      current: { typeCode: "SIA", completedAt: "2026-10-20T09:30:00.000Z" },
      history: [{ id: 1 }, { id: 2 }],
      inProgress: null,
    });
    expect(view.status).toBe("completed");
    expect(view.typeCode).toBe("SIA");
    expect(view.completedAt).toBe("2026-10-20 09:30");
    expect(view.historyCount).toBe(2);
    expect(view.answered).toBe(0);
    expect(view.percent).toBe(0);
  });

  it("dimensional 量表（无三字码）也算已完成，三字码为 null", () => {
    const view = deriveAssessmentCenter({
      assessment: ASSESSMENT,
      current: { typeCode: null, completedAt: "2026-10-20 09:30:00" },
      history: [],
      inProgress: null,
    });
    expect(view.status).toBe("completed");
    expect(view.typeCode).toBeNull();
  });

  it("停用量表：enabled=false 透传，状态判定不受影响（历史仍可看）", () => {
    const view = deriveAssessmentCenter({
      assessment: { questionCount: 30, enabled: false },
      current: { typeCode: "RIA", completedAt: "2026-10-19 10:00:00" },
      history: [],
      inProgress: null,
    });
    expect(view.enabled).toBe(false);
    expect(view.status).toBe("completed");
  });

  it("接口没给 enabled（旧版本）时按开放处理，不误伤入口", () => {
    const view = deriveAssessmentCenter({ assessment: { questionCount: 30 } });
    expect(view.enabled).toBe(true);
    expect(view.status).toBe("not-started");
  });

  it("脏数据不产生 NaN / 越界：负数、字符串、超大已答数、错误类型全部归一", () => {
    const view = deriveAssessmentCenter({
      assessment: { questionCount: "30" as unknown, enabled: "yes" as unknown },
      current: { typeCode: 42 as unknown, completedAt: 123 as unknown },
      history: "oops" as unknown,
      inProgress: { answered: 999, total: 30 },
    });
    expect(view.questionCount).toBe(0); // 非数值题量按 0 处理，页面显示「—」
    expect(view.enabled).toBe(true); // 只把显式 false 当停用
    expect(view.status).toBe("in-progress");
    expect(view.answered).toBe(30); // 已答钳到总题数
    expect(view.percent).toBe(100);
    expect(view.typeCode).toBeNull();
    expect(view.completedAt).toBe("");
    expect(view.historyCount).toBe(0);
  });

  it("payload 为 null / 空对象时退化成未开始，不抛错", () => {
    for (const payload of [null, undefined, {}]) {
      const view = deriveAssessmentCenter(payload);
      expect(view.status).toBe("not-started");
      expect(view.questionCount).toBe(0);
      expect(view.estimatedMinutes).toBe(0);
      expect(view.percent).toBe(0);
    }
  });
});

describe("题量口径分离：每次题量 vs 题库总量（#283）", () => {
  it("poolSize=120、questionCount=30：题量按每次算，耗时不变，题库规模单独透出", () => {
    const view = deriveAssessmentCenter({ assessment: { questionCount: 30, poolSize: 120, enabled: true } });
    expect(view.questionCount).toBe(30);
    expect(view.poolSize).toBe(120);
    // 耗时只跟每次题量走：120 题的 16 分钟不能漏到这里
    expect(view.estimatedMinutes).toBe(4);
    expect(estimateMinutes(120)).toBe(16);
    expect(view.total).toBe(30);
  });

  it("poolSize 缺失（旧接口）：回退为每次题量，页面据此不显示「从 N 题中抽取」", () => {
    const view = deriveAssessmentCenter({ assessment: { questionCount: 30 } });
    expect(view.poolSize).toBe(30);
    expect(view.questionCount).toBe(30);
  });

  it("本轮题量与题库规模冲突（poolSize < questionCount）：题库按每次题量收敛", () => {
    const view = deriveAssessmentCenter({ assessment: { questionCount: 30, poolSize: 20 } });
    expect(view.questionCount).toBe(30);
    expect(view.poolSize).toBe(30);
  });

  it("questionCount 异常但 poolSize 合法：题量归零不影响题库规模，也不产生 NaN", () => {
    for (const bad of ["30", Number.NaN, -5, null]) {
      const view = deriveAssessmentCenter({ assessment: { questionCount: bad as unknown, poolSize: 120 } });
      expect(view.questionCount).toBe(0);
      expect(view.poolSize).toBe(120);
      expect(Number.isFinite(view.estimatedMinutes)).toBe(true);
      expect(view.estimatedMinutes).toBe(0);
    }
  });

  it("进行中草稿总数大于本次题量（旧口径 120）：分母收敛为本次题量，不出现 12/120", () => {
    const view = deriveAssessmentCenter({
      assessment: { questionCount: 30, poolSize: 120 },
      inProgress: { answered: 12, total: 120 },
    });
    expect(view.status).toBe("in-progress");
    expect(view.answered).toBe(12);
    expect(view.total).toBe(30);
    expect(view.percent).toBe(40);
  });

  it("草稿总数与本次题量冲突（脏数据更小）时分母仍取本轮题量，不被脏值提前判定为可提交", () => {
    const view = deriveAssessmentCenter({
      assessment: { questionCount: 30, poolSize: 120 },
      inProgress: { answered: 5, total: 10 },
    });
    expect(view.total).toBe(30);
    expect(view.answered).toBe(5);
    expect(view.percent).toBe(17);
    expect(view.draftComplete).toBe(false);
  });
});

