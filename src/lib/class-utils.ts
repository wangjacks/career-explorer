import { getClassByName } from "./db";

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

export async function resolveClassByName(raw: unknown): Promise<ClassResolution> {
  const className = String(raw ?? "").trim();
  if (!className) {
    return { provided: false, className: "", classId: null };
  }
  const klass = await getClassByName(className);
  return { provided: true, className, classId: klass ? klass.id : null };
}
