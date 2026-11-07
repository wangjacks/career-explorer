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

/** 会话形状（getSession 的返回值；结构类型，不依赖认证模块的具体签名） */
export type Session = { role?: string; uid?: number | null; name?: string };

type SessionLike = Session | null | undefined;

/** 写权限的班级范围：`null` = 不受限（admin）；其余角色拿到具体集合（教师=自建班，其他=空） */
export type ClassScope = Set<number> | null;

/**
 * 一次查库取回该会话可写的班级集合，路由内可对整批目标反复判定
 * （逐条调 `canModifyClass` 会让批量操作把 `teacher_classes` 查 N 遍）。
 */
export async function writableClassIds(session: SessionLike): Promise<ClassScope> {
  if (session?.role === "admin") return null;
  if (session?.role === "teacher" && session.uid != null) {
    const pairs = await getTeacherClassPairs();
    const uid = session.uid;
    return new Set(pairs.filter((p) => p.teacher_id === uid).map((p) => p.class_id));
  }
  return new Set();
}

/** 班级归属判定（依据 teacher_classes）；`null` 范围表示不受限 */
export function canWriteClass(scope: ClassScope, classId: number | null): boolean {
  if (scope === null) return true;
  return classId !== null && scope.has(classId);
}

/**
 * 学生归属判定：以 `users` 表当前 `class_id` 为准。
 * 未分班学生（`class_id` 为 NULL）不属于任何教师的管辖范围——教师无从证明归属。
 */
export function canWriteStudent(scope: ClassScope, student: { class_id: number | null }): boolean {
  return canWriteClass(scope, student.class_id);
}

/**
 * 判定会话对指定班级的修改权限：
 * admin 全权；teacher 仅限自己创建的班级（依据 teacher_classes）。
 */
export async function canModifyClass(session: SessionLike, classId: number): Promise<boolean> {
  if (session?.role === "admin") return true;
  return canWriteClass(await writableClassIds(session), classId);
}
