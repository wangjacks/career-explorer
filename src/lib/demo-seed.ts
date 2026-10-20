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
  type Rng,
} from "./demo-accounts";
import {
  GROUPING_STRATEGY,
  GROUP_SIZE_CAP,
  buildGrouping,
} from "./grouping-utils";
import { buildFeatureVectors, describeSources } from "./grouping-features";
import { RIASEC_CODE, RIASEC_DIMENSIONS, RIASEC_QUESTIONS } from "./assessment-data";
import { scoreAssessment, type QuestionConfig } from "./assessment-scoring";
import type { UserRow } from "./db";

/** 与生产邀请码同字母表（去易混字符），但由注入 rng 驱动以保持纯函数 */
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface DemoSeedOptions {
  /** 名册学生数（默认 20） */
  studentCount?: number;
  /** 已提交比例，落在 [0.7,0.85]（默认 0.8 → 精确取 round(count*rate) 人提交） */
  submitRate?: number;
  /** 提交者中完成测评的比例（默认 0.75） */
  assessmentRate?: number;
  /** 提交时间散布的天数窗口（默认 30） */
  recentDays?: number;
  /** 预设标签叶子名快照（必填；lifecycle 在演示作用域内取 getActiveTags 过滤 type==="tag" 传入） */
  tagNames: string[];
}

export interface DemoSeedAssessment {
  answers: Record<number, number>;
  /** 计分引擎结果整体序列化，写 assessment_results.scores_json */
  scoresJson: string;
  typeCode: string;
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

/** 生成一份有效 RIASEC 作答（全题作答 → complete），向目标三字码加权，产出计分结果 */
function buildAssessment(rng: Rng): DemoSeedAssessment {
  const keys = RIASEC_DIMENSIONS.map((d) => d.key);
  const targetSet = new Set(shuffled(keys, rng).slice(0, 3));
  const answers: Record<number, number> = {};
  for (const q of RIASEC_QUESTIONS) {
    // 目标维度答 4–5（偏同意），其余 1–3（偏不同意），使三字码稳定落向目标
    answers[q.index] = targetSet.has(q.dimension) ? randInt(rng, 4, 5) : randInt(rng, 1, 3);
  }
  const result = scoreAssessment(RIASEC_DIMENSIONS, RIASEC_QUESTIONS as QuestionConfig[], answers, {
    mode: "typological",
  });
  return {
    answers,
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
  const submitRate = opts.submitRate ?? 0.8;
  const assessmentRate = opts.assessmentRate ?? 0.75;
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
      assessment: rng() < assessmentRate ? buildAssessment(rng) : null,
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
    class: { name: "演示班级", invitationCode: demoInviteCode(rng) },
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
