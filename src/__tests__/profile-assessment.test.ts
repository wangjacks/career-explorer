import { describe, it, expect } from "vitest";
import {
  ASSESSMENT_INTEREST_FILTERS,
  assessmentLeadOf,
  hasAssessmentScores,
  isAssessed,
  matchesAssessmentInterest,
  type AssessmentInterestFilter,
} from "@/lib/profile-assessment";

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
