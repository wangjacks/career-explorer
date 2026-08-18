import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/token";
import { getTeacherClassPairs } from "@/lib/db";

/** 从请求 cookie 解析会话（proxy 已前置校验，此处取角色信息） */
export async function getSession(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value;
  if (!token) return null;
  const result = await verifyToken(token);
  return result.valid ? result : null;
}

/**
 * 判定会话对指定班级的修改权限：
 * admin 全权；teacher 仅限自己创建的班级（依据 teacher_classes）。
 */
export async function canModifyClass(
  session: { role?: string; uid?: number | null },
  classId: number
): Promise<boolean> {
  if (session.role === "admin") return true;
  if (session.role === "teacher" && session.uid != null) {
    const pairs = await getTeacherClassPairs();
    return pairs.some((p) => p.teacher_id === session.uid && p.class_id === classId);
  }
  return false;
}
