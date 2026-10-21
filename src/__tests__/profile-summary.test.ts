import { describe, it, expect } from "vitest";
import {
  ASSESSMENT_RESULTS_ID,
  PROFILE_INFO_ID,
  assessmentDetailId,
  buildProfileSummary,
  type BuildProfileSummaryInput,
} from "../lib/profile-summary";
import { buildBigFiveBars, buildBigFiveHeadline, buildRiasecBars } from "../lib/assessment-view";
import type { AssessmentListItem } from "../lib/assessment-list";
import type { AssessmentResultsPayload } from "../lib/assessment-view";
import type { DimensionScore } from "../lib/assessment-scoring";

const RIASEC_DIMENSIONS = [
  { key: "R", label: "现实型" },
  { key: "I", label: "研究型" },
  { key: "A", label: "艺术型" },
  { key: "S", label: "社会型" },
  { key: "E", label: "企业型" },
  { key: "C", label: "常规型" },
];

const BIG_FIVE_DIMENSIONS = [
  { key: "N", label: "神经质" },
  { key: "E", label: "外向性" },
  { key: "O", label: "开放性" },
  { key: "A", label: "宜人性" },
  { key: "C", label: "尽责性" },
];

function score(key: string, label: string, standard: number): DimensionScore {
  return {
    key,
    label,
    questionCount: 5,
    answered: 5,
    raw: 20,
    minPossible: 5,
    maxPossible: 25,
    standard,
  };
}

const HOLLAND_SCALE = {
  code: "riasec",
  name: "霍兰德职业兴趣测评",
  scoringMode: "typological",
  dimensions: RIASEC_DIMENSIONS,
} as AssessmentListItem;

const BIG_FIVE_SCALE = {
  code: "ipip-neo-ffi",
  name: "大五人格测评",
  scoringMode: "dimensional",
  dimensions: BIG_FIVE_DIMENSIONS,
} as AssessmentListItem;

const HOLLAND_RESULT: AssessmentResultsPayload = {
  assessment: {
    code: "riasec",
    name: "霍兰德职业兴趣测评",
    questionCount: 30,
    scaleVersion: "1.0",
    dimensions: RIASEC_DIMENSIONS,
    attribution: "",
    licenseText: "",
    disclaimer: "",
    scoringMode: "typological",
  },
  current: {
    id: 1,
    typeCode: "SIA",
    scores: [
      score("R", "现实型", 30),
      score("I", "研究型", 72),
      score("A", "艺术型", 65),
      score("S", "社会型", 88),
      score("E", "企业型", 40),
      score("C", "常规型", 50),
    ],
    completedAt: "2026-10-20 10:00",
    isCurrent: true,
  },
  history: [],
  inProgress: null,
};

const BIG_FIVE_RESULT: AssessmentResultsPayload = {
  assessment: {
    code: "ipip-neo-ffi",
    name: "大五人格测评",
    questionCount: 50,
    scaleVersion: "1.0",
    dimensions: BIG_FIVE_DIMENSIONS,
    attribution: "",
    licenseText: "",
    disclaimer: "",
    scoringMode: "dimensional",
  },
  current: {
    id: 2,
    typeCode: null,
    scores: [
      score("N", "神经质", 20),
      score("E", "外向性", 80),
      score("O", "开放性", 60),
      score("A", "宜人性", 55),
      score("C", "尽责性", 88),
    ],
    completedAt: "2026-10-20 09:00",
    isCurrent: true,
  },
  history: [],
  inProgress: null,
};

const CAREERS = [
  { code: "29-1141.00", displayName: "注册护士", englishName: "Registered Nurses", hasChineseName: true, meta: "医疗健康 · 本科" },
  { code: "25-2021.00", displayName: "小学教师", englishName: "Elementary School Teachers", hasChineseName: true, meta: "教育培训 · 本科" },
  { code: "11-1011.00", displayName: "Chief Executives", englishName: "Chief Executives", hasChineseName: false, meta: "管理 · 研究生" },
  { code: "99-0001.00", displayName: "第四个职业", englishName: "Fourth", hasChineseName: true, meta: "" },
];

const SUBMITTED_PROFILE = {
  tags: ["摄影", "编程", "音乐", "阅读", "旅行", "运动", "手工"],
  avatarUrl: "/api/uploads/avatar_1.jpg",
  evaluationUrl: "/api/uploads/eval_1.jpg",
  submitted: true,
};

function build(overrides: Partial<BuildProfileSummaryInput> = {}) {
  return buildProfileSummary({
    profile: SUBMITTED_PROFILE,
    scales: [HOLLAND_SCALE, BIG_FIVE_SCALE],
    results: { riasec: HOLLAND_RESULT, "ipip-neo-ffi": BIG_FIVE_RESULT },
    careers: CAREERS,
    ...overrides,
  });
}

function cardOf(summary: ReturnType<typeof build>, kind: "interest" | "personality" | "careers" | "profile") {
  const card = summary.cards.find((item) => item.kind === kind);
  if (!card) throw new Error(`missing card: ${kind}`);
  return card;
}

