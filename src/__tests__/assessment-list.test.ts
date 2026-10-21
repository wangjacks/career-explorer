import { describe, it, expect } from "vitest";
import {
  ASSESSMENT_QUIZ_PATH,
  assessmentCenterPayloadOf,
  buildAssessmentListItem,
  buildAssessmentList,
  deriveLatestActive,
  normalizeAssessmentList,
  quizHref,
  resultFormCopy,
  type AssessmentListItem,
} from "../lib/assessment-list";
import { deriveAssessmentCenter } from "../lib/assessment-center";
import { IPIP_NEO_FFI_CODE, RIASEC_CODE } from "../lib/assessment-data";

/** 造一套列表项（未在用例里覆盖的字段给稳定默认值） */
function item(overrides: Partial<AssessmentListItem> = {}): AssessmentListItem {
  return {
    code: RIASEC_CODE,
    name: "霍兰德职业兴趣测评",
    questionCount: 30,
    poolSize: 120,
    scoringMode: "typological",
    scaleVersion: "RIASEC 1.0",
    dimensions: [],
    status: "not-started",
    typeCode: null,
    completedAt: "",
    historyCount: 0,
    inProgress: null,
    attribution: "",
    licenseText: "",
    disclaimer: "",
    ...overrides,
  };
}

describe("buildAssessmentListItem：服务端逐套归一（#291）", () => {
  it("已完成：题量取本轮、题库取整库，三字码 / 完成时间 / 版本数来自当前结果", () => {
    const built = buildAssessmentListItem({
      assessment: {
        code: RIASEC_CODE,
        name: "霍兰德职业兴趣测评",
        scoringMode: "typological",
        scaleVersion: "RIASEC 1.0",
        dimensions: [{ key: "R", label: "现实型" }],
        attribution: "O*NET 署名",
        licenseText: "授权全文",
        disclaimer: "免责声明",
      },
      roundIndexes: Array.from({ length: 30 }, (_, i) => i + 1),
      bankIndexes: Array.from({ length: 120 }, (_, i) => i + 1),
      draft: null,
      completed: [
        { typeCode: "RIA", completedAt: "2026-10-20 09:30:00", isCurrent: true },
        { typeCode: "SIA", completedAt: "2026-10-19 08:00:00", isCurrent: false },
      ],
    });

    expect(built).toMatchObject({
      code: RIASEC_CODE,
      questionCount: 30,
      poolSize: 120,
      status: "completed",
      typeCode: "RIA",
      completedAt: "2026-10-20 09:30",
      historyCount: 2,
      inProgress: null,
      attribution: "O*NET 署名",
      licenseText: "授权全文",
      disclaimer: "免责声明",
    });
  });

  it("进行中：草稿只按本轮题号计进度，dimensional 量表没有三字码", () => {
    const built = buildAssessmentListItem({
      assessment: {
        code: IPIP_NEO_FFI_CODE,
        name: "五大人格测评（IPIP NEO-FFI 精简版）",
        scoringMode: "dimensional",
        scaleVersion: "IPIP NEO-FFI 1.0",
        dimensions: [{ key: "N", label: "神经质" }],
        attribution: "",
        licenseText: "",
        disclaimer: "",
      },
      roundIndexes: Array.from({ length: 50 }, (_, i) => i + 1),
      bankIndexes: Array.from({ length: 50 }, (_, i) => i + 1),
      draft: { answers: { 1: 3, 2: 4, 3: 5, 99: 1 }, updatedAt: "2026-10-20 10:00:00" },
      completed: [],
    });

    expect(built.status).toBe("in-progress");
    expect(built.inProgress).toEqual({ answered: 3, total: 50, updatedAt: "2026-10-20 10:00:00" });
    expect(built.typeCode).toBeNull();
    expect(built.questionCount).toBe(50);
    expect(built.poolSize).toBe(50);
  });

  it("重测：草稿优先于旧结果，旧三字码仍透出（与状态卡口径一致）", () => {
    const built = buildAssessmentListItem({
      assessment: {
        code: RIASEC_CODE,
        name: "霍兰德",
        scoringMode: "typological",
        scaleVersion: "RIASEC 1.0",
        dimensions: [],
        attribution: "",
        licenseText: "",
        disclaimer: "",
      },
      roundIndexes: [1, 2, 3],
      bankIndexes: [1, 2, 3],
      draft: { answers: { 1: 5 }, updatedAt: "2026-10-20 10:00:00" },
      completed: [{ typeCode: "SEC", completedAt: "2026-10-01 09:00:00", isCurrent: true }],
    });

    expect(built.status).toBe("in-progress");
    expect(built.typeCode).toBe("SEC");
    expect(built.historyCount).toBe(1);
  });

  it("草稿一题未答不展示进度（与 results 接口同一口径）", () => {
    const built = buildAssessmentListItem({
      assessment: {
        code: RIASEC_CODE,
        name: "霍兰德",
        scoringMode: "typological",
        scaleVersion: "RIASEC 1.0",
        dimensions: [],
        attribution: "",
        licenseText: "",
        disclaimer: "",
      },
      roundIndexes: [1, 2, 3],
      bankIndexes: [1, 2, 3],
      draft: { answers: {}, updatedAt: "2026-10-20 10:00:00" },
      completed: [],
    });

    expect(built.inProgress).toBeNull();
    expect(built.status).toBe("not-started");
  });
});

