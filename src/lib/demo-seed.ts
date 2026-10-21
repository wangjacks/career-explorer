/**
 * 演示数据播种器（#253）——**纯规划 + 副作用物化** 两半。
 * 本文件只做「planDemoSeed」纯函数：给定 seed + 预设标签快照，产出确定性、可单测的 DemoSeedPlan，
 * 不碰 DB / 文件系统 / sharp。分组用真实算法（buildGrouping）、测评用真实计分引擎（scoreAssessment）涌现，不造假。
 * 学生用 tempId（1..N）占位，物化时由 materializeDemoSeed（见 demo-seed 后半或 lifecycle）映射为真实 users.id。
 */
import {
  buildDemoRoster,
  buildDemoTeacher,
  mulberry32,
  randInt,
  hashDemoPassword,
  createDemoAccount,
  DEMO_CLASS_NAME,
  VISITOR_SEQ_START,
  type Rng,
  type DemoAccountSpec,
} from "./demo-accounts";
import {
  GROUPING_STRATEGY,
  GROUP_SIZE_CAP,
  buildGrouping,
} from "./grouping-utils";
import { buildFeatureVectors, describeSources } from "./grouping-features";
import {
  RIASEC_ASSESSMENT,
  RIASEC_CODE,
  RIASEC_DIMENSIONS,
  RIASEC_QUESTIONS,
  SAMPLING_EXCLUDED_ORIGINS,
  SAMPLING_RETIRED_INDEXES,
} from "./assessment-data";
import { scoreAssessment, type QuestionConfig } from "./assessment-scoring";
import { buildItemsSnapshot, drawItems, poolFingerprint } from "./assessment-sampling";
import { generateObjectKey, getStorage, type StorageAdapter } from "./storage";
import { createThumbnail } from "./thumbnail";
import { getThumbnailKey } from "./thumbnail-utils";
import { renderDemoImage, type DemoImageKind } from "./demo-images";
import {
  insertClass,
  insertTeacherClass,
  getDefaultStorageBackend,
  submitProfileWithVersion,
  completeAssessmentResult,
  upsertAssessmentDraft,
  applyGroupingResult,
  getAssessmentByCode,
  type UserRow,
  type ClassGroupingInput,
  type NewGroupBatchInput,
  type CompleteAssessmentInput,
  type StorageBackendRow,
  type AssessmentRow,
} from "./db";

/** 与生产邀请码同字母表（去易混字符），但由注入 rng 驱动以保持纯函数 */
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface DemoSeedOptions {
  /** 名册学生数（默认 20） */
  studentCount?: number;
  /** 已提交比例，落在 [0.7,0.85]（默认 0.8 → 精确取 round(count*rate) 人提交） */
  submitRate?: number;
  /** 提交者中完成测评的比例（默认 0.75） */
  assessmentRate?: number;
  /** 被选中的测评里「进行中草稿」占比（默认 0.25，其余为已完成并计分） */
  draftShare?: number;
  /** 提交时间散布的天数窗口（默认 30） */
  recentDays?: number;
  /** 预设标签叶子名快照（必填；lifecycle 在演示作用域内取 getActiveTags 过滤 type==="tag" 传入） */
  tagNames: string[];
}

export interface DemoSeedAssessment {
  /** completed：本轮全答 + 计分落库；draft：本轮呈现顺序前缀部分答案的进行中草稿 */
  kind: "completed" | "draft";
  answers: Record<number, number>;
  /** 本轮抽题快照（#282）：演示数据与真实施测同口径，否则教师端题量与真实学生不一致 */
  itemsJson: string;
  /** 仅 completed：计分引擎结果整体序列化，写 assessment_results.scores_json */
  scoresJson?: string;
  /** 仅 completed：三字码 */
  typeCode?: string;
}

export interface DemoSeedStudent {
  tempId: number;
  user_code: string;
  name: string;
  /** 提交者的标签名数组；未提交为 null */
  tags: string[] | null;
  submit: boolean;
  avatar: boolean;
  evaluation: boolean;
  assessment: DemoSeedAssessment | null;
  /** submitted_at 往前回拨的天数（未提交为 0） */
  submittedOffsetDays: number;
}

