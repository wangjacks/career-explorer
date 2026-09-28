import { NextRequest, NextResponse } from "next/server";
import { getClasses } from "@/lib/db";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";
import { buildInviteUrl, generateInvitePoster, resolvePosterBaseUrl } from "@/lib/invite-poster";
import { canModifyClass, getSession } from "../../helpers";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 班级邀请海报（Issue #102）。
 * GET 返回 PNG：默认 inline 预览；`?download=1` 触发附件下载。
 * 权限与重置邀请码一致：admin 全权，teacher 仅限自己创建的班级。
 * 二维码指向 `/activate?invite=CODE`，激活安全仍由服务端三要素核验兜底。
 * 基址配置缺失或非法（#148）返回 503 + 中文原因，不产出错误域名的海报。
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  const { id: idParam } = await params;
  const id = Number(idParam);
  const path = `/api/manage/classes/${idParam}/poster`;

  try {
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "无效的班级 ID" }, { status: 400 });
    }

    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await canModifyClass(session, id))) {
      return NextResponse.json({ error: "无权限生成该班级邀请海报" }, { status: 403 });
    }

    const klass = (await getClasses()).find((c) => c.id === id);
    if (!klass) {
      return NextResponse.json({ error: "班级不存在" }, { status: 404 });
    }

    // 二维码需要可被学生手机访问的绝对链接：生产环境只认显式配置的公网地址，
    // 缺失或非法时报错而不是静默产出 localhost 海报（#148）。
    let baseUrl: string;
    let inviteUrl: string;
    try {
      baseUrl = resolvePosterBaseUrl(new URL(request.url).origin);
      inviteUrl = buildInviteUrl(baseUrl, klass.invitation_code);
    } catch (err) {
      console.error("Class poster base URL error:", err);
      void recordAudit({
        ...actor,
        action: "class:poster",
        method: "GET",
        path,
        resource_type: "class",
        resource_id: String(id),
        status: "failed",
        error_message: "海报基址配置错误",
        ip,
        user_agent,
        metadata: { failure: "base_url_config" },
      });
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "海报基址配置错误" },
        { status: 503 }
      );
    }

    const png = await generateInvitePoster({
      className: klass.name,
      inviteCode: klass.invitation_code,
      baseUrl,
    });

    const download = request.nextUrl.searchParams.get("download") === "1";
    void recordAudit({
      ...actor,
      action: "class:poster",
      method: "GET",
      path,
      resource_type: "class",
      resource_id: String(id),
      status: "success",
      error_message: null,
      ip,
      user_agent,
      metadata: { download },
    });

    const filename = `邀请海报-${klass.name}.png`;
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": download
          ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
          : "inline",
        // 邀请码可能被重置，禁止缓存旧海报
        "Cache-Control": "no-store",
        // 让面板把二维码里真正生效的链接显示给管理员核对（#148）
        "X-Invite-Url": inviteUrl,
      },
    });
  } catch (err) {
    console.error("Class poster error:", err);
    void recordAudit({
      ...actor,
      action: "class:poster",
      method: "GET",
      path,
      resource_type: "class",
      resource_id: Number.isInteger(id) ? String(id) : null,
      status: "failed",
      error_message: "生成邀请海报失败",
      ip,
      user_agent,
      metadata: null,
    });
    return NextResponse.json({ error: "生成邀请海报失败" }, { status: 500 });
  }
}
