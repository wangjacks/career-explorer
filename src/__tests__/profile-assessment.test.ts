import { describe, it, expect } from "vitest";
import {
  ASSESSMENT_FILTER_NONE,
  ASSESSMENT_INTEREST_FILTERS,
  assessmentFilterChipText,
  assessmentFilterToQuery,
  assessmentLeadOf,
  findDimensionalScale,
  findTypologicalScale,
  hasAssessmentScores,
  isAssessed,
  matchesAssessmentInterest,
  personalityDimensionLabel,
  personalityHeadlineOf,
  personalityTooltipOf,
  scaleResultOf,
  selectPersonalityAny,
  selectPersonalityDimension,
  selectPersonalityNone,
  toggleInterestLetter,
  type AssessmentFilter,
  type AssessmentInterestFilter,
  type ProfileAssessmentFields,
  type ProfileAssessmentScaleView,
} from "@/lib/profile-assessment";
import { RIASEC_KEYS } from "@/lib/assessment-match";
import { IPIP_DIMENSIONS } from "@/lib/assessment-data";

describe("兴趣测评筛选口径（#234 / #305 数据列表）", () => {
  it("胶囊顺序固定：全部 / R I A S E C / 未测", () => {
    expect(ASSESSMENT_INTEREST_FILTERS.map((f) => f.value)).toEqual([
      "all",
      "R",
      "I",
      "A",
      "S",
      "E",
      "C",
      "none",
    ]);
    expect(ASSESSMENT_INTEREST_FILTERS[0].label).toBe("全部");
    expect(ASSESSMENT_INTEREST_FILTERS[ASSESSMENT_INTEREST_FILTERS.length - 1].label).toBe("未测");
  });

  it("三字码首位即主导型；大小写/空白容忍，非法字母与空值返回 null", () => {
    expect(assessmentLeadOf("SIA")).toBe("S");
    expect(assessmentLeadOf("ri")).toBe("R");
    expect(assessmentLeadOf(" RIA ")).toBe("R");
    expect(assessmentLeadOf(null)).toBeNull();
    expect(assessmentLeadOf(undefined)).toBeNull();
    expect(assessmentLeadOf("")).toBeNull();
    expect(assessmentLeadOf("XYZ")).toBeNull();
    expect(assessmentLeadOf(" XRA ")).toBeNull();
  });

  it("已测判定以三字码为准（不依赖 status 字段）", () => {
    expect(isAssessed({ assessmentCode: "SIA", assessmentStatus: "completed" })).toBe(true);
    // 接口自述 completed 但没有合法码 → 仍算没测（脏数据不冒充）
    expect(isAssessed({ assessmentCode: null, assessmentStatus: "completed" })).toBe(false);
    expect(isAssessed({ assessmentCode: "XYZ" })).toBe(false);
    expect(isAssessed({})).toBe(false);
  });

  it("全部通过；六型按三字码任意位置包含；未测只留没有码的行", () => {
    const row = (code: string | null): { assessmentCode: string | null } => ({ assessmentCode: code });
    expect(matchesAssessmentInterest(row("SIA"), "all")).toBe(true);
    expect(matchesAssessmentInterest(row(null), "all")).toBe(true);

    expect(matchesAssessmentInterest(row("SIA"), "S")).toBe(true);
    expect(matchesAssessmentInterest(row("SIA"), "I")).toBe(true);
    expect(matchesAssessmentInterest(row("SIA"), "A")).toBe(true);
    expect(matchesAssessmentInterest(row("SIA"), "R")).toBe(false);
    expect(matchesAssessmentInterest(row("SER"), "R")).toBe(true);
    expect(matchesAssessmentInterest(row("SER"), "E")).toBe(true);
    expect(matchesAssessmentInterest(row("ria"), "A")).toBe(true);
    expect(matchesAssessmentInterest(row(" sia "), "A")).toBe(true);

    expect(matchesAssessmentInterest(row(null), "none")).toBe(true);
    expect(matchesAssessmentInterest(row(""), "none")).toBe(true);
    expect(matchesAssessmentInterest(row("XYZ"), "none")).toBe(true);
    expect(matchesAssessmentInterest(row("SIA"), "none")).toBe(false);
  });

  it("每个筛选值都能安全用于任意行（非法输入不抛错）", () => {
    const filters = ASSESSMENT_INTEREST_FILTERS.map((f) => f.value) as AssessmentInterestFilter[];
    for (const filter of filters) {
      expect(() => matchesAssessmentInterest({}, filter)).not.toThrow();
    }
  });
});

