import { describe, it, expect } from "vitest";
import {
  buildTeacherAssessmentDetail,
  buildTeacherCareers,
  buildTeacherProfileSummary,
  resolveSummaryActionTarget,
  toAssessmentListItem,
  toAssessmentResultsPayload,
  toSummaryProfileInput,
  type TeacherProfileDetailRow,
} from "@/lib/profile-detail-data";
import type { ProfileAssessmentScaleView, ProfileScaleResultView } from "@/lib/profile-assessment";
import type { SummaryCard } from "@/lib/profile-summary";

/**
 * #332 教师端档案详情：列表行 → 共享卡片视图模型的适配（纯函数）。
 *
 * 关键验收：
 * - 弹窗的速览/详情卡与学生端消费**同一份**视图模型（这里锁住适配口径）；
 * - 未测/缺失数据降级，不伪造分数；
 * - 教师受众不出现「去测评 / 编辑」这类学生动作。
 */

const RIASEC_SCORES = [
  { key: "S", standard: 92 },
  { key: "I", standard: 84 },
  { key: "A", standard: 76 },
  { key: "E", standard: 50 },
  { key: "C", standard: 40 },
  { key: "R", standard: 30 },
];

const BIG_FIVE_SCORES = [
  { key: "N", standard: 40 },
  { key: "E", standard: 82 },
  { key: "O", standard: 70 },
  { key: "A", standard: 60 },
  { key: "C", standard: 90 },
];

const SCALES: ProfileAssessmentScaleView[] = [
  {
    code: "riasec",
    name: "霍兰德职业兴趣测评",
    scoringMode: "typological",
    dimensions: [
      { key: "R", label: "现实型" },
      { key: "I", label: "研究型" },
      { key: "A", label: "艺术型" },
      { key: "S", label: "社会型" },
      { key: "E", label: "企业型" },
      { key: "C", label: "常规型" },
    ],
    scaleVersion: "RIASEC-CN 2.0",
    questionCount: 30,
    poolSize: 120,
    attribution: "O*NET 署名文本",
    licenseText: "O*NET 授权文本",
    disclaimer: "兴趣结果只用于生涯探索。",
  },
  {
    code: "ipip-neo-ffi",
    name: "五大人格测评",
    scoringMode: "dimensional",
    dimensions: [
      { key: "N", label: "神经质" },
      { key: "E", label: "外向性" },
      { key: "O", label: "开放性" },
      { key: "A", label: "宜人性" },
      { key: "C", label: "尽责性" },
    ],
    scaleVersion: "IPIP NEO-FFI 1.0",
    questionCount: 50,
    poolSize: 50,
    attribution: "IPIP 公有领域",
    licenseText: "IPIP 授权文本",
    disclaimer: "人格结果只用于生涯探索。",
  },
];

function result(overrides: Partial<ProfileScaleResultView> = {}): ProfileScaleResultView {
  return {
    status: "completed",
    typeCode: null,
    completedAt: "2026-10-20 10:00:00",
    scores: [],
    ...overrides,
  };
}

const RESULTS: Record<string, ProfileScaleResultView> = {
  riasec: result({ typeCode: "SIA", scores: RIASEC_SCORES, completedAt: "2026-10-20 10:00:00" }),
  "ipip-neo-ffi": result({ scores: BIG_FIVE_SCORES, completedAt: "2026-10-21 09:00:00" }),
};

const ROW: TeacherProfileDetailRow = {
  userId: 21,
  studentId: "202505050101",
  studentName: "张三",
  classId: 7,
  className: "2026智能科学与技术1班",
  tags: ["摄影", "编程"],
  avatarUrl: "/uploads/a.jpg",
  evaluationUrl: "",
  evaluationTexts: ["认真", "热心", "踏实"],
  storageId: 1,
  createdAt: "2026-10-19 10:00:00",
  assessmentResults: RESULTS,
};

