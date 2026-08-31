import { NextRequest, NextResponse } from "next/server";
import { getClasses } from "@/lib/db";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";
import { generateInvitePoster } from "@/lib/invite-poster";
import { canModifyClass, getSession } from "../../helpers";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 班级邀请海报（Issue #102）。
 * GET 返回 PNG：默认 inline 预览；`?download=1` 触发附件下载。
 * 权限与重置邀请码一致：admin 全权，teacher 仅限自己创建的班级。
 * 二维码指向 `/activate?invite=CODE`，激活安全仍由服务端三要素核验兜底。
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

    // 二维码需要可被学生手机访问的绝对链接：优先显式配置的公网地址，
    // 未配置时回退到教师当前请求的 origin（局域网/内网场景也可用）。
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || new URL(request.url).origin;
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
