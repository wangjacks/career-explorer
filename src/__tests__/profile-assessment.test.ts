import { describe, it, expect } from "vitest";
import {
  ASSESSMENT_LEAD_FILTERS,
  assessmentLeadOf,
  isAssessed,
  matchesAssessmentLead,
  type AssessmentLeadFilter,
} from "@/lib/profile-assessment";

describe("主导型筛选口径（#234 数据列表）", () => {
  it("胶囊顺序固定：全部 / R I A S E C / 未测", () => {
    expect(ASSESSMENT_LEAD_FILTERS.map((f) => f.value)).toEqual([
      "all",
      "R",
      "I",
      "A",
      "S",
      "E",
      "C",
      "none",
    ]);
    expect(ASSESSMENT_LEAD_FILTERS[0].label).toBe("全部");
    expect(ASSESSMENT_LEAD_FILTERS[ASSESSMENT_LEAD_FILTERS.length - 1].label).toBe("未测");
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

  it("全部通过；六型按首位匹配；未测只留没有码的行", () => {
    const row = (code: string | null): { assessmentCode: string | null } => ({ assessmentCode: code });
    expect(matchesAssessmentLead(row("SIA"), "all")).toBe(true);
    expect(matchesAssessmentLead(row(null), "all")).toBe(true);

    expect(matchesAssessmentLead(row("SIA"), "S")).toBe(true);
    expect(matchesAssessmentLead(row("SIA"), "I")).toBe(false);
    expect(matchesAssessmentLead(row("ria"), "R")).toBe(true);

    expect(matchesAssessmentLead(row(null), "none")).toBe(true);
    expect(matchesAssessmentLead(row(""), "none")).toBe(true);
    expect(matchesAssessmentLead(row("XYZ"), "none")).toBe(true);
    expect(matchesAssessmentLead(row("SIA"), "none")).toBe(false);
  });

  it("每个筛选值都能安全用于任意行（非法输入不抛错）", () => {
    const filters = ASSESSMENT_LEAD_FILTERS.map((f) => f.value) as AssessmentLeadFilter[];
    for (const filter of filters) {
      expect(() => matchesAssessmentLead({}, filter)).not.toThrow();
    }
  });
});
