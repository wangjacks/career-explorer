/**
 * 学生账户激活校验（Issue #93）。
 * 账户须先由教师导入名单后才存在；激活须学号 + 姓名 + 班级邀请码三者一致。
 * 纯函数实现，便于单元测试；文案映射由调用方（API 路由）负责。
 */

export type ActivationError = "not-in-roster" | "already-activated" | "mismatch";

export interface ActivationCandidate {
  role: string;
  name: string;
  class_id: number | null;
  password_hash: string | null;
}

/**
 * 校验激活请求是否合法。
 * @param user 按学号查询到的用户记录（不存在时为 undefined）
 * @param inputName 用户提交的姓名（未 trim）
 * @param inviteClassId 邀请码对应班级的 id
 * @returns null = 校验通过；否则返回错误类型
 */
export function validateActivation(
  user: ActivationCandidate | undefined,
  inputName: string,
  inviteClassId: number
): ActivationError | null {
  // 学号不在名单中，或存在但不是学生角色（按不存在处理，避免泄露名单信息）
  if (!user || user.role !== "student") {
    return "not-in-roster";
  }
  // 已设置过密码 = 已激活
  if (user.password_hash) {
    return "already-activated";
  }
  // 姓名须与名单一致；邀请码班级须与学号所属班级一致（未分班学生无法激活）
  if (user.name.trim() !== inputName.trim() || user.class_id !== inviteClassId) {
    return "mismatch";
  }
  return null;
}
