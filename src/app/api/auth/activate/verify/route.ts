import { NextRequest, NextResponse } from "next/server";
import { resolveActivation } from "@/lib/activate";

/**
 * 激活前置核验（两步激活第一步，Issue #93）：
 * 校验学号 + 姓名 + 邀请码三要素，不设置密码。
 * 通过时返回名单姓名，供第二步问候语展示。
 */
export async function POST(request: NextRequest) {
  try {
    const { userCode, name, inviteCode } = await request.json();

    const result = await resolveActivation(
      String(userCode ?? ""),
      String(name ?? ""),
      String(inviteCode ?? "")
    );
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, name: result.name });
  } catch (err) {
    console.error("Activate verify POST error:", err);
    return NextResponse.json({ ok: false, error: "服务器错误" }, { status: 500 });
  }
}
