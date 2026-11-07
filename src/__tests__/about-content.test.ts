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

  it("does not hardcode a release version", () => {
    expect(allCopy).not.toMatch(/\bv?\d+\.\d+\.\d+\b/);
  });
});