export interface DemoSeedGroup {
  groupNo: number;
  cohesion: number | null;
  members: { tempId: number; userCode: string; name: string }[];
}

export interface DemoSeedPlan {
  seed: number;
  class: { name: string; invitationCode: string };
  teacher: { user_code: string; name: string };
  students: DemoSeedStudent[];
  grouping: {
    strategy: string;
    featureSources: string;
    groupSize: number;
    studentCount: number;
    taggedCount: number;
    metricsJson: string;
    groups: DemoSeedGroup[];
  };
}

function shuffled<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sampleDistinct(pool: readonly string[], k: number, rng: Rng): string[] {
  return shuffled(pool, rng).slice(0, Math.min(k, pool.length));
}

function demoInviteCode(rng: Rng, len = 8): string {
  let s = "";
  for (let i = 0; i < len; i++) s += INVITE_ALPHABET[Math.floor(rng() * INVITE_ALPHABET.length)];
  return s;
}

/**
 * 演示班级的一份卷子（#282）：走生产同一个抽样器。
 * 演示数据若按整库 120 题落库，教师端与「我的测评」看到的题量就和真实学生（每次 30 题）不一致，
 * 也演示不出轮换与平行卷，所以这里必须抽 30 题并带快照。
 */
const DEMO_ROUND_SIZE = RIASEC_ASSESSMENT.itemsPerAttempt;
/** 种子阶段所有题 `version = 1`，该指纹与适配器播种后 `loadAttemptContext` 算出的同值 */
const DEMO_POOL_FINGERPRINT = poolFingerprint(
  RIASEC_QUESTIONS.map((question) => ({ index: question.index, version: 1 })),
  RIASEC_ASSESSMENT.scaleVersion,
  SAMPLING_EXCLUDED_ORIGINS,
  SAMPLING_RETIRED_INDEXES
);
const DEMO_POOL = RIASEC_QUESTIONS.map((question) => ({
  index: question.index,
  dimension: question.dimension,
  origin: question.origin,
}));

/** 本轮题号（呈现顺序）；`itemsPerAttempt = 0` 的量表按整库一轮处理 */
function demoRoundIndexes(rng: Rng): number[] {
  if (DEMO_ROUND_SIZE <= 0) return RIASEC_QUESTIONS.map((question) => question.index);
  return drawItems({
    items: DEMO_POOL,
    dimensions: RIASEC_DIMENSIONS,
    perDimension: Math.floor(DEMO_ROUND_SIZE / RIASEC_DIMENSIONS.length),
    retiredIndexes: SAMPLING_RETIRED_INDEXES,
    rng,
  }).indexes;
}

/**
 * 生成一份合法 RIASEC 作答。completed 把本轮卷子答满并用真实计分引擎出码；
 * draft 只答本轮呈现顺序的前若干题（未完整、无结果），代表测评中心「进行中」可续答的草稿。
 */
function buildAssessment(rng: Rng, kind: "completed" | "draft"): DemoSeedAssessment {
  const keys = RIASEC_DIMENSIONS.map((d) => d.key);
  const targetSet = new Set(shuffled(keys, rng).slice(0, 3));
  const roundIndexes = demoRoundIndexes(rng);
  const byIndex = new Map(RIASEC_QUESTIONS.map((question) => [question.index, question]));
  const roundQuestions = roundIndexes.map((index) => byIndex.get(index)!);
  const answeredCount =
    kind === "completed" ? roundQuestions.length : randInt(rng, 3, Math.max(3, roundQuestions.length - 1));
  const answers: Record<number, number> = {};
  for (const q of roundQuestions.slice(0, answeredCount)) {
    // 目标维度答 4–5（偏同意），其余 1–3（偏不同意），使三字码稳定落向目标
    answers[q.index] = targetSet.has(q.dimension) ? randInt(rng, 4, 5) : randInt(rng, 1, 3);
  }
  const itemsJson = buildItemsSnapshot(roundIndexes, DEMO_POOL_FINGERPRINT);
  if (kind === "draft") return { kind, answers, itemsJson };

  const result = scoreAssessment(RIASEC_DIMENSIONS, roundQuestions as QuestionConfig[], answers, {
    mode: "typological",
  });
  return {
    kind: "completed",
    answers,
    itemsJson,
    scoresJson: JSON.stringify(result.scores),
    typeCode: result.code ?? "",
  };
}

