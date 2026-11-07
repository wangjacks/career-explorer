/**
 * 小组工作区（#346）的纯函数：共同兴趣、兴趣覆盖、任务进度、逾期判定、
 * 输入长度与截止时间归一化。路由与界面都从这里取口径，单测直接测本文件。
 */

/** 公告标题 / 正文长度上限（服务端校验；界面同步展示计数） */
export const GROUP_POST_TITLE_MAX = 40;
export const GROUP_POST_CONTENT_MAX = 1000;
/** 任务标题 / 说明长度上限 */
export const GROUP_TASK_TITLE_MAX = 60;
export const GROUP_TASK_DESC_MAX = 500;
/** 发布频率：同一作者在一个工作区内，窗口内最多发这么多条（防刷） */
export const GROUP_RATE_WINDOW_MS = 60_000;
export const GROUP_POST_RATE_MAX = 5;
export const GROUP_TASK_RATE_MAX = 5;
/** 兴趣覆盖的分母：RIASEC 六型 */
export const RIASEC_TOTAL = 6;

export type GroupTaskStatus = "open" | "in_progress" | "done";

export const GROUP_TASK_STATUS_LABELS: Record<GroupTaskStatus, string> = {
  open: "待认领",
  in_progress: "进行中",
  done: "已完成",
};

export function isGroupTaskStatus(value: unknown): value is GroupTaskStatus {
  return value === "open" || value === "in_progress" || value === "done";
}

/** 成员 tags 列（JSON 文本）→ 标签名数组；坏数据按空处理，不抛错 */
export function parseMemberTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "");
  } catch {
    return [];
  }
}

/**
 * 组内共同兴趣 Top3：至少 2 人共有的标签，按人数降序、同人数按标签名字典序。
 * **只做聚合展示，不指向个人**——返回值不含成员标识。
 */