describe("速览四卡：正常有结果", () => {
  it("兴趣卡：三字码 + 主导三型 + Top3 分数条（与详情同一 builders）", () => {
    const card = cardOf(build(), "interest");
    expect(card.state).toBe("ready");
    expect(card.code).toBe("SIA");
    expect(card.headline).toBe("社会型 · 研究型 · 艺术型");
    expect(card.bars).toHaveLength(3);
    expect(card.cta).toMatchObject({ action: "detail", targetId: assessmentDetailId("riasec") });

    const expected = buildRiasecBars(HOLLAND_RESULT.current!.scores, "SIA")
      .slice(0, 3)
      .map((bar) => ({ label: bar.label, standard: bar.standard, percent: bar.percent }));
    expect(card.bars).toEqual(expected);
  });

  it("人格卡：Top2 特质 headline + Top2 分数条", () => {
    const card = cardOf(build(), "personality");
    expect(card.state).toBe("ready");
    expect(card.headline).toBe(buildBigFiveHeadline(BIG_FIVE_RESULT.current!.scores, BIG_FIVE_DIMENSIONS));
    expect(card.headline).toBe("高尽责性 · 高外向性");
    expect(card.bars).toHaveLength(2);
    expect(card.cta).toMatchObject({ action: "detail", targetId: assessmentDetailId("ipip-neo-ffi") });

    const expected = buildBigFiveBars(BIG_FIVE_RESULT.current!.scores, BIG_FIVE_DIMENSIONS)
      .slice(0, 2)
      .map((bar) => ({ label: bar.label, standard: bar.standard, percent: bar.percent }));
    expect(card.bars).toEqual(expected);
  });

  it("推荐职业卡：Top3，中文名优先、英文名兜底", () => {
    const card = cardOf(build(), "careers");
    expect(card.state).toBe("ready");
    expect(card.items).toHaveLength(3);
    expect(card.items!.map((item) => item.title)).toEqual(["注册护士", "小学教师", "Chief Executives"]);
    // 无中文译名时不重复展示英文名，只留职业群·学历
    expect(card.items![2].subtitle).toBe("管理 · 研究生");
    expect(card.cta).toMatchObject({ action: "detail", targetId: assessmentDetailId("riasec") });
  });

  it("资料卡：4–6 个标签 + 三项完成度 + 查看详情", () => {
    const card = cardOf(build(), "profile");
    expect(card.state).toBe("ready");
    expect(card.tokens).toHaveLength(6);
    expect(card.completion).toEqual([
      { label: "标签", done: true },
      { label: "头像", done: true },
      { label: "评价词云", done: true },
    ]);
    expect(card.headline).toBe("已完成 3/3 项资料");
    expect(card.cta).toMatchObject({ action: "profile", targetId: PROFILE_INFO_ID });
  });
});

describe("速览四卡：空态与降级", () => {
  it("未测兴趣：空态 +「去测评」带 code；有草稿时「继续作答」", () => {
    const noResult = build({
      results: { "ipip-neo-ffi": BIG_FIVE_RESULT },
    });
    const card = cardOf(noResult, "interest");
    expect(card.state).toBe("empty");
    expect(card.cta).toMatchObject({ action: "quiz" });
    expect(card.cta.href).toContain("code=riasec");

    const drafting = build({
      results: { riasec: { ...HOLLAND_RESULT, current: null, inProgress: { answered: 12, total: 30, updatedAt: "2026-10-20 11:00" } } },
    });
    const draftCard = cardOf(drafting, "interest");
    expect(draftCard.state).toBe("empty");
    expect(draftCard.headline).toBe("兴趣测评还没答完");
    expect(draftCard.cta.label).toBe("继续作答");
  });

  it("人格量表未启用：降级为「暂未开放」，不误报未测", () => {
    const card = cardOf(build({ scales: [HOLLAND_SCALE] }), "personality");
    expect(card.state).toBe("degraded");
    expect(card.headline).toBe("人格测评暂未开放");
    expect(card.cta).toMatchObject({ action: "detail", targetId: ASSESSMENT_RESULTS_ID });
  });

  it("有霍兰德结果但没有推荐：失败与为空给不同文案，都指向兴趣详情", () => {
    const failed = cardOf(build({ careers: [], careersFailed: true }), "careers");
    expect(failed.state).toBe("degraded");
    expect(failed.headline).toBe("推荐职业暂时没取到");
    expect(failed.cta).toMatchObject({ action: "detail", targetId: assessmentDetailId("riasec") });

    const empty = cardOf(build({ careers: [] }), "careers");
    expect(empty.state).toBe("degraded");
    expect(empty.headline).toBe("还没有匹配到推荐职业");
  });

  it("没有霍兰德结果时推荐职业卡为空态（去测评）", () => {
    const card = cardOf(build({ results: {} }), "careers");
    expect(card.state).toBe("empty");
    expect(card.cta).toMatchObject({ action: "quiz" });
  });

  it("清单失败：三张测评卡降级到结果区，资料卡不受影响", () => {
    const summary = build({ scales: [], results: {}, listFailed: true, careers: [] });
    for (const kind of ["interest", "personality", "careers"] as const) {
      const card = cardOf(summary, kind);
      expect(card.state).toBe("degraded");
      expect(card.cta).toMatchObject({ action: "detail", targetId: ASSESSMENT_RESULTS_ID });
    }
    expect(cardOf(summary, "profile").state).toBe("ready");
  });

  it("资料卡：未归档 →「开始填写」；词云未传 →「补充评价词云」（都是编辑态）", () => {
    const unsubmitted = cardOf(
      build({ profile: { tags: [], avatarUrl: "", evaluationUrl: "", submitted: false } }),
      "profile"
    );
    expect(unsubmitted.state).toBe("ready");
    expect(unsubmitted.headline).toBe("档案还没提交");
    expect(unsubmitted.cta).toMatchObject({ action: "edit", label: "开始填写" });

    const noEvaluation = cardOf(
      build({ profile: { tags: ["摄影"], avatarUrl: "/a.jpg", evaluationUrl: "", submitted: true } }),
      "profile"
    );
    expect(noEvaluation.cta).toMatchObject({ action: "edit", label: "补充评价词云" });
  });

  it("档案资料缺失（接口失败）时资料卡降级，其它卡照常", () => {
    const summary = build({ profile: null });
    expect(cardOf(summary, "profile").state).toBe("degraded");
    expect(cardOf(summary, "interest").state).toBe("ready");
  });
});