/** 把名册学生拍平成分组算法可用的 UserRow（只 id/user_code/tags 有意义；tags 为 JSON 名称数组或 null） */
function toGroupingRows(students: DemoSeedStudent[]): UserRow[] {
  return students.map((s) => ({
    id: s.tempId,
    user_code: s.user_code,
    password_hash: null,
    role: "student",
    name: s.name,
    class_id: 0,
    tags: s.tags ? JSON.stringify(s.tags) : null,
    avatar_url: null,
    evaluation_url: null,
    submitted_at: null,
    created_at: "",
    storage_id: 1,
  }));
}

export function planDemoSeed(seed: number, opts: DemoSeedOptions): DemoSeedPlan {
  const studentCount = opts.studentCount ?? 20;
  // 名册 seq 从 1 起；访客账户号段从 VISITOR_SEQ_START 起，名册不得侵入
  if (studentCount >= VISITOR_SEQ_START) {
    throw new Error(`演示名册规模须小于访客号段起点 ${VISITOR_SEQ_START}`);
  }
  const submitRate = opts.submitRate ?? 0.8;
  const assessmentRate = opts.assessmentRate ?? 0.75;
  const draftShare = opts.draftShare ?? 0.25;
  const recentDays = opts.recentDays ?? 30;
  const tagPool = opts.tagNames.filter(Boolean);

  const rng = mulberry32(seed);
  const roster = buildDemoRoster(studentCount, rng);
  const teacher = buildDemoTeacher(1, rng);

  // 精确提交人数：洗牌取前 submitCount 人 → 确定性、且比例可控（落在验收区间）
  const submitCount = Math.max(1, Math.round(studentCount * submitRate));
  const submitterCodes = new Set(shuffled(roster.map((r) => r.user_code), rng).slice(0, submitCount));

  // 人设（persona）：submitCount/5 组，每组一个标签亲和集 → 分布有梯度、避免人人同标签
  const personaCount = Math.max(2, Math.min(5, Math.round(submitCount / GROUP_SIZE_CAP)));
  const personas: string[][] = Array.from({ length: personaCount }, () =>
    sampleDistinct(tagPool, randInt(rng, 6, 9), rng)
  );

  let submitterIdx = 0;
  const students: DemoSeedStudent[] = roster.map((r, i) => {
    const tempId = i + 1;
    const submit = submitterCodes.has(r.user_code);
    if (!submit) {
      return { tempId, user_code: r.user_code, name: r.name, tags: null, submit: false, avatar: false, evaluation: false, assessment: null, submittedOffsetDays: 0 };
    }

    // 亲和集 + 抖动（换 1 个标签）→ 组内相似、跨组有别
    const persona = personas[submitterIdx % personaCount];
    submitterIdx++;
    const tags = [...persona];
    if (tagPool.length > tags.length && rng() < 0.6) {
      tags.splice(randInt(rng, 0, tags.length - 1), 1);
      const extra = tagPool[Math.floor(rng() * tagPool.length)];
      if (!tags.includes(extra)) tags.push(extra);
    }

    return {
      tempId,
      user_code: r.user_code,
      name: r.name,
      tags,
      submit: true,
      avatar: rng() < 0.8,
      evaluation: rng() < 0.5,
      assessment: rng() < assessmentRate ? buildAssessment(rng, rng() < draftShare ? "draft" : "completed") : null,
      submittedOffsetDays: randInt(rng, 0, recentDays),
    };
  });

  const groupingResult = buildGrouping(buildFeatureVectors(toGroupingRows(students)));
  const nameByTempId = new Map(students.map((s) => [s.tempId, s.name]));
  const groups: DemoSeedGroup[] = groupingResult.groups.map((indexes, i) => ({
    groupNo: i + 1,
    cohesion: groupingResult.metrics.cohesion[i] ?? null,
    members: indexes.map((idx) => {
      const v = groupingResult.vectors[idx];
      return { tempId: v.studentId, userCode: v.userCode, name: nameByTempId.get(v.studentId) ?? "" };
    }),
  }));

  return {
    seed,
    class: { name: DEMO_CLASS_NAME, invitationCode: demoInviteCode(rng) },
    teacher,
    students,
    grouping: {
      strategy: GROUPING_STRATEGY,
      featureSources: describeSources(),
      groupSize: GROUP_SIZE_CAP,
      studentCount: groupingResult.metrics.studentCount,
      taggedCount: groupingResult.metrics.coveredCount,
      metricsJson: JSON.stringify(groupingResult.metrics),
      groups,
    },
  };
}

