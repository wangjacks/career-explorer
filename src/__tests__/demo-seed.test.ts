import { describe, it, expect } from "vitest";
import { planDemoSeed } from "@/lib/demo-seed";
import { GROUP_SIZE_CAP } from "@/lib/grouping-utils";

const TAG_POOL = [
  "阅读", "编程", "音乐", "运动", "绘画", "科学", "旅行", "摄影",
  "游戏", "烹饪", "写作", "舞蹈", "手工", "象棋", "辩论", "园艺",
];

function plan(seed: number) {
  return planDemoSeed(seed, { tagNames: TAG_POOL });
}

describe("演示播种纯规划器（#253）", () => {
  it("同种子确定性、异种子不同", () => {
    expect(plan(42)).toEqual(plan(42));
    expect(plan(42)).not.toEqual(plan(43));
  });

  it("规模与提交人数符合默认（20 人 / 精确 16 提交）", () => {
    const p = plan(7);
    expect(p.students).toHaveLength(20);
    const submitters = p.students.filter((s) => s.submit);
    expect(submitters).toHaveLength(16); // round(20*0.8)
    expect(p.teacher.user_code).toMatch(/^99\d{6}$/);
  });

  it("提交者标签为预设子集且非空；未提交者无标签", () => {
    const p = plan(11);
    for (const s of p.students) {
      if (s.submit) {
        expect(s.tags && s.tags.length).toBeGreaterThan(0);
        for (const t of s.tags ?? []) expect(TAG_POOL).toContain(t);
        expect(new Set(s.tags).size).toBe((s.tags ?? []).length); // 去重
      } else {
        expect(s.tags).toBeNull();
        expect(s.avatar).toBe(false);
        expect(s.assessment).toBeNull();
      }
    }
  });

  it("标签分布有梯度（人设聚类：非人人同标签、也非全不同）", () => {
    const p = plan(21);
    const tagSets = p.students.filter((s) => s.submit).map((s) => JSON.stringify([...(s.tags ?? [])].sort()));
    const distinct = new Set(tagSets).size;
    expect(distinct).toBeGreaterThan(1); // 不是人人都一样
    expect(distinct).toBeLessThan(tagSets.length); // 有聚类（人设复用）
  });

  it("测评答案完整、三字码合法、计分结果可反序列化", () => {
    const p = plan(5);
    const withAssess = p.students.filter((s) => s.assessment);
    expect(withAssess.length).toBeGreaterThan(0);
    for (const s of withAssess) {
      const a = s.assessment!;
      expect(Object.keys(a.answers).length).toBe(30); // RIASEC 全题作答
      for (const v of Object.values(a.answers)) expect(v).toBeGreaterThanOrEqual(1);
      for (const v of Object.values(a.answers)) expect(v).toBeLessThanOrEqual(5);
      expect(a.typeCode).toMatch(/^[RIASEC]{3}$/);
      expect(JSON.parse(a.scoresJson)).toBeInstanceOf(Array);
    }
  });

  it("分组覆盖全名册、每组≤上限、taggedCount=提交人数", () => {
    const p = plan(99);
    const g = p.grouping;
    expect(g.studentCount).toBe(20);
    expect(g.taggedCount).toBe(16);
    const allMembers = g.groups.flatMap((grp) => grp.members.map((m) => m.tempId));
    expect(allMembers.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1)); // 每人恰好一次
    for (const grp of g.groups) {
      expect(grp.members.length).toBeGreaterThan(0);
      expect(grp.members.length).toBeLessThanOrEqual(GROUP_SIZE_CAP);
    }
  });
});
