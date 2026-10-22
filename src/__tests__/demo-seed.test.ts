import { describe, it, expect } from "vitest";
import { planDemoSeed, materializeDemoSeed, RIASEC_CODE, type DemoSeedDeps } from "@/lib/demo-seed";
import { GROUP_SIZE_CAP } from "@/lib/grouping-utils";
import {
  RIASEC_ASSESSMENT,
  RIASEC_DIMENSIONS,
  RIASEC_QUESTIONS,
  IPIP_ASSESSMENT,
  IPIP_NEO_FFI_CODE,
  IPIP_DIMENSIONS,
  IPIP_QUESTIONS,
} from "@/lib/assessment-data";
import { scoreAssessment } from "@/lib/assessment-scoring";
import { parseItemsSnapshot, planAttempt } from "@/lib/assessment-sampling";
import type { StorageAdapter } from "@/lib/storage";
import type { AssessmentRow, StorageBackendRow } from "@/lib/db";

// 题库为 120 题（#281）；断言按长度而非硬编码题数，避免量表扩充时测试脆断
const TOTAL_Q = RIASEC_QUESTIONS.length;
// 每次作答量（#282）：抽题落地后演示数据也按本轮卷子落库，0 表示整库即一轮
const ROUND_Q = RIASEC_ASSESSMENT.itemsPerAttempt > 0 ? RIASEC_ASSESSMENT.itemsPerAttempt : TOTAL_Q;

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
        expect(s.bigFiveAssessment).toBeNull();
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

  it("completed 测评：本轮卷子答满、快照形状合规、三字码合法、计分结果可反序列化", () => {
    const p = planDemoSeed(5, { tagNames: TAG_POOL, draftShare: 0 });
    const completed = p.students.filter((s) => s.assessment?.kind === "completed");
    expect(completed.length).toBeGreaterThan(0);
    for (const s of completed) {
      const a = s.assessment!;
      const snapshot = parseItemsSnapshot(a.itemsJson);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.indexes).toHaveLength(ROUND_Q);
      expect(snapshot!.pool.length).toBeGreaterThan(0);
      expect(snapshot!.indexes.every((index) => index >= 1 && index <= TOTAL_Q)).toBe(true);
      expect(new Set(snapshot!.indexes).size).toBe(ROUND_Q);
      expect(Object.keys(a.answers).map(Number).sort((x, y) => x - y)).toEqual(
        [...snapshot!.indexes].sort((x, y) => x - y)
      ); // 答满本轮
      for (const v of Object.values(a.answers)) expect(v).toBeGreaterThanOrEqual(1);
      for (const v of Object.values(a.answers)) expect(v).toBeLessThanOrEqual(5);
      expect(a.typeCode).toMatch(/^[RIASEC]{3}$/);
      expect(JSON.parse(a.scoresJson!)).toBeInstanceOf(Array);
    }
  });

  it("draft 测评：本轮卷子呈现顺序的前缀部分答案、无计分结果（可续答）", () => {
    const p = planDemoSeed(5, { tagNames: TAG_POOL, draftShare: 1 });
    const drafts = p.students.filter((s) => s.assessment?.kind === "draft");
    expect(drafts.length).toBeGreaterThan(0);
    for (const s of drafts) {
      const a = s.assessment!;
      expect(a.scoresJson).toBeUndefined();
      expect(a.typeCode).toBeUndefined();
      const indexes = parseItemsSnapshot(a.itemsJson)!.indexes;
      expect(indexes).toHaveLength(ROUND_Q);
      const answered = Object.keys(a.answers).map(Number);
      expect(answered.length).toBeGreaterThanOrEqual(3);
      expect(answered.length).toBeLessThan(ROUND_Q); // 未完整（本轮前缀草稿）
      // 草稿的已答题必须是本轮卷子的前缀：续答时 /start 按快照走，不会判成换题
      // （`Object.keys` 对数字键按升序枚举，所以两侧都排序后比集合）
      expect([...answered].sort((x, y) => x - y)).toEqual(
        [...indexes.slice(0, answered.length)].sort((x, y) => x - y)
      );
      for (const v of Object.values(a.answers)) expect(v).toBeGreaterThanOrEqual(1);
    }
  });

  it("大五与 RIASEC 同门槛同形态：同一学生要么两套都有、且同为完成或同为草稿（#316）", () => {
    for (const seed of [5, 42]) {
      const p = planDemoSeed(seed, { tagNames: TAG_POOL, draftShare: 0.5 });
      for (const s of p.students) {
        expect(Boolean(s.bigFiveAssessment)).toBe(Boolean(s.assessment));
        if (s.bigFiveAssessment && s.assessment) {
          expect(s.bigFiveAssessment.kind).toBe(s.assessment.kind);
        }
      }
    }
  });

  it("大五 completed：50 题全答、计分引擎重算一致、含三档、无三字码（#316）", () => {
    const p = planDemoSeed(5, { tagNames: TAG_POOL, draftShare: 0 });
    const completed = p.students.filter((s) => s.bigFiveAssessment?.kind === "completed");
    expect(completed.length).toBeGreaterThan(0);
    for (const s of completed) {
      const a = s.bigFiveAssessment!;
      expect(a.typeCode).toBeUndefined();
      const snapshot = parseItemsSnapshot(a.itemsJson);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.indexes).toHaveLength(IPIP_QUESTIONS.length);
      expect(Object.keys(a.answers).map(Number).sort((x, y) => x - y)).toEqual(
        IPIP_QUESTIONS.map((q) => q.index).sort((x, y) => x - y)
      );
      for (const v of Object.values(a.answers)) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(5);
      }
      // 结果是计分引擎算出来的（逐字段一致），不是手写快照
      const recomputed = scoreAssessment(IPIP_DIMENSIONS, IPIP_QUESTIONS, a.answers, {
        mode: "dimensional",
      });
      expect(JSON.parse(a.scoresJson!)).toEqual(recomputed.scores);
      const scores = JSON.parse(a.scoresJson!) as { band?: string; standard: number }[];
      expect(scores).toHaveLength(IPIP_DIMENSIONS.length);
      for (const dim of scores) {
        expect(["high", "medium", "low"]).toContain(dim.band);
        expect(dim.standard).toBeGreaterThanOrEqual(0);
        expect(dim.standard).toBeLessThanOrEqual(100);
      }
    }
    // 三档随种子分布：人格轮廓卡有东西可看（high / medium / low 都出现）
    const bands = new Set(
      completed.flatMap((s) =>
        (JSON.parse(s.bigFiveAssessment!.scoresJson!) as { band: string }[]).map((d) => d.band)
      )
    );
    expect(bands.size).toBe(3);
  });

  it("大五 draft：50 题卷子的前缀作答、无计分结果（可续答）", () => {
    const p = planDemoSeed(5, { tagNames: TAG_POOL, draftShare: 1 });
    const drafts = p.students.filter((s) => s.bigFiveAssessment?.kind === "draft");
    expect(drafts.length).toBeGreaterThan(0);
    for (const s of drafts) {
      const a = s.bigFiveAssessment!;
      expect(a.scoresJson).toBeUndefined();
      const answered = Object.keys(a.answers).map(Number);
      expect(answered.length).toBeGreaterThanOrEqual(3);
      expect(answered.length).toBeLessThan(IPIP_QUESTIONS.length);
      expect(answered).toEqual(IPIP_QUESTIONS.slice(0, answered.length).map((q) => q.index));
      for (const v of Object.values(a.answers)) expect(v).toBeGreaterThanOrEqual(1);
    }
  });

  it("大五快照在真实抽题口径下有效：fullBank 量表 planAttempt 认这份快照", () => {
    const p = planDemoSeed(5, { tagNames: TAG_POOL, draftShare: 0.5 });
    const pool = IPIP_QUESTIONS.map((q) => ({
      index: q.index,
      dimension: q.dimension,
      origin: q.origin,
      version: 1, // 适配器播种时 version 恒为 1
    }));
    for (const s of p.students.filter((x) => x.bigFiveAssessment)) {
      const a = s.bigFiveAssessment!;
      const plan = planAttempt({
        pool,
        dimensions: IPIP_DIMENSIONS,
        scaleVersion: IPIP_ASSESSMENT.scaleVersion,
        itemsPerAttempt: IPIP_ASSESSMENT.itemsPerAttempt,
        userId: s.tempId,
        assessmentId: 2,
        attemptNo: 1,
        answeredIndexes: new Set(Object.keys(a.answers).map(Number)),
        snapshotRaw: a.itemsJson,
      });
      expect(plan.warnings).toEqual([]);
      expect(plan.indexes).toEqual(parseItemsSnapshot(a.itemsJson)!.indexes);
    }
  });

  it("抽题快照形状：每维度恰好 ROUND_Q / 维度数 题（演示数据不出现整维空题）", () => {
    const p = planDemoSeed(5, { tagNames: TAG_POOL, draftShare: 0.5 });
    const withAssessment = p.students.filter((s) => s.assessment);
    expect(withAssessment.length).toBeGreaterThan(0);
    const perDimension = ROUND_Q / RIASEC_DIMENSIONS.length;
    const dimensionOf = new Map(RIASEC_QUESTIONS.map((q) => [q.index, q.dimension]));
    for (const s of withAssessment) {
      const indexes = parseItemsSnapshot(s.assessment!.itemsJson)!.indexes;
      const counts = new Map<string, number>();
      for (const index of indexes) counts.set(dimensionOf.get(index)!, (counts.get(dimensionOf.get(index)!) ?? 0) + 1);
      expect([...counts.keys()].sort()).toEqual(RIASEC_DIMENSIONS.map((d) => d.key).sort());
      for (const key of RIASEC_DIMENSIONS.map((d) => d.key)) expect(counts.get(key)).toBe(perDimension);
    }
  });

  it("演示快照在真实抽题口径下有效：planAttempt 认这份快照，不走兼容路径也不降级", () => {
    const p = planDemoSeed(5, { tagNames: TAG_POOL, draftShare: 0.5 });
    const pool = RIASEC_QUESTIONS.map((q) => ({
      index: q.index,
      dimension: q.dimension,
      origin: q.origin,
      version: 1, // 适配器播种时 version 恒为 1
    }));
    for (const s of p.students.filter((x) => x.assessment)) {
      const a = s.assessment!;
      const plan = planAttempt({
        pool,
        dimensions: RIASEC_DIMENSIONS,
        scaleVersion: RIASEC_ASSESSMENT.scaleVersion,
        itemsPerAttempt: RIASEC_ASSESSMENT.itemsPerAttempt,
        userId: s.tempId,
        assessmentId: 1,
        attemptNo: 1,
        answeredIndexes: new Set(Object.keys(a.answers).map(Number)),
        snapshotRaw: a.itemsJson,
      });
      expect(plan.warnings).toEqual([]);
      // 快照路径原样返回题号：演示草稿被真人续答时不会换题，也不会被判成「在途无快照」
      expect(plan.indexes).toEqual(parseItemsSnapshot(a.itemsJson)!.indexes);
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
    const submissions: { userCode: string; evaluationText: string | null; submittedAt: string | undefined }[] = [];
    const assessments: { userId: number; assessmentId: number }[] = [];
    const draftIds: { userId: number; assessmentId: number }[] = [];
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
      submitProfileWithVersion: async (userCode, _t, _a, _e, evaluationText, _s, submittedAt) => {
        submissions.push({ userCode, evaluationText, submittedAt });
        return { version: 1 };
      },
      completeAssessmentResult: async (input) => {
        assessments.push({ userId: input.userId, assessmentId: input.assessmentId });
        return 1;
      },
      upsertAssessmentDraft: async (userId, assessmentId) => {
        draftIds.push({ userId, assessmentId });
        return 1;
      },
      applyGroupingResult: async (_classId, groups, batch) => {
        grouping.groups = groups.map((g) => g.user_ids);
        grouping.memberIds = batch.groups.flatMap((g) => g.members.map((m) => m.userId));
        return 1;
      },
      getAssessmentByCode: async (code) =>
        ({ id: code === RIASEC_CODE ? 1 : code === IPIP_NEO_FFI_CODE ? 2 : 99 } as unknown as AssessmentRow),
      renderImage: async () => Buffer.from("img"),
      demoPasswordHash: async () => "hashed",
      makeThumbnail: async () => Buffer.from("thumb"),
    };
    return { deps, created, submissions, assessments, draftIds, uploads, grouping, teacherLinks };
  }

  it("建班→配对教师→建学生→提交→测评→分组，且分组引用映射到真实 id", async () => {
    const p = plan(42);
    const r = makeRecordingDeps();
    const report = await materializeDemoSeed(p, r.deps, { id: 9, name: "管理员", role: "admin" });

    // 1 教师 + 20 学生；教师与班配对
    expect(r.created.filter((c) => c.role === "teacher")).toHaveLength(1);
    expect(r.created.filter((c) => c.role === "student")).toHaveLength(20);
    expect(r.teacherLinks).toEqual([[1001, 77]]); // 首个 createAccount=教师 1001，班 77

    // 提交数、完成测评数、草稿数各自与 plan 对齐（completed→completeAssessmentResult，draft→upsertAssessmentDraft）
    const expectSubmitted = p.students.filter((s) => s.submit).length;
    const expectCompleted = p.students.filter((s) => s.assessment?.kind === "completed").length;
    const expectDrafts = p.students.filter((s) => s.assessment?.kind === "draft").length;
    const expectBigFiveCompleted = p.students.filter((s) => s.bigFiveAssessment?.kind === "completed").length;
    const expectBigFiveDrafts = p.students.filter((s) => s.bigFiveAssessment?.kind === "draft").length;
    expect(report.submitted).toBe(expectSubmitted);
    expect(r.submissions).toHaveLength(expectSubmitted);
    expect(report.assessed).toBe(expectCompleted);
    expect(r.assessments.filter((a) => a.assessmentId === 1)).toHaveLength(expectCompleted);
    expect(report.drafts).toBe(expectDrafts);
    expect(r.draftIds.filter((a) => a.assessmentId === 1)).toHaveLength(expectDrafts);
    // 大五（#316）：与 RIASEC 同门槛，完成/草稿数与 report 分开计数且落第二套量表（assessmentId 2）
    expect(report.bigFiveAssessed).toBe(expectBigFiveCompleted);
    expect(r.assessments.filter((a) => a.assessmentId === 2)).toHaveLength(expectBigFiveCompleted);
    expect(report.bigFiveDrafts).toBe(expectBigFiveDrafts);
    expect(r.draftIds.filter((a) => a.assessmentId === 2)).toHaveLength(expectBigFiveDrafts);
    // 一人每套量表只产其一（完成与草稿互斥），两套同门槛 → 总调用数 = 2 × 有测评的学生数
    expect(r.assessments.length + r.draftIds.length).toBe(2 * p.students.filter((s) => s.assessment).length);
    expect(p.students.filter((s) => s.bigFiveAssessment).length).toBe(
      p.students.filter((s) => s.assessment).length
    );

    // 提交时间已回填为 YYYY-MM-DD HH:mm:ss（与 getNow 同格式）；#162 起每条档案带三条评价文字
    for (const s of r.submissions) {
      expect(s.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(JSON.parse(s.evaluationText ?? "[]")).toHaveLength(3);
    }

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