export { RIASEC_CODE };

/** 触发播种的生产 admin（写进分组历史批次的 actor 快照） */
export interface DemoSeedActor {
  id: number | null;
  name: string | null;
  role: string | null;
}

/** 物化器依赖注入：真实实现走 @/lib/db（作用域感知）；单测传 fake 断言调用序列、不触库不跑 sharp/fs */
export interface DemoSeedDeps {
  insertClass(name: string, invitationCode: string): Promise<number>;
  createAccount(spec: DemoAccountSpec): Promise<number>;
  insertTeacherClass(teacherId: number, classId: number): Promise<void>;
  getDefaultStorageBackend(): Promise<StorageBackendRow | undefined>;
  getStorage(backendId: number): Promise<StorageAdapter>;
  submitProfileWithVersion(
    userCode: string,
    tagsJson: string,
    avatarUrl: string,
    evaluationUrl: string,
    storageId: number,
    submittedAt?: string
  ): Promise<{ version: number }>;
  completeAssessmentResult(input: CompleteAssessmentInput): Promise<number>;
  upsertAssessmentDraft(
    userId: number,
    assessmentId: number,
    answersJson: string,
    itemsJson: string
  ): Promise<number>;
  applyGroupingResult(classId: number, groups: ClassGroupingInput[], batch: NewGroupBatchInput): Promise<number>;
  getAssessmentByCode(code: string): Promise<AssessmentRow | undefined>;
  renderImage(kind: DemoImageKind, seedKey: string): Promise<Buffer>;
  demoPasswordHash(): Promise<string>;
  makeThumbnail(buffer: Buffer, kind: DemoImageKind): Promise<Buffer>;
}

export interface DemoSeedReport {
  classId: number;
  students: number;
  submitted: number;
  assessed: number;
  drafts: number;
  groups: number;
  images: number;
}

/** 演示库与生产隔离、可弃：直接格式化到与 getNow() 同口径的 `YYYY-MM-DD HH:mm:ss` 回填提交时间 */
function formatDemoTimestamp(offsetDays: number): string {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
}

/**
 * 物化 DemoSeedPlan：写演示库 + 落占位图 + 真实分组落库。**必须在调用方的 runInDemoScope 内执行**
 * （本函数不自行改作用域）；storage 写入经作用域感知基目录自动落 uploads/demo/。
 */
