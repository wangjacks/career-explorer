import { NextRequest, NextResponse } from "next/server";
import { getAllSubmitted, getStorageBackend, getTeacherClassPairs } from "@/lib/db";
import { verifyToken } from "@/lib/token";
import { createStorage } from "@/lib/storage";

/**
 * 文件访问地址签发（#111，私有读写模式）：
 * - 请求参数 `url` 为 DB 中存储的文件引用（本地代理路径或对象 key）
 * - 权限校验（防越权）：定位文件归属学生 → 学生仅限本人、教师仅限管辖班级、管理员全量，否则 403
 * - 本地后端：原样回显代理路径（行为与现版本一致）
 * - 云后端：以文件归属记录的 `storage_id` 为准（忽略参数伪造）签发 30 分钟签名 URL
 *
 * 放在 /api/shared 下而非 /api/manage：学生端展示本人图片也需要调用；
 * proxy matcher 不覆盖 /api/shared/*，由本路由自行验签（与 /api/shared/profile 同模式）。
 * 签发为高频读操作，不记审计（避免淹没审计日志）。
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    const result = token ? await verifyToken(token) : { valid: false };
    if (!result.valid || !result.role || result.uid == null) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = request.nextUrl.searchParams.get("url") ?? "";
    if (!url || url.length > 600) {
      return NextResponse.json({ error: "缺少文件引用" }, { status: 400 });
    }

    // 定位文件归属：引用与库中存储值精确匹配（含查询参数原样比对）
    const owner = (await getAllSubmitted()).find(
      (u) => u.avatar_url === url || u.evaluation_url === url
    );
    if (!owner) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    // 权限校验：学生仅限本人；教师仅限管辖班级；管理员全量
    if (result.role === "student") {
      if (owner.id !== result.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (result.role === "teacher") {
      const pairs = await getTeacherClassPairs();
      const allowedClassIds = new Set(
        pairs.filter((p) => p.teacher_id === result.uid).map((p) => p.class_id)
      );
      if (owner.class_id == null || !allowedClassIds.has(owner.class_id)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (result.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 本地后端：直接回显代理路径；云后端：以归属记录的后端为准签发签名 URL（参数不可伪造后端归属）
    const backend = await getStorageBackend(owner.storage_id);
    if (!backend) {
      return NextResponse.json({ error: "存储后端不存在" }, { status: 500 });
    }
    if (backend.type === "local") {
      return NextResponse.json({ url });
    }

    const storage = createStorage(backend);
    const key = url.split("?")[0];
    const signedUrl = await storage.getSignedUrl(key);
    return NextResponse.json({ url: signedUrl });
  } catch (err) {
    console.error("Storage sign error:", err);
    const message = err instanceof Error ? err.message : "签发失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