describe("详情条形数据判定（#234）", () => {
  it("快照缺失 / 损坏（解析为空）时不画条形", () => {
    expect(hasAssessmentScores({ assessmentScores: null })).toBe(false);
    expect(hasAssessmentScores({})).toBe(false);
    expect(hasAssessmentScores({ assessmentScores: [] })).toBe(false);
  });

  it("有六维快照时才画条形", () => {
    expect(
      hasAssessmentScores({ assessmentScores: [{ key: "R", standard: 80 }] })
    ).toBe(true);
  });
});

describe("双测评筛选视图模型（#330）", () => {
  const SCALES: ProfileAssessmentScaleView[] = [
    {
      code: "riasec",
      name: "霍兰德职业兴趣测评",
      scoringMode: "typological",
      dimensions: RIASEC_KEYS.map((key) => ({ key, label: key })),
    },
    {
      code: "ipip-neo-ffi",
      name: "五大人格测评",
      scoringMode: "dimensional",
      dimensions: IPIP_DIMENSIONS,
    },
  ];

  it("兴趣多选：点字母增删，顺序按 RIASEC 固定、最多 3 个，清空回到「全部」", () => {
    let filter: AssessmentFilter = ASSESSMENT_FILTER_NONE;
    filter = toggleInterestLetter(filter, "S");
    filter = toggleInterestLetter(filter, "A");
    filter = toggleInterestLetter(filter, "I");
    expect(filter).toEqual({ kind: "interest", mode: "letters", keys: ["I", "A", "S"] });
    // 第 4 个字母不再加入（三字码只有 3 位）
    expect(toggleInterestLetter(filter, "R")).toEqual(filter);
    // 再点一次取消最后一个 → 回到全部
    expect(toggleInterestLetter({ kind: "interest", mode: "letters", keys: ["S"] }, "S")).toEqual(
      ASSESSMENT_FILTER_NONE
    );
  });

  it("人格筛选：已测 / 未测 / 单维度（切换维度保留方向）", () => {
    expect(selectPersonalityAny()).toEqual({ kind: "personality", mode: "any" });
    expect(selectPersonalityNone()).toEqual({ kind: "personality", mode: "none" });

    const high = selectPersonalityDimension(ASSESSMENT_FILTER_NONE, "C", "high");
    expect(high).toEqual({ kind: "personality", mode: "dimension", key: "C", dir: "high" });
    // 点已选维度时由界面切回「已测」（见弹层逻辑），切换维度保留当前方向
    const switched = selectPersonalityDimension(high, "E", "high");
    expect(switched).toEqual({ kind: "personality", mode: "dimension", key: "E", dir: "high" });
    const flipped = selectPersonalityDimension(switched, "E", "low");
    expect(flipped).toMatchObject({ dir: "low" });
  });

  it("已应用 chip 文案与转查询参数：互斥只输出一组条件", () => {
    expect(assessmentFilterChipText(ASSESSMENT_FILTER_NONE, SCALES)).toBeNull();
    expect(
      assessmentFilterChipText({ kind: "interest", mode: "letters", keys: ["S", "A", "I"] }, SCALES)
    ).toBe("兴趣：S·A·I（同时包含）");
    expect(assessmentFilterChipText({ kind: "interest", mode: "none" }, SCALES)).toBe("兴趣：未测");
    expect(assessmentFilterChipText({ kind: "personality", mode: "any" }, SCALES)).toBe("人格：已测");
    expect(assessmentFilterChipText({ kind: "personality", mode: "none" }, SCALES)).toBe("人格：未测");
    expect(
      assessmentFilterChipText({ kind: "personality", mode: "dimension", key: "C", dir: "high" }, SCALES)
    ).toBe("人格：尽责性偏高");

    expect(assessmentFilterToQuery(ASSESSMENT_FILTER_NONE)).toEqual({});
    expect(assessmentFilterToQuery({ kind: "interest", mode: "letters", keys: ["S", "A"] })).toEqual({
      interest: { mode: "letters", keys: ["S", "A"] },
    });
    const personQuery = assessmentFilterToQuery({
      kind: "personality",
      mode: "dimension",
      key: "C",
      dir: "low",
    });
    expect(personQuery).toEqual({ personality: { mode: "dimension", key: "C", dir: "low" } });
    // 互斥：返回值里不可能同时有 interest 与 personality
    expect(Object.keys(personQuery)).toEqual(["personality"]);
  });

  it("量表辅助：找出兴趣 / 人格量表、按 code 取结果、维度标签回退", () => {
    expect(findTypologicalScale(SCALES)?.code).toBe("riasec");
    expect(findDimensionalScale(SCALES)?.code).toBe("ipip-neo-ffi");
    expect(findDimensionalScale([SCALES[0]])).toBeNull();
    expect(personalityDimensionLabel("C", SCALES)).toBe("尽责性");
    expect(personalityDimensionLabel("Z", SCALES)).toBe("Z");

    const row: ProfileAssessmentFields = {
      assessmentResults: {
        "ipip-neo-ffi": { status: "completed", typeCode: null, completedAt: "2026-10-19 08:00:00", scores: null },
      },
    };
    expect(scaleResultOf(row, "ipip-neo-ffi")?.status).toBe("completed");
    expect(scaleResultOf(row, "riasec")).toBeNull();
    expect(scaleResultOf(row, null)).toBeNull();
  });

  it("人格列画像：Top2「高X · 高Y」；未测 / 快照缺失返回 null（不画假的 0 分画像）", () => {
    const scale = SCALES[1];
    const completed = {
      status: "completed" as const,
      typeCode: null,
      completedAt: "2026-10-19 08:00:00",
      scores: [
        { key: "N", standard: 20 },
        { key: "E", standard: 88 },
        { key: "O", standard: 60 },
        { key: "A", standard: 55 },
        { key: "C", standard: 80 },
      ],
    };
    expect(personalityHeadlineOf(completed, scale)).toBe("高外向性 · 高尽责性");
    expect(personalityHeadlineOf({ ...completed, status: "none" }, scale)).toBeNull();
    expect(personalityHeadlineOf({ ...completed, scores: null }, scale)).toBeNull();
    expect(personalityHeadlineOf(null, scale)).toBeNull();

    expect(personalityTooltipOf(completed)).toBe("已完成 · 完成于 2026-10-19 08:00:00");
    expect(personalityTooltipOf({ ...completed, scores: null })).toContain("分数快照缺失");
    expect(personalityTooltipOf(null)).toBe("人格测评未完成");
  });

  it("低分也应显示在画像里：全部低于 50 时用「偏低X」而不是「高X」", () => {
    const scale = SCALES[1];
    const low = {
      status: "completed" as const,
      typeCode: null,
      completedAt: null,
      scores: [
        { key: "N", standard: 30 },
        { key: "E", standard: 20 },
        { key: "O", standard: 45 },
        { key: "A", standard: 40 },
        { key: "C", standard: 10 },
      ],
    };
    expect(personalityHeadlineOf(low, scale)).toBe("偏低开放性 · 偏低宜人性");
  });
});