export async function materializeDemoSeed(
  plan: DemoSeedPlan,
  deps: DemoSeedDeps,
  actor: DemoSeedActor
): Promise<DemoSeedReport> {
  const passwordHash = await deps.demoPasswordHash();
  const classId = await deps.insertClass(plan.class.name, plan.class.invitationCode);

  const teacherId = await deps.createAccount({
    user_code: plan.teacher.user_code,
    name: plan.teacher.name,
    role: "teacher",
    password_hash: passwordHash,
    class_id: null,
  });
  await deps.insertTeacherClass(teacherId, classId);

  const backend = await deps.getDefaultStorageBackend();
  if (!backend) throw new Error("演示库无默认存储后端（init 应已播种本地后端）");
  const storage = await deps.getStorage(backend.id);

  const assessment = await deps.getAssessmentByCode(RIASEC_CODE);

  const idByTemp = new Map<number, number>();
  let submitted = 0;
  let assessed = 0;
  let drafts = 0;
  let images = 0;

  for (const s of plan.students) {
    const realId = await deps.createAccount({
      user_code: s.user_code,
      name: s.name,
      role: "student",
      password_hash: passwordHash,
      class_id: classId,
    });
    idByTemp.set(s.tempId, realId);
    if (!s.submit) continue;

    let avatarUrl = "";
    if (s.avatar) {
      const key = generateObjectKey("avatar", s.user_code);
      const buf = await deps.renderImage("avatar", s.user_code);
      await storage.upload(key, buf, "image/jpeg");
      const thumb = await deps.makeThumbnail(buf, "avatar").catch(() => null);
      if (thumb) await storage.upload(getThumbnailKey(key), thumb, "image/jpeg");
      avatarUrl = await storage.getSignedUrl(key);
      images++;
    }
    let evaluationUrl = "";
    if (s.evaluation) {
      const key = generateObjectKey("evaluation", s.user_code);
      const buf = await deps.renderImage("evaluation", s.user_code);
      await storage.upload(key, buf, "image/jpeg");
      const thumb = await deps.makeThumbnail(buf, "evaluation").catch(() => null);
      if (thumb) await storage.upload(getThumbnailKey(key), thumb, "image/jpeg");
      evaluationUrl = await storage.getSignedUrl(key);
      images++;
    }

    await deps.submitProfileWithVersion(
      s.user_code,
      JSON.stringify(s.tags ?? []),
      avatarUrl,
      evaluationUrl,
      backend.id,
      formatDemoTimestamp(s.submittedOffsetDays)
    );
    submitted++;

    if (s.assessment && assessment) {
      const answersJson = JSON.stringify(s.assessment.answers);
      if (s.assessment.kind === "draft") {
        // 进行中草稿：本轮卷子的前缀答案 + 同一份抽题快照、无结果；可被 /api/shared/assessment/answer 续答并最终计分
        await deps.upsertAssessmentDraft(realId, assessment.id, answersJson, s.assessment.itemsJson);
        drafts++;
      } else {
        await deps.completeAssessmentResult({
          userId: realId,
          assessmentId: assessment.id,
          answersJson,
          itemsJson: s.assessment.itemsJson,
          scoresJson: s.assessment.scoresJson ?? null,
          typeCode: s.assessment.typeCode ?? null,
        });
        assessed++;
      }
    }
  }

  const groups: ClassGroupingInput[] = plan.grouping.groups.map((g) => ({
    group_no: g.groupNo,
    user_ids: g.members.map((m) => idByTemp.get(m.tempId)).filter((v): v is number => v != null),
  }));
  const batch: NewGroupBatchInput = {
    classId,
    strategy: plan.grouping.strategy,
    featureSources: plan.grouping.featureSources,
    groupSize: plan.grouping.groupSize,
    studentCount: plan.grouping.studentCount,
    taggedCount: plan.grouping.taggedCount,
    metrics: plan.grouping.metricsJson,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    groups: plan.grouping.groups.map((g) => ({
      groupNo: g.groupNo,
      cohesion: g.cohesion,
      members: g.members.map((m) => ({
        userId: idByTemp.get(m.tempId) ?? 0,
        userCode: m.userCode,
        name: m.name,
      })),
    })),
  };
  await deps.applyGroupingResult(classId, groups, batch);

  return {
    classId,
    students: plan.students.length,
    submitted,
    assessed,
    drafts,
    groups: plan.grouping.groups.length,
    images,
  };
}

/** 生产用默认依赖：db 写走 @/lib/db 封装（依调用作用域路由演示库）、storage 走作用域感知本地适配器 */
export const defaultDemoSeedDeps: DemoSeedDeps = {
  insertClass,
  createAccount: createDemoAccount,
  insertTeacherClass,
  getDefaultStorageBackend,
  getStorage,
  submitProfileWithVersion,
  completeAssessmentResult,
  upsertAssessmentDraft,
  applyGroupingResult,
  getAssessmentByCode,
  renderImage: renderDemoImage,
  demoPasswordHash: hashDemoPassword,
  makeThumbnail: (buffer, kind) => createThumbnail(buffer, kind),
};
