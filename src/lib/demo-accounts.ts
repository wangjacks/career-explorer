/**
 * 演示账户原语（#253）：专用号段 + 中文姓名池 + 确定性构造器。
 * 名册学生即「仅学生角色的账户」（可登录、可提交），故「批量生成学生」=「批量创建账户」。
 * 这些纯构造器与 `createDemoAccount` 持久原语同时供 #278（访客 3 角色套装发放 / 管理）复用。
 */
import { insertUser, type NewUser } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

/** 确定性 PRNG 类型：所有生成器接受注入的 rng，便于固定种子单测 */
export type Rng = () => number;

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

/** 名册演示账号统一密码（一次性哈希复用）。访客套装的随机/自设密码属 #278，不在此列 */
export const DEMO_PASSWORD = "demo1234";

/** 对统一演示密码取 bcrypt 哈希（整批播种只算一次，性能与确定性） */
export function hashDemoPassword(): Promise<string> {
  return hashPassword(DEMO_PASSWORD);
}

const SURNAMES = [
  "王", "李", "张", "刘", "陈", "杨", "黄", "赵", "周", "吴",
  "徐", "孙", "马", "朱", "胡", "郭", "何", "高", "林", "罗",
  "郑", "梁", "谢", "宋", "唐", "许", "邓", "冯", "韩", "曹",
];

const GIVEN_NAMES = [
  "伟", "芳", "娜", "敏", "静", "磊", "强", "洋", "艳", "勇",
  "军", "杰", "娟", "涛", "明", "超", "霞", "平", "刚", "桂英",
  "子轩", "梓涵", "浩然", "欣怡", "雨泽", "思远", "嘉怡", "博文", "宇航", "若曦",
];

/** 从数组按 rng 取一项 */
export function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)];
}

/** [min, max] 闭区间随机整数 */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** 随机中文姓名（姓 + 1~2 字名） */
export function pickName(rng: Rng): string {
  return pick(SURNAMES, rng) + pick(GIVEN_NAMES, rng);
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
