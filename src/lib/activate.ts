/**
 * 学生账户激活校验（Issue #93）。
 * 账户须先由教师导入名单后才存在；激活须学号 + 姓名 + 班级邀请码三者一致。
 * 纯函数实现，便于单元测试；文案映射由调用方（API 路由）负责。
 */

import { getClassByInviteCode, getUserByCode } from "./db";

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

/** 激活错误类型 → HTTP 状态码与用户文案（姓名/邀请码类错误统一提示，防探测名单信息） */
export const ACTIVATION_ERROR_TEXT: Record<ActivationError, { status: number; error: string }> = {
  "not-in-roster": { status: 404, error: "该学号不在名单中，请联系教师导入" },
  "already-activated": { status: 409, error: "该账户已激活，请直接登录" },
  mismatch: { status: 400, error: "学号、姓名或班级邀请码不匹配" },
};

export type ResolveResult =
  | { ok: true; name: string; userId: number }
  | { ok: false; status: number; error: string };

/**
 * 激活前置核验（供 verify 与 activate 端点共用）：
 * 参数格式校验 → 邀请码有效性 → 名单归属/姓名/班级三要素校验。
 * 通过时返回名单姓名（供前端问候语展示，以名单为准）。
 */
export async function resolveActivation(
  userCode: string,
  inputName: string,
  inviteCode: string
): Promise<ResolveResult> {
  const code = userCode.trim();
  const name = inputName.trim();
  const invite = inviteCode.trim();

  if (!/^\d{12}$/.test(code)) {
    return { ok: false, status: 400, error: "学号须为 12 位数字" };
  }
  if (!name) {
    return { ok: false, status: 400, error: "请输入姓名" };
  }
  if (!invite) {
    return { ok: false, status: 400, error: "请输入邀请码" };
  }

  const klass = await getClassByInviteCode(invite);
  if (!klass) {
    return { ok: false, status: 400, error: "邀请码无效" };
  }

  const user = await getUserByCode(code);
  const activationError = validateActivation(user, name, klass.id);
  if (activationError) {
    const { status, error } = ACTIVATION_ERROR_TEXT[activationError];
    return { ok: false, status, error };
  }
  return { ok: true, name: user!.name, userId: user!.id };
}
