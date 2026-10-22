/**
 * 演示中文姓名池与取名纯函数（#369）。
 *
 * **零依赖不变量**：本模块不得 import 任何服务端模块（`@/lib/db` / `@/lib/auth` 等），
 * 以便客户端组件（DemoTab）与服务端（demo-accounts / service）共用同一份姓名池，
 * 而不把 bcrypt / mysql2 等原生依赖拖进客户端 bundle（同 `password.ts` 的两端通用先例）。
 */

/** 确定性 PRNG 类型：所有生成器接受注入的 rng，便于固定种子单测 */
export type Rng = () => number;

/** 访客账户名称长度上限，对齐 MySQL `users.name VARCHAR(50)`（SQLite 为 TEXT，绑定约束取 MySQL） */
export const DEMO_NAME_MAX = 50;

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

/** 随机中文姓名（姓 + 1~2 字名） */
export function pickName(rng: Rng): string {
  return pick(SURNAMES, rng) + pick(GIVEN_NAMES, rng);
}

/**
 * 归一访客名称：把内部连续空白与控制字符（含 `\n` `\r` `\t`）折叠为单空格并 trim，
 * 防止自定义名注入换行破坏凭据复制文本（`姓名：x\n标签：y`）与三行落库口径。
 * 返回空串表示「按留空处理」（由调用方回退随机）。非字符串一律视为留空。
 */
export function normalizeDemoName(raw?: string): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim();
}
