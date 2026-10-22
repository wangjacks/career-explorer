import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getUserByCode, updateUser, type UserRow } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { generatePassword } from "@/lib/password";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { WriteGuard } from "../../write-guard";

const ENTRY = {
  action: "student:batch-password",
  method: "POST",
  path: "/api/manage/students/batch-password",
  resource_type: "student",
} as const;

/** POST：为多名学生批量重置密码，每人生成不同的随机密码并哈希落库 */
async function POST_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const guard = await WriteGuard.from(request);
  const actor = guard.actor;
  try {
    if (!guard.session) return guard.unauthenticated();
    const { studentIds } = await request.json();
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json({ error: "请选择要重置密码的学生" }, { status: 400 });
    }

    // 归属校验（#171）：先全部判定再写入，任一学生越界则整批拒绝
    const targets: UserRow[] = [];
    let invalid = 0;
    for (const rawId of studentIds) {
      const user = await getUserByCode(String(rawId));
      if (!user || user.role !== "student") {
        invalid++;
        continue;
      }
      if (!guard.canWriteStudent(user)) {
        return guard.deny(ENTRY, null, "该学生不在你管理的班级", 403, {
          requested: studentIds.length,
          class_id: user.class_id,
        });
      }
      targets.push(user);
    }

    const results: { user_code: string; name: string; password: string }[] = [];
    for (const user of targets) {
      const password = generatePassword();
      await updateUser(user.id, { password_hash: await hashPassword(password) });
      results.push({ user_code: user.user_code, name: user.name, password });
    }

    if (results.length === 0) {
      void recordAudit({
        ...actor, ...ENTRY, resource_id: null,
        status: "failed", error_message: "没有可重置的学生", ip, user_agent,
        metadata: { requested: studentIds.length },
      });
      return NextResponse.json({ error: "没有可重置的学生" }, { status: 400 });
    }

    // 审计仅记人数，绝不记录生成的密码（#110）
    void recordAudit({
      ...actor, ...ENTRY, resource_id: null,
      status: "success", error_message: null, ip, user_agent,
      metadata: { reset: results.length, invalid },
    });

    const message =
      invalid > 0
        ? `已重置 ${results.length} 名学生，${invalid} 个学号无效`
        : `已重置 ${results.length} 名学生`;
    return NextResponse.json({ data: results, message });
  } catch (err) {
    console.error("Batch password reset error:", err);
    return NextResponse.json({ error: "批量重置密码失败" }, { status: 500 });
  }
}

export const POST = withDemoScope(POST_impl);