export function commonInterests(tagLists: string[][], topN = 3): string[] {
  const counts = new Map<string, number>();
  for (const tags of tagLists) {
    for (const tag of new Set(tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, topN)
    .map(([tag]) => tag);
}

export interface InterestCoverage {
  /** 已测同学里覆盖到的主导兴趣型数量 */
  covered: number;
  /** 固定 6（RIASEC 六型） */
  total: number;
  /** 有有效兴趣结果的同学数（分母说明用，不指向个人） */
  tested: number;
}

/**
 * 组内兴趣覆盖（聚合，不指向个人）：按三字码首位去重计数。
 * 无有效结果时 covered=0、tested=0；界面据此显示「还没有同学完成兴趣测评」。
 */
export function interestCoverage(typeCodes: (string | null | undefined)[]): InterestCoverage {
  const valid = typeCodes
    .filter((code): code is string => typeof code === "string" && code.trim() !== "")
    .map((code) => code.trim().charAt(0).toUpperCase())
    .filter((letter) => "RIASEC".includes(letter));
  return { covered: new Set(valid).size, total: RIASEC_TOTAL, tested: valid.length };
}

export interface TaskProgress {
  total: number;
  done: number;
  /** 0–100 的整数 */
  percent: number;
}

/** 任务整体进度（已完成 / 总数），空列表为 0% */
export function taskProgress(tasks: { status: string }[]): TaskProgress {
  const total = tasks.length;
  const done = tasks.filter((task) => task.status === "done").length;
  return { total, done, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** 截止时间是否已过（两边都是 `YYYY-MM-DD HH:mm:ss` 文本，按字典序比较即可） */
export function isTaskOverdue(dueAt: string | null, now: string): boolean {
  if (!dueAt) return false;
  return dueAt < now;
}

/**
 * 与适配器 getNow() 同格式、同口径的本地时间文本（Asia/Shanghai）。
 * 必须显式指定时区：生产服务器常是 UTC，用 `getFullYear()` 这类本地时间方法会把
 * `deleted_at` / `completed_at` / 频率窗口算成 UTC，和 createdAt 差 8 小时。
 */
export function formatLocalDateTime(date: Date): string {
  return date.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
}

export interface NormalizedDueAt {
  ok: true;
  value: string | null;
}
export interface InvalidDueAt {
  ok: false;
  error: string;
}

/**
 * 把界面传来的截止时间归一化为库内文本（本地墙钟时间，不跨时区换算）：
 * 接受 `YYYY-MM-DD`（当天 23:59）与 `YYYY-MM-DDTHH:mm` / `YYYY-MM-DD HH:mm`；空值表示不设截止。
 */
export function normalizeDueAt(input: unknown): NormalizedDueAt | InvalidDueAt {
  if (input === null || input === undefined || input === "") return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false, error: "截止时间格式不正确" };
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(input.trim());
  if (!match) return { ok: false, error: "截止时间格式不正确" };
  const [, year, month, day, hour, minute] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const h = hour === undefined ? 23 : Number(hour);
  const mi = minute === undefined ? 59 : Number(minute);
  const probe = new Date(y, m - 1, d, h, mi, 0);
  if (
    probe.getFullYear() !== y ||
    probe.getMonth() !== m - 1 ||
    probe.getDate() !== d ||
    probe.getHours() !== h ||
    probe.getMinutes() !== mi
  ) {
    return { ok: false, error: "截止时间不是有效日期" };
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  // 直接回写用户输入的墙钟分量，不经过时区换算
  return { ok: true, value: `${year}-${month}-${day} ${pad(h)}:${pad(mi)}:00` };
}

export interface PostInput {
  title: string;
  content: string;
}

/** 公告输入校验：空标题 / 空正文 / 超长都拒绝，返回归一化后的值 */
export function validatePostInput(
  title: unknown,
  content: unknown
): { ok: true; value: PostInput } | { ok: false; error: string } {
  if (typeof title !== "string" || typeof content !== "string") {
    return { ok: false, error: "标题和内容不能为空" };
  }
  const trimmedTitle = title.trim();
  const trimmedContent = content.trim();
  if (!trimmedTitle) return { ok: false, error: "请填写公告标题" };
  if (!trimmedContent) return { ok: false, error: "请填写公告内容" };
  if (trimmedTitle.length > GROUP_POST_TITLE_MAX) {
    return { ok: false, error: `公告标题不能超过 ${GROUP_POST_TITLE_MAX} 字` };
  }
  if (trimmedContent.length > GROUP_POST_CONTENT_MAX) {
    return { ok: false, error: `公告内容不能超过 ${GROUP_POST_CONTENT_MAX} 字` };
  }
  return { ok: true, value: { title: trimmedTitle, content: trimmedContent } };
}

export interface TaskInput {
  title: string;
  description: string | null;
  dueAt: string | null;
}

/** 任务输入校验：标题必填、说明可空、截止可空 */
export function validateTaskInput(
  title: unknown,
  description: unknown,
  dueAt: unknown
): { ok: true; value: TaskInput } | { ok: false; error: string } {
  if (typeof title !== "string") return { ok: false, error: "请填写任务标题" };
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return { ok: false, error: "请填写任务标题" };
  if (trimmedTitle.length > GROUP_TASK_TITLE_MAX) {
    return { ok: false, error: `任务标题不能超过 ${GROUP_TASK_TITLE_MAX} 字` };
  }
  let desc: string | null = null;
  if (description !== undefined && description !== null && description !== "") {
    if (typeof description !== "string") return { ok: false, error: "任务说明格式不正确" };
    desc = description.trim();
    if (desc.length > GROUP_TASK_DESC_MAX) {
      return { ok: false, error: `任务说明不能超过 ${GROUP_TASK_DESC_MAX} 字` };
    }
    if (!desc) desc = null;
  }
  const due = normalizeDueAt(dueAt);
  if (!due.ok) return due;
  return { ok: true, value: { title: trimmedTitle, description: desc, dueAt: due.value } };
}

/** 消息 → 学生可读的错误文案（路由复用） */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
