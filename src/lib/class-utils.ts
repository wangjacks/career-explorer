import { getClassByName } from "./db";
import { isReservedClassName } from "./class-identity";

/**
 * 班级名解析（#160）：单条添加与批量导入共用同一口径，
 * 避免两处各写一遍导致「班级名被静默丢弃 / 静默不绑定」。
 *
 * 约定：
 * - 未提交或仅空白 → provided=false，调用方不应改动学生原有班级
 * - 命中 → classId 为班级 id，调用方写入 class_id
 * - 未命中 → provided=true 且 classId=null，调用方不绑定但**必须给出明确反馈**
 */
export interface ClassResolution {
  /** 是否提交了非空班级名 */
  provided: boolean;
  /** 归一化（trim）后的班级名 */
  className: string;
  /** 命中时的班级 id；未提交或未命中为 null */
  classId: number | null;
}

/** 班级名归一化（唯一入口）：仅去掉首尾空白，不做大小写 / 全半角折叠 */
export function normalizeClassName(raw: unknown): string {
  return String(raw ?? "").trim();
}

export interface ClassNameValidation {
  name: string;
  error: string | null;
}

/** 新建/改名校验：保留名与未分班展示文案冲突，只在写入前拦截，不迁移存量 */
export function validateNewClassName(raw: unknown): ClassNameValidation {
  const name = normalizeClassName(raw);
  if (!name) return { name: "", error: "请输入班级名称" };
  if (isReservedClassName(name)) {
    return { name, error: "该班级名称为系统保留，请换一个名称" };
  }
  return { name, error: null };
}

export async function resolveClassByName(raw: unknown): Promise<ClassResolution> {
  const className = normalizeClassName(raw);
  if (!className) {
    return { provided: false, className: "", classId: null };
  }
  const klass = await getClassByName(className);
  return { provided: true, className, classId: klass ? klass.id : null };
}

/**
 * 批量班级名解析（#193 批量导入去重）：
 * 先按归一化名称去重，再逐个走 `resolveClassByName`，因此查库次数只与
 * **去重后的名称数**有关，与名单行数无关；解析口径与单条添加完全一致
 * （口径统一交给 `resolveClassByName`，不另起一套内存比较语义）。
 *
 * 返回数组与入参**一一对应**（同长度、同顺序），调用方按下标取用，
 * 不存在「索引来自 A 字段、查询用 B 字段导致查不中」的静默失败路径。
 */
export async function resolveClassNames(rawNames: unknown[]): Promise<ClassResolution[]> {
  const resolutions = new Map<string, ClassResolution>();
  for (const raw of rawNames) {
    const className = normalizeClassName(raw);
    if (resolutions.has(className)) continue;
    resolutions.set(className, await resolveClassByName(className));
  }
  return rawNames.map((raw) => resolutions.get(normalizeClassName(raw)) as ClassResolution);
}
