import { NextRequest, NextResponse } from "next/server";
import { getProfileSubmission, getUserById, isSubmissionClosed, submitProfileWithVersion } from "@/lib/db";
import { verifyToken } from "@/lib/token";
import { getRequestContext, recordAudit } from "@/lib/audit";

/**
 * 学生恢复历史版本（#95）：
 * 截止后拒绝（403）→ 校验版本归属 → submitProfileWithVersion 生成新版本（审计链完整，不回写旧记录）→ 审计 profile:restore
 */
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    const result = await verifyToken(token);
    if (!result.valid) {
      return NextResponse.json({ error: "登录已过期，请重新登录" }, { status: 401 });
    }
    if (result.role !== "student" || result.uid == null) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const currentUser = await getUserById(result.uid);
    if (!currentUser) {
      return NextResponse.json({ error: "用户不存在" }, { status: 401 });
    }

    const body = (await request.json()) as { submissionId?: unknown };
    const submissionId = Number(body.submissionId);
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return NextResponse.json({ error: "版本参数无效" }, { status: 400 });
    }

    // 提交时限强制拦截（#96）：截止后禁止恢复（同档案保存规则）
    if (await isSubmissionClosed()) {
      void recordAudit({
        actor_id: currentUser.id, actor_user_code: currentUser.user_code, actor_name: currentUser.name, actor_role: currentUser.role,
        action: "profile:restore", method: "POST", path: "/api/shared/profile/submissions/restore",
        resource_type: "profile", resource_id: currentUser.user_code,
        status: "failed", error_message: "档案提交已截止，无法恢复", ip, user_agent, metadata: null,
      });
      return NextResponse.json({ error: "档案提交已截止，无法恢复" }, { status: 403 });
    }

    // 归属校验：历史版本必须属于本人
    const submission = await getProfileSubmission(submissionId);
    if (!submission || submission.user_id !== currentUser.id) {
      return NextResponse.json({ error: "版本不存在" }, { status: 404 });
    }

    // 恢复 = 以该版本内容生成新版本（users 表回写由事务函数完成）
    const { version } = await submitProfileWithVersion(
      currentUser.user_code,
      submission.tags ?? "[]",
      submission.avatar_url ?? "",
      submission.evaluation_url ?? "",
      submission.storage_id
    );
    void recordAudit({
      actor_id: currentUser.id, actor_user_code: currentUser.user_code, actor_name: currentUser.name, actor_role: currentUser.role,
      action: "profile:restore", method: "POST", path: "/api/shared/profile/submissions/restore",
      resource_type: "profile", resource_id: currentUser.user_code,
      status: "success", error_message: null, ip, user_agent,
      metadata: { restoredVersion: submission.version, newVersion: version },
    });
    return NextResponse.json({ message: "恢复成功", version });
  } catch (err) {
    console.error("Restore POST error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