describe("buildTeacherAssessmentDetail（#332 零额外请求的数据适配）", () => {
  it("量表清单 + 列表行结果 → 共享结果卡所需的清单与 payload", () => {
    const detail = buildTeacherAssessmentDetail(SCALES, RESULTS);
    expect(detail.scales.map((scale) => scale.code)).toEqual(["riasec", "ipip-neo-ffi"]);
    expect(detail.scales[0]).toMatchObject({
      status: "completed",
      typeCode: "SIA",
      questionCount: 30,
      poolSize: 120,
      scaleVersion: "RIASEC-CN 2.0",
      attribution: "O*NET 署名文本",
      licenseText: "O*NET 授权文本",
      disclaimer: "兴趣结果只用于生涯探索。",
    });
    expect(detail.payloads.riasec.current).toMatchObject({ typeCode: "SIA", isCurrent: true });
    expect(detail.payloads.riasec.current?.scores).toHaveLength(6);
    expect(detail.payloads["ipip-neo-ffi"].current?.scores).toHaveLength(5);
    // 授权卡按量表分组，O*NET 与 IPIP 各自一份完整声明
    expect(detail.attributionScales).toHaveLength(2);
    expect(detail.attributionScales[1]).toMatchObject({
      code: "ipip-neo-ffi",
      attribution: "IPIP 公有领域",
      licenseText: "IPIP 授权文本",
    });
    expect(detail.failedCodes).toEqual([]);
  });

  it("未测量表也有 payload（current=null），列表项状态为 not-started", () => {
    const detail = buildTeacherAssessmentDetail(SCALES, {});
    expect(detail.scales.every((scale) => scale.status === "not-started")).toBe(true);
    expect(detail.payloads.riasec.current).toBeNull();
    expect(detail.payloads["ipip-neo-ffi"].current).toBeNull();
  });

  it("typological 量表三字码非法时按未测处理（与列表列同口径）", () => {
    const detail = buildTeacherAssessmentDetail(SCALES, {
      riasec: result({ typeCode: "XYZ", scores: RIASEC_SCORES }),
    });
    expect(detail.scales[0].status).toBe("not-started");
    expect(detail.payloads.riasec.current).toBeNull();
  });

  it("dimensional 量表有当前结果即已测（不要求三字码）", () => {
    const detail = buildTeacherAssessmentDetail(SCALES, {
      "ipip-neo-ffi": result({ typeCode: null, scores: BIG_FIVE_SCORES }),
    });
    expect(detail.scales[1].status).toBe("completed");
    expect(detail.payloads["ipip-neo-ffi"].current?.typeCode).toBeNull();
  });

  it("单套适配函数：列表项与 payload 同源（尺寸/维度一致）", () => {
    const scale = SCALES[1];
    const item = toAssessmentListItem(scale, RESULTS["ipip-neo-ffi"]);
    const payload = toAssessmentResultsPayload(scale, RESULTS["ipip-neo-ffi"], item);
    expect(item.status).toBe("completed");
    expect(payload.assessment.dimensions).toEqual(scale.dimensions);
    expect(payload.current?.scores).toEqual(BIG_FIVE_SCORES);
  });
});

