import { describe, expect, it } from "vitest";
import {
  ABOUT_CAPABILITIES,
  ABOUT_CAPABILITY_LINE,
  ABOUT_INTRO,
  ABOUT_META_DESCRIPTION,
  ABOUT_ROLES,
  ABOUT_START,
  ABOUT_STEPS,
  ABOUT_TRUST,
} from "@/lib/about-content";

const allCopy = [
  ABOUT_META_DESCRIPTION,
  ABOUT_INTRO.lead,
  ABOUT_INTRO.description,
  ...ABOUT_CAPABILITIES.flatMap((capability) => [capability.title, capability.desc]),
  ...ABOUT_ROLES.flatMap((role) => [role.role, role.title, role.summary, ...role.points]),
  ...ABOUT_STEPS,
  ...ABOUT_TRUST.flatMap((item) => [item.title, item.desc]),
  ...ABOUT_START.flatMap((item) => [item.audience, item.desc]),
  ABOUT_CAPABILITY_LINE,
].join("\n");

describe("about content", () => {
  it("keeps the v3 content structure", () => {
    expect(ABOUT_CAPABILITIES).toHaveLength(4);
    expect(ABOUT_ROLES).toHaveLength(3);
    expect(ABOUT_STEPS).toHaveLength(5);
    expect(ABOUT_TRUST).toHaveLength(3);
    expect(ABOUT_START).toHaveLength(3);
  });

  it("covers the v3 capabilities", () => {
    for (const keyword of ["职业测评", "课堂分组", "小组工作区", "演示沙箱", "O*NET", "IPIP", "审计"]) {
      expect(allCopy).toContain(keyword);
    }
  });

  it("does not keep stale v2 claims", () => {
    for (const phrase of ["v2.0.3", "虚拟形象", "上传词云", "生成专属词云", "16 人格"]) {
      expect(allCopy).not.toContain(phrase);
    }
  });

  it("matches the inline profile submission flow (#168 / #208 / #162)", () => {
    const stepCopy = ABOUT_STEPS.join("\n");
    for (const keyword of ["激活", "标签", "三条", "头像", "历史提交", "恢复"]) {
      expect(stepCopy).toContain(keyword);
    }
    // 向导、确认页与本地预览已在 #168 删除，不能再出现在流程描述里
    for (const phrase of ["向导", "确认页", "本地预览", "仅本地预览", "至少一项", "三项至少"]) {
      expect(stepCopy).not.toContain(phrase);
    }
  });

  it("states the assessment length and retake capabilities actually shipped", () => {
    const assessmentCopy = allCopy;
    for (const keyword of ["30 题", "120 题", "50 题", "草稿", "三字码", "O*NET"]) {
      expect(assessmentCopy).toContain(keyword);
    }
  });

  it("names the shipped grouping and profile-list terminology", () => {
    expect(allCopy).toContain("智能分组");
    expect(allCopy).toContain("数据列表测评双列");
    expect(allCopy).not.toContain("自动分组");
  });

  it("keeps the O*NET and IPIP licence statements", () => {
    expect(allCopy).toContain("O*NET Tools Developer License");
    expect(allCopy).toContain("CC BY 4.0");
    expect(allCopy).toContain("公有领域");
  });

  it("does not hardcode a release version", () => {
    expect(allCopy).not.toMatch(/\bv?\d+\.\d+\.\d+\b/);
  });
});
