import { describe, it, expect } from "vitest";
import {
  ESTIMATE_SECONDS_PER_QUESTION,
  MIN_ESTIMATED_MINUTES,
  buildAssessmentList,
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

const ASSESSMENT = { questionCount: 30, enabled: true };

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

describe("buildAssessmentList：测验列表卡（#225）", () => {
  it("单套量表 → 一行，题量/耗时/状态/可开始都来自同一份归一结果", () => {
    const payload = {
      assessment: { code: "riasec", name: "霍兰德职业兴趣测评", questionCount: 30, enabled: true },
      current: { typeCode: "RIA", completedAt: "2026-10-19 10:00:00" },
      history: [{ id: 1 }],
      inProgress: null,
    };
    const rows = buildAssessmentList(payload);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      code: "riasec",
      name: "霍兰德职业兴趣测评",
      questionCount: 30,
      estimatedMinutes: 4,
      status: "completed",
      enabled: true,
      canStart: true,
      isPrimary: true,
    });
  });

  it("进行中/未开始的三态与顶部状态卡一致（复用同一次判定，不各算一套）", () => {
    const assessment = { code: "riasec", name: "霍兰德", questionCount: 30, enabled: true };
    expect(buildAssessmentList({ assessment, inProgress: { answered: 5, total: 30 } })[0].status).toBe("in-progress");
    expect(buildAssessmentList({ assessment, current: null, history: [] })[0].status).toBe("not-started");
  });

  it("停用或题库为空时 canStart=false（列表卡不给入口，与状态卡口径一致）", () => {
    const disabled = buildAssessmentList({ assessment: { code: "riasec", name: "霍兰德", questionCount: 30, enabled: false } });
    expect(disabled[0]).toMatchObject({ enabled: false, canStart: false });

    const empty = buildAssessmentList({ assessment: { code: "riasec", name: "霍兰德", questionCount: 0, enabled: true } });
    expect(empty[0]).toMatchObject({ questionCount: 0, estimatedMinutes: 0, canStart: false });
  });

  it("多量表预留：接口返回 assessments 数组时每项一行，主测评保留本人状态，其余按未开始", () => {
    const payload = {
      assessment: { code: "riasec", name: "霍兰德", questionCount: 30, enabled: true },
      assessments: [
        { code: "riasec", name: "霍兰德", questionCount: 30, enabled: true },
        { code: "big-five", name: "大五人格", questionCount: 60, enabled: true },
      ],
      current: { typeCode: "RIA", completedAt: "2026-10-19 10:00:00" },
      history: [],
    };
    const rows = buildAssessmentList(payload);
    expect(rows.map((row) => row.code)).toEqual(["riasec", "big-five"]);
    expect(rows[0].status).toBe("completed");
    expect(rows[1].status).toBe("not-started");
    expect(rows[1].estimatedMinutes).toBe(estimateMinutes(60));
    // 只有主测评带作答入口：答题页目前只认 RIASEC，预留项给「即将开放」而不是错链接
    expect(rows.map((row) => row.isPrimary)).toEqual([true, false]);
    expect(rows.map((row) => row.canStart)).toEqual([true, true]);
  });

  it("缺 code 的行被丢弃（列表卡必须能定位到可作答的量表），脏字段不产生 NaN", () => {
    const rows = buildAssessmentList({
      assessment: { code: "  ", name: "幽灵量表", questionCount: 30 },
      assessments: [
        { code: "riasec", name: "霍兰德", questionCount: "30", enabled: "yes" },
        { code: "", name: "废行" },
      ],
    });
    expect(rows.map((row) => row.code)).toEqual(["riasec"]);
    expect(rows[0].questionCount).toBe(0); // 字符串题量按 0，页面显示「题库准备中」
    expect(Number.isFinite(rows[0].estimatedMinutes)).toBe(true);
  });

  it("只有 assessments 数组、没有主量表时全部按预留项处理（不给作答入口）", () => {
    const rows = buildAssessmentList({ assessments: [{ code: "riasec", name: "霍兰德", questionCount: 30 }] });
    expect(rows[0]).toMatchObject({ isPrimary: false, status: "not-started", canStart: true });
  });

  it("payload 为空或没有量表 → 空列表（页面据此不渲染列表卡）", () => {
    for (const payload of [null, undefined, {}, { assessment: null }]) {
      expect(buildAssessmentList(payload)).toEqual([]);
    }
  });
});