describe("normalizeAssessmentList：接口字段不可信（#291）", () => {
  it("两套量表各归一成一行，缺 code 的坏行直接丢弃", () => {
    const items = normalizeAssessmentList([
      {
        code: "riasec",
        name: "霍兰德",
        questionCount: 30,
        poolSize: 120,
        scoringMode: "typological",
        scaleVersion: "v1",
        dimensions: [{ key: "R", label: "现实型" }, { key: "", label: "废维" }],
        status: "completed",
        typeCode: "RIA",
        completedAt: "2026-10-20 09:30",
        historyCount: 2,
        inProgress: null,
      },
      {
        code: "ipip-neo-ffi",
        name: "五大人格",
        questionCount: 50,
        poolSize: 50,
        scoringMode: "dimensional",
        inProgress: { answered: 8, total: 50, updatedAt: "2026-10-20 10:00:00" },
      },
      { name: "没有标识的行" },
      null,
    ]);

    expect(items.map((entry) => entry.code)).toEqual(["riasec", "ipip-neo-ffi"]);
    expect(items[0]).toMatchObject({ status: "completed", typeCode: "RIA", historyCount: 2 });
    expect(items[0].dimensions).toEqual([{ key: "R", label: "现实型" }]);
    expect(items[1]).toMatchObject({
      status: "in-progress",
      scoringMode: "dimensional",
      typeCode: null,
      inProgress: { answered: 8, total: 50, updatedAt: "2026-10-20 10:00:00" },
    });
  });

  it("题量与题库冲突时收敛：题库不小于一次卷子、已答不超过总题数", () => {
    const [entry] = normalizeAssessmentList([
      { code: "riasec", questionCount: 30, poolSize: 20, inProgress: { answered: 99, total: 120 } },
    ]);
    expect(entry.questionCount).toBe(30);
    expect(entry.poolSize).toBe(30);
    expect(entry.inProgress).toEqual({ answered: 30, total: 30, updatedAt: "" });
  });

  it("状态字段异常时按「进行中 > 已完成 > 未开始」兜底，脏类型不产生 NaN", () => {
    const [byDraft, byResult, empty] = normalizeAssessmentList([
      { code: "a", status: "oops", questionCount: "30", inProgress: { answered: 1, total: 30 } },
      { code: "b", status: 42, typeCode: "RIA", questionCount: -5, poolSize: 120 },
      { code: "c", status: null },
    ]);

    expect(byDraft.status).toBe("in-progress");
    expect(byDraft.questionCount).toBe(0); // 字符串题量按 0，页面显示「题库准备中」
    expect(byDraft.scoringMode).toBe("typological");
    expect(Number.isFinite(byDraft.questionCount)).toBe(true);

    expect(byResult.status).toBe("completed");
    expect(byResult.poolSize).toBe(120);
    expect(byResult.typeCode).toBe("RIA");

    expect(empty.status).toBe("not-started");
    expect(empty.name).toBe("c"); // 缺名称回退为 code
  });

  it("非数组输入一律空列表（页面据此显示「暂无可用测评」）", () => {
    for (const raw of [null, undefined, {}, "oops", 42]) {
      expect(normalizeAssessmentList(raw)).toEqual([]);
    }
  });
});

