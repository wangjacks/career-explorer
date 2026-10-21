/** 统计分组身份：班级用班名作 key，未分班用内部哨兵键；label 只负责展示。 */
export const UNASSIGNED_CLASS_KEY = "__unassigned__";
export const UNASSIGNED_CLASS_LABEL = "未分班";
export const UNASSIGNED_CLASS_TEACHER_LABEL = "还没分班";

/** 新建/改名禁止使用的名称：哨兵键与两套展示文案 */
export const RESERVED_CLASS_NAMES = [
  UNASSIGNED_CLASS_KEY,
  UNASSIGNED_CLASS_LABEL,
  UNASSIGNED_CLASS_TEACHER_LABEL,
] as const;

export interface ClassGroup {
  key: string;
  label: string;
}

export function isUnassignedClassKey(key: string): boolean {
  return key === UNASSIGNED_CLASS_KEY;
}

export function toClassGroup(
  classId: number | string | null | undefined,
  className: string | null | undefined
): ClassGroup {
  if (classId === null || classId === undefined || classId === "" || !className) {
    return { key: UNASSIGNED_CLASS_KEY, label: UNASSIGNED_CLASS_LABEL };
  }
  return { key: className, label: className };
}

export function isReservedClassName(name: string): boolean {
  return (RESERVED_CLASS_NAMES as readonly string[]).includes(name);
}
