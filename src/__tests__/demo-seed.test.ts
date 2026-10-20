import { describe, it, expect } from "vitest";
import { planDemoSeed, materializeDemoSeed, type DemoSeedDeps } from "@/lib/demo-seed";
import { GROUP_SIZE_CAP } from "@/lib/grouping-utils";
import type { StorageAdapter } from "@/lib/storage";
import type { AssessmentRow, StorageBackendRow } from "@/lib/db";

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

describe("物化器：tempId→真实 id 重映射 + 调用序列（#253，fake deps 不触库）", () => {
  function makeRecordingDeps() {
    let nextId = 1000;
    const created: { user_code: string; role: string; class_id: number | null }[] = [];
    const submissions: { userCode: string; submittedAt: string | undefined }[] = [];
    const assessments: number[] = [];
    const uploads: string[] = [];
    const grouping: { groups: number[][]; memberIds: number[] } = { groups: [], memberIds: [] };
    const teacherLinks: [number, number][] = [];

    const deps: DemoSeedDeps = {
      insertClass: async () => 77,
      createAccount: async (spec) => {
        created.push({ user_code: spec.user_code, role: spec.role, class_id: spec.class_id ?? null });
        return ++nextId;
      },
      insertTeacherClass: async (teacherId, classId) => {
        teacherLinks.push([teacherId, classId]);
      },
      getDefaultStorageBackend: async () => ({ id: 5 } as unknown as StorageBackendRow),
      getStorage: async () =>
        ({
          type: "local",
          upload: async (key: string) => {
            uploads.push(key);
          },
          getSignedUrl: async (key: string) => `/api/uploads/${key}`,
        }) as unknown as StorageAdapter,
      submitProfileWithVersion: async (userCode, _t, _a, _e, _s, submittedAt) => {
        submissions.push({ userCode, submittedAt });
        return { version: 1 };
      },
      completeAssessmentResult: async (input) => {
        assessments.push(input.userId);
        return 1;
      },
      applyGroupingResult: async (_classId, groups, batch) => {
        grouping.groups = groups.map((g) => g.user_ids);
        grouping.memberIds = batch.groups.flatMap((g) => g.members.map((m) => m.userId));
        return 1;
      },
      getAssessmentByCode: async () => ({ id: 1 } as unknown as AssessmentRow),
      renderImage: async () => Buffer.from("img"),
      demoPasswordHash: async () => "hashed",
      makeThumbnail: async () => Buffer.from("thumb"),
    };
    return { deps, created, submissions, assessments, uploads, grouping, teacherLinks };
  }

  it("建班→配对教师→建学生→提交→测评→分组，且分组引用映射到真实 id", async () => {
    const p = plan(42);
    const r = makeRecordingDeps();
    const report = await materializeDemoSeed(p, r.deps, { id: 9, name: "管理员", role: "admin" });

    // 1 教师 + 20 学生；教师与班配对
    expect(r.created.filter((c) => c.role === "teacher")).toHaveLength(1);
    expect(r.created.filter((c) => c.role === "student")).toHaveLength(20);
    expect(r.teacherLinks).toEqual([[1001, 77]]); // 首个 createAccount=教师 1001，班 77

    // 提交与测评数与 plan 对齐
    const expectSubmitted = p.students.filter((s) => s.submit).length;
    const expectAssessed = p.students.filter((s) => s.assessment).length;
    expect(report.submitted).toBe(expectSubmitted);
    expect(r.submissions).toHaveLength(expectSubmitted);
    expect(report.assessed).toBe(expectAssessed);
    expect(r.assessments).toHaveLength(expectAssessed);

    // 提交时间已回填为 YYYY-MM-DD HH:mm:ss（与 getNow 同格式）
    for (const s of r.submissions) expect(s.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    // 每张图上传原图 + 缩略图
    expect(r.uploads).toHaveLength(report.images * 2);

    // 分组成员 id 全部来自真实学生 id（>1000），且与提交/建号映射一致
    const studentRealIds = r.created.filter((c) => c.role === "student");
    expect(studentRealIds).toHaveLength(20);
    const allGroupedIds = r.grouping.groups.flat();
    expect(allGroupedIds.every((id) => id > 1000)).toBe(true);
    expect(allGroupedIds.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => 1001 + 1 + i).sort((a, b) => a - b)
    ); // 1001=教师，学生从 1002 起连续 20 个
  });
});