describe("deriveLatestActive：最近活跃量表（#291）", () => {
  const riasec = item({ code: RIASEC_CODE });
  const ipip = item({
    code: IPIP_NEO_FFI_CODE,
    name: "五大人格",
    questionCount: 50,
    poolSize: 50,
    scoringMode: "dimensional",
  });

  it("有草稿优先：多个草稿取 updatedAt 最新的一套，即使另一套刚完成", () => {
    const latest = deriveLatestActive([
      item({ code: RIASEC_CODE, completedAt: "2026-10-20 12:00", typeCode: "RIA", status: "completed" }),
      item({ code: "a", inProgress: { answered: 3, total: 30, updatedAt: "2026-10-20 10:00" } }),
      item({ code: "b", inProgress: { answered: 5, total: 30, updatedAt: "2026-10-20 11:00" } }),
    ]);
    expect(latest?.code).toBe("b");
  });

  it("没有草稿时取最近完成的一套（completedAt 最新）", () => {
    const latest = deriveLatestActive([
      item({ code: "a", completedAt: "2026-10-19 10:00", typeCode: "RIA" }),
      item({ code: "b", completedAt: "2026-10-20 09:00", typeCode: "SEC" }),
    ]);
    expect(latest?.code).toBe("b");
  });

  it("都没有作答记录时回到主测评 riasec；主测评不在列表则取第一套", () => {
    expect(deriveLatestActive([ipip, riasec])?.code).toBe(RIASEC_CODE);
    expect(deriveLatestActive([ipip, item({ code: "other" })])?.code).toBe(IPIP_NEO_FFI_CODE);
  });

  it("时间相同保留列表靠前的一项（结果可复现），空列表返回 null", () => {
    const same = [
      item({ code: "a", completedAt: "2026-10-20 09:00", typeCode: "RIA" }),
      item({ code: "b", completedAt: "2026-10-20 09:00", typeCode: "SEC" }),
    ];
    expect(deriveLatestActive(same)?.code).toBe("a");
    for (const raw of [null, undefined, []]) {
      expect(deriveLatestActive(raw)).toBeNull();
    }
  });
});

describe("assessmentCenterPayloadOf：状态卡与清单同一口径（#291）", () => {
  it("已完成项还原成 deriveAssessmentCenter 的入参后，状态 / 三字码 / 版本数与列表项一致", () => {
    const entry = item({
      status: "completed",
      typeCode: "RIA",
      completedAt: "2026-10-20 09:30",
      historyCount: 10,
    });
    const view = deriveAssessmentCenter(assessmentCenterPayloadOf(entry));
    expect(view.status).toBe("completed");
    expect(view.typeCode).toBe("RIA");
    expect(view.completedAt).toBe("2026-10-20 09:30");
    expect(view.historyCount).toBe(10);
    expect(view.historyCapped).toBe(true);
    expect(view.questionCount).toBe(30);
    expect(view.poolSize).toBe(120);
  });

  it("进行中项带上草稿进度，draftComplete 由本轮题量判定", () => {
    const view = deriveAssessmentCenter(
      assessmentCenterPayloadOf(item({ status: "in-progress", inProgress: { answered: 30, total: 30, updatedAt: "" } }))
    );
    expect(view.status).toBe("in-progress");
    expect(view.draftComplete).toBe(true);
    expect(view.percent).toBe(100);
  });
});

describe("buildAssessmentList：清单行（#291 多量表）", () => {
  it("每套启用的量表各一行，入口带自己的 code（答题页 #289 按 ?code= 取量表）", () => {
    const rows = buildAssessmentList([
      item({ code: RIASEC_CODE, name: "霍兰德", status: "completed", typeCode: "RIA" }),
      item({
        code: IPIP_NEO_FFI_CODE,
        name: "五大人格",
        questionCount: 50,
        poolSize: 50,
        scoringMode: "dimensional",
        status: "in-progress",
        inProgress: { answered: 8, total: 50, updatedAt: "2026-10-20 10:00" },
      }),
    ]);

    expect(rows).toEqual([
      {
        code: RIASEC_CODE,
        name: "霍兰德",
        questionCount: 30,
        estimatedMinutes: 4,
        status: "completed",
        canStart: true,
        href: `${ASSESSMENT_QUIZ_PATH}?code=riasec`,
      },
      {
        code: IPIP_NEO_FFI_CODE,
        name: "五大人格",
        questionCount: 50,
        estimatedMinutes: 7,
        status: "in-progress",
        canStart: true,
        href: `${ASSESSMENT_QUIZ_PATH}?code=ipip-neo-ffi`,
      },
    ]);
  });

  it("题库为空时不给入口，但行仍保留（便于说明「题库准备中」）", () => {
    const rows = buildAssessmentList([item({ code: "empty", questionCount: 0, poolSize: 0 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ questionCount: 0, estimatedMinutes: 0, canStart: false });
  });

  it("空列表 / 非法输入返回空数组（页面据此不渲染清单卡）", () => {
    for (const raw of [null, undefined, []]) {
      expect(buildAssessmentList(raw)).toEqual([]);
    }
  });
});

describe("quizHref / resultFormCopy（#291）", () => {
  it("答题页地址按 code 编码，不把特殊字符拼进查询串", () => {
    expect(quizHref("riasec")).toBe("/dashboard/student/assessment/quiz?code=riasec");
    expect(quizHref("a b&c")).toBe("/dashboard/student/assessment/quiz?code=a%20b%26c");
  });

  it("结果形式按计分模式给文案：大五没有三字码", () => {
    expect(resultFormCopy("dimensional")).toBe("五大人格画像");
    expect(resultFormCopy("typological")).toBe("三字码 + 六型分布");
  });
});