describe("buildTeacherProfileSummary（#332 速览四卡，与学生端同一实现）", () => {
  it("已测：兴趣三字码 + 人格 headline + 推荐职业 Top3 + 档案资料/版本数", () => {
    const detail = buildTeacherAssessmentDetail(SCALES, RESULTS);
    const summary = buildTeacherProfileSummary({
      row: ROW,
      detail,
      careers: [
        { code: "1", displayName: "产品经理", englishName: "Product Manager", hasChineseName: true, meta: "管理 · 本科" },
        { code: "2", displayName: "数据分析师", englishName: "Data Analyst", hasChineseName: true, meta: "数据 · 本科" },
        { code: "3", displayName: "心理咨询师", englishName: "Counselor", hasChineseName: true, meta: "社会 · 硕士" },
        { code: "4", displayName: "第四个", englishName: "Fourth", hasChineseName: true, meta: "" },
      ],
      versionCount: 3,
    });
    const byKind = (kind: string) => summary.cards.find((card) => card.kind === kind) as SummaryCard;
    expect(byKind("interest")).toMatchObject({ state: "ready", code: "SIA" });
    expect(byKind("interest").bars).toHaveLength(3);
    expect(byKind("personality").state).toBe("ready");
    expect(byKind("personality").headline).toContain("尽责性");
    expect(byKind("careers").items).toHaveLength(3);
    // 档案资料卡：标签 + 完成度三项 + 版本数
    expect(byKind("profile").tokens).toEqual(["摄影", "编程"]);
    expect(byKind("profile").completion).toHaveLength(3);
    expect(byKind("profile").caption).toContain("共 3 个版本");
    expect(byKind("profile").title).toBe("档案资料");
  });

  it("教师受众：空态不出现「去测评 / 开始填写」这类学生动作，统一指向详情", () => {
    const detail = buildTeacherAssessmentDetail(SCALES, {});
    const summary = buildTeacherProfileSummary({ row: { ...ROW, assessmentResults: {} }, detail });
    for (const kind of ["interest", "personality", "careers", "profile"]) {
      const card = summary.cards.find((item) => item.kind === kind) as SummaryCard;
      expect(["detail", "profile"]).toContain(card.cta.action);
      expect(card.cta.href).toBeUndefined();
      if (card.state === "empty") {
        expect(card.cta.targetId).toBeDefined();
      }
    }
    expect(summary.cards.find((card) => card.kind === "interest")?.headline).toBe("该生还没测兴趣类型");
  });

  it("已测但分数快照缺失：三字码照样展示，不画 0 分条形也不伪造特质排名（与列表「已测 · 快照缺失」同口径）", () => {
    const detail = buildTeacherAssessmentDetail(SCALES, {
      riasec: result({ typeCode: "SIA", scores: null }),
      "ipip-neo-ffi": result({ scores: null }),
    });
    // 适配层只负责如实下发「有结果、无分数」，闸门在共享视图层（hasScoreSnapshot）
    expect(detail.payloads["ipip-neo-ffi"].current?.scores).toEqual([]);
    const summary = buildTeacherProfileSummary({ row: ROW, detail });
    const byKind = (kind: string) => summary.cards.find((card) => card.kind === kind) as SummaryCard;
    expect(byKind("interest")).toMatchObject({ state: "ready", code: "SIA" });
    expect(byKind("interest").bars).toHaveLength(0);
    expect(byKind("interest").caption).toContain("快照缺失");
    expect(byKind("personality").bars ?? []).toHaveLength(0);
    expect(byKind("personality").headline).toBe("已测 · 分数快照缺失");
    expect(byKind("personality").headline).not.toMatch(/偏低/);
    expect(byKind("personality").caption).toContain("该生");
  });

  it("资料入参：未归档/缺字段时降级而不抛错；versionCount 只在 >0 时并入", () => {
    expect(toSummaryProfileInput(ROW)).toMatchObject({ submitted: true, tags: ["摄影", "编程"] });
    const withVersion = toSummaryProfileInput(ROW, 2);
    expect(withVersion.versionCount).toBe(2);
    expect(toSummaryProfileInput(ROW, 0).versionCount).toBeUndefined();
  });
});

describe("推荐职业与速览辅助（#332）", () => {
  it("只取 Top3；脏行丢弃；带 O*NET 署名", () => {
    const built = buildTeacherCareers({
      careers: [
        { code: "1", name: "A", nameZh: "甲", cluster: "群1", educationLevel: "本科" },
        { code: "2", name: "B" },
        { code: "", name: "C" },
        { code: "3", name: "D", nameZh: null, cluster: "", educationLevel: "硕士" },
        { code: "4", name: "E", nameZh: "戊" },
      ],
      attribution: "CC BY 4.0",
    });
    expect(built.careers).toHaveLength(3);
    expect(built.careers[0].displayName).toBe("甲");
    // 缺中文译名时用「职业群 · 学历」当主标题（shared buildCareerCards 口径）
    expect(built.careers[2].displayName).toBe("硕士");
    expect(built.attribution).toBe("CC BY 4.0");
    expect(buildTeacherCareers(null)).toEqual({ careers: [], attribution: "" });
  });

  it("速览卡「查看详情」落点：测评卡锚点可反解量表 code", () => {
    const card = (cta: SummaryCard["cta"]): SummaryCard => ({
      kind: "interest",
      title: "兴趣类型",
      state: "ready",
      cta,
    });
    expect(resolveSummaryActionTarget(card({ label: "查看详情", action: "detail", targetId: "assessment-card-riasec" }))).toEqual({
      targetId: "assessment-card-riasec",
      expandCode: "riasec",
    });
    expect(resolveSummaryActionTarget(card({ label: "查看详情", action: "profile", targetId: "profile-info" }))).toEqual({
      targetId: "profile-info",
      expandCode: null,
    });
    expect(resolveSummaryActionTarget(card({ label: "查看详情", action: "detail", targetId: "assessment-results" }))).toEqual({
      targetId: "assessment-results",
      expandCode: null,
    });
    expect(resolveSummaryActionTarget(card({ label: "去测评", action: "quiz", href: "/x" }))).toBeNull();
    expect(resolveSummaryActionTarget(card({ label: "无", action: "none" }))).toBeNull();
  });
});
