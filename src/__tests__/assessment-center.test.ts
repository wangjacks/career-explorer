import { describe, it, expect } from "vitest";
import {
  ESTIMATE_SECONDS_PER_QUESTION,
  MIN_ESTIMATED_MINUTES,
  deriveAssessmentCenter,
  estimateMinutes,
  progressPercent,
} from "../lib/assessment-center";

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
