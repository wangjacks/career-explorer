/**
 * 演示账户原语（#253）：专用号段 + 确定性构造器。姓名池与取名纯函数见零依赖的 `demo-names.ts`（#369）。
 * 名册学生即「仅学生角色的账户」（可登录、可提交），故「批量生成学生」=「批量创建账户」。
 * 这些纯构造器与 `createDemoAccount` 持久原语同时供 #278（访客 3 角色套装发放 / 管理）复用。
 */
import { insertUser, type NewUser } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { pickName, type Rng } from "./demo-names";

// re-export：姓名池相关符号迁到 demo-names.ts（客户端可共用），保持既有 `from "@/lib/demo-accounts"` 路径不变。
export { pick, pickName } from "./demo-names";
export type { Rng } from "./demo-names";

/**
 * mulberry32：小而确定的 32 位 PRNG。同一种子 → 同一序列。
 * 生产播种每次传新种子（不可复现），测试传固定种子（确定输出）。
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// —— 专用号段（保持位数不变量：学生 12 位 / 教师 8 位 / 管理员 5 位；`9` 前缀便于一眼识别、且过既有校验）——
export const DEMO_STUDENT_PREFIX = "9";
export const DEMO_TEACHER_PREFIX = "99";
export const DEMO_ADMIN_PREFIX = "9";

/** 演示学生编号：`9` + 11 位序号（满足 /^\d{12}$/，过 activate.ts 学号校验） */
export function nextDemoStudentCode(seq: number): string {
  return DEMO_STUDENT_PREFIX + String(seq).padStart(11, "0");
}

/** 演示教师编号：`99` + 6 位序号（满足 /^\d{8}$/） */
export function nextDemoTeacherCode(seq: number): string {
  return DEMO_TEACHER_PREFIX + String(seq).padStart(6, "0");
}

/** 演示管理员编号：`9` + 4 位序号（5 位，与生产 admin 1xxxx 区分；#278 预留，#253 不建） */
export function nextDemoAdminCode(seq: number): string {
  return DEMO_ADMIN_PREFIX + String(seq).padStart(4, "0");
}

/** 演示班级名（种与访客账户管理共用，避免字面量漂移） */
export const DEMO_CLASS_NAME = "演示班级";

// —— 访客账户号段（#278）：三个角色身份由同一 seq 派生，故 seq 必须避开名册（1..20）——
export const VISITOR_SEQ_START = 1000;
/** 上限由 admin 号 `9`+4 位决定 */
export const VISITOR_SEQ_MAX = 9999;

/** 同一访客账户的三角色编号（admin/teacher/student 身份共享一个 seq） */
export function demoAccountCodes(seq: number): { admin: string; teacher: string; student: string } {
  return {
    admin: nextDemoAdminCode(seq),
    teacher: nextDemoTeacherCode(seq),
    student: nextDemoStudentCode(seq),
  };
}

/** 从专用号段编号反解角色与 seq；非演示号段 / 非法输入返回 null */
export function parseDemoSeq(userCode: string): { role: DemoRole; seq: number } | null {
  if (typeof userCode !== "string") return null;
  if (/^99\d{6}$/.test(userCode)) return { role: "teacher", seq: Number(userCode.slice(2)) };
  if (/^9\d{11}$/.test(userCode)) return { role: "student", seq: Number(userCode.slice(1)) };
  if (/^9\d{4}$/.test(userCode)) return { role: "admin", seq: Number(userCode.slice(1)) };
  return null;
}

/** 若编号属于「访客账户」号段（seq ∈ [VISITOR_SEQ_START, VISITOR_SEQ_MAX]）返回 seq；名册 seq 较小故返回 null */
export function visitorSeqOf(userCode: string): number | null {
  const parsed = parseDemoSeq(userCode);
  if (!parsed) return null;
  return parsed.seq >= VISITOR_SEQ_START && parsed.seq <= VISITOR_SEQ_MAX ? parsed.seq : null;
}

/** 访客 seq 纯校验（路由把非法 seq 映射为 400） */
export function assertVisitorSeq(seq: number): void {
  if (!Number.isInteger(seq) || seq < VISITOR_SEQ_START || seq > VISITOR_SEQ_MAX) {
    throw new Error(`访客演示序号非法（须为 ${VISITOR_SEQ_START}–${VISITOR_SEQ_MAX} 的整数）`);
  }
}

/** 名册演示账号统一密码（一次性哈希复用）。访客套装的随机/自设密码属 #278，不在此列 */
export const DEMO_PASSWORD = "demo1234";

/** 对统一演示密码取 bcrypt 哈希（整批播种只算一次，性能与确定性） */
export function hashDemoPassword(): Promise<string> {
  return hashPassword(DEMO_PASSWORD);
}

/** [min, max] 闭区间随机整数 */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export type DemoRole = "admin" | "teacher" | "student";

export interface DemoAccountSpec {
  user_code: string;
  name: string;
  role: DemoRole;
  /** 由调用方提供（名册用 hashDemoPassword 复用；访客套装由 #278 逐账户哈希） */
  password_hash?: string | null;
  class_id?: number | null;
}

export interface DemoStudentSpec {
  user_code: string;
  name: string;
}

/** 生成演示教师身份（8 位 `99` 号段 + 随机姓名） */
export function buildDemoTeacher(seq: number, rng: Rng): DemoStudentSpec {
  return { user_code: nextDemoTeacherCode(seq), name: pickName(rng) };
}

/** 批量生成名册学生身份（12 位 `9` 号段，序号唯一；姓名可重复） */
export function buildDemoRoster(count: number, rng: Rng): DemoStudentSpec[] {
  const roster: DemoStudentSpec[] = [];
  for (let i = 0; i < count; i++) {
    roster.push({ user_code: nextDemoStudentCode(i + 1), name: pickName(rng) });
  }
  return roster;
}

/**
 * 持久原语：创建一个演示账户（调用 @/lib/db.insertUser）。
 * 不在内部包裹作用域——由调用方决定（播种/发放流程整体处于 runInDemoScope 内）。
 */
export async function createDemoAccount(spec: DemoAccountSpec): Promise<number> {
  const user: NewUser = {
    user_code: spec.user_code,
    password_hash: spec.password_hash ?? undefined,
    role: spec.role,
    name: spec.name,
    class_id: spec.class_id ?? null,
  };
  return insertUser(user);
}
