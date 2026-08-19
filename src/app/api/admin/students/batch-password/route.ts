import { NextRequest, NextResponse } from "next/server";
import { getUserByCode, updateUser } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { generatePassword } from "@/lib/password";

/** POST：为多名学生批量重置密码，每人生成不同的随机密码并哈希落库 */
export async function POST(request: NextRequest) {
  try {
    const { studentIds } = await request.json();
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json({ error: "请选择要重置密码的学生" }, { status: 400 });
    }

    const results: { user_code: string; name: string; password: string }[] = [];
    let invalid = 0;

    for (const rawId of studentIds) {
      const user = await getUserByCode(String(rawId));
      if (!user || user.role !== "student") {
        invalid++;
        continue;
      }
      const password = generatePassword();
      await updateUser(user.id, { password_hash: await hashPassword(password) });
      results.push({ user_code: user.user_code, name: user.name, password });
    }

    if (results.length === 0) {
      return NextResponse.json({ error: "没有可重置的学生" }, { status: 400 });
    }

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
