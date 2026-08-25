import { NextRequest, NextResponse } from "next/server";
import {
  getActiveTags,
  getClasses,
  getDefaultStorageBackend,
  getStorageBackend,
  getSubmissionDeadline,
  getUserById,
  getMaxCustomTags,
  isSubmissionClosed,
  upsertSubmission,
} from "@/lib/db";
import { normalizeTagNames, extractCustomTags } from "@/lib/tag-utils";
import { verifyToken } from "@/lib/token";
import { getRequestContext, recordAudit } from "@/lib/audit";

/** 单个标签名称长度上限（与标签管理端新增校验一致） */
const MAX_TAG_NAME_LENGTH = 50;

/** 会话查询：登录学生获取本人档案（含班级名与标签名） */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const result = await verifyToken(token);
    if (!result.valid) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }
    if (result.role !== "student" || result.uid == null) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const user = await getUserById(result.uid);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const classes = await getClasses();
    const className =
      user.class_id != null
        ? classes.find((c) => c.id === user.class_id)?.name ?? "未分班"
        : "未分班";

    // #94：标签以原始文本直存，读取原样返回（容忍旧格式的 ID 数组，转为字符串数组）
    let tagNames: string[] = [];
    if (user.tags) {
      try {
        const parsed = JSON.parse(user.tags);
        tagNames = Array.isArray(parsed) ? parsed.map((t) => String(t)) : [];
      } catch (err) {
        console.error("Profile GET tags parse error:", err);
      }
    }

    return NextResponse.json({
      name: user.name,
      user_code: user.user_code,
      class_name: className,
      tags: tagNames,
      avatar_url: user.avatar_url || "",
      evaluation_url: user.evaluation_url || "",
      storage_id: user.storage_id,
      submitted_at: user.submitted_at,
      // 提交时限（#96）：服务端计算截止状态，不信任客户端时钟
      submissionDeadline: await getSubmissionDeadline(),
      submissionClosed: await isSubmissionClosed(),
    });
  } catch (err) {
    console.error("Profile GET error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    // 已移除快速提交通道（#92）：保存必须学生本人登录，身份只取自会话，拒绝显式指定学号，杜绝覆盖他人数据
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    const result = await verifyToken(token);
    if (!result.valid) {
      return NextResponse.json({ error: "登录已过期，请重新登录" }, { status: 401 });
    }
    if (result.role !== "student" || result.uid == null) {
      return NextResponse.json({ error: "仅学生本人可提交档案" }, { status: 403 });
    }
    const currentUser = await getUserById(result.uid);
    if (!currentUser) {
      return NextResponse.json({ error: "用户不存在" }, { status: 401 });
    }

    // 提交时限强制拦截（#96）：超过截止时间一律拒绝保存（含已提交学生的修改），前端禁用仅为体验，服务端是最终防线
    if (await isSubmissionClosed()) {
      void recordAudit({
        actor_id: currentUser.id, actor_user_code: currentUser.user_code, actor_name: currentUser.name, actor_role: currentUser.role,
        action: "profile:submit", method: "POST", path: "/api/shared/profile",
        resource_type: "profile", resource_id: currentUser.user_code,
        status: "failed", error_message: "档案提交已截止，无法保存", ip, user_agent, metadata: null,
      });
      return NextResponse.json({ error: "档案提交已截止，无法保存" }, { status: 403 });
    }

    const body = await request.json();
    if (body.studentId !== undefined) {
      return NextResponse.json({ error: "不支持指定学号，档案保存仅限本人操作" }, { status: 400 });
    }
    const { tags, avatarUrl, evaluationUrl } = body;
    const studentId = currentUser.user_code;

    // 文件所在后端（#111）：以上传响应回传的 id 为准（验证存在）；未重选图片不传 → 保留当前记录值；非法值 → 默认后端
    let storageId: number | null = null;
    if (typeof body.storageId === "number" && Number.isInteger(body.storageId)) {
      storageId = (await getStorageBackend(body.storageId))?.id ?? null;
    }
    if (storageId === null) {
      storageId = currentUser.storage_id ?? (await getDefaultStorageBackend())?.id ?? null;
    }
    if (storageId === null) {
      return NextResponse.json({ error: "存储后端未初始化" }, { status: 500 });
    }

    if (!Array.isArray(tags) || tags.length === 0) {
      return NextResponse.json({ error: "标签不能为空" }, { status: 400 });
    }

    // #94：标签文本直存（预设 + 自定义），入库前规范化；自定义部分受配置上限约束（后端二次校验）
    const names = normalizeTagNames(tags as unknown[]);
    if (names.length === 0) {
      return NextResponse.json({ error: "标签不能为空" }, { status: 400 });
    }
    if (names.some((n) => n.length > MAX_TAG_NAME_LENGTH)) {
      return NextResponse.json({ error: `标签名称不能超过 ${MAX_TAG_NAME_LENGTH} 字` }, { status: 400 });
    }
    const allTags = await getActiveTags();
    const customNames = extractCustomTags(names, allTags);
    const maxCustomTags = await getMaxCustomTags();
    if (customNames.length > maxCustomTags) {
      return NextResponse.json(
        { error: `自定义标签最多 ${maxCustomTags} 个，当前 ${customNames.length} 个` },
        { status: 400 }
      );
    }

    await upsertSubmission(studentId, JSON.stringify(names), avatarUrl || "", evaluationUrl || "", storageId);
    // 档案提交/修改审计（#110）：仅记标签计数，不记标签内容（学生数据不重复入库）
    void recordAudit({
      actor_id: currentUser.id, actor_user_code: currentUser.user_code, actor_name: currentUser.name, actor_role: currentUser.role,
      action: "profile:submit", method: "POST", path: "/api/shared/profile",
      resource_type: "profile", resource_id: studentId,
      status: "success", error_message: null, ip, user_agent,
      metadata: { tagCount: names.length, hasAvatar: Boolean(avatarUrl), hasEvaluation: Boolean(evaluationUrl) },
    });
    return NextResponse.json({ message: "保存成功" });
  } catch (err) {
    console.error("Profile POST error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
