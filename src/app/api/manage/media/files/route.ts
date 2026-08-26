import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { scanMedia, type MediaFileItem } from "@/lib/media-scan";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

/** 筛选参数解析（全部可选，默认全量） */
function parseFilters(sp: URLSearchParams) {
  const type = sp.get("type") ?? "all";
  const status = sp.get("status") ?? "all";
  const student = (sp.get("student") ?? "").trim().toLowerCase();
  const keyword = (sp.get("keyword") ?? "").trim().toLowerCase();
  return {
    type: ["all", "avatar", "evaluation", "thumbnail", "other"].includes(type) ? type : "all",
    status: ["all", "referenced", "orphan"].includes(status) ? status : "all",
    student,
    keyword,
  };
}

/**
 * 媒体资源全量列表（#117）：全部存储文件（含被引用），支持类型/引用状态/学生/文件名筛选与分页。仅 admin。
 * 排序：最近修改降序；引用状态与关联学生在扫描时计算（服务端为准）。
 * 学生搜索与文件名搜索相互独立：孤儿文件无关联学生，可用文件名搜索定位。
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const result = await verifyToken(token);
    if (!result.valid || result.uid == null) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (result.role !== "admin") {
      const { ip, user_agent } = getRequestContext(request);
      const actor = await getAuditActor(request);
      void recordAudit({
        ...actor, action: "media:query", method: "GET", path: request.nextUrl.pathname,
        resource_type: "media", resource_id: null,
        status: "failed", error_message: "越权访问", ip, user_agent, metadata: null,
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const page = Number(request.nextUrl.searchParams.get("page") ?? 1);
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return NextResponse.json({ error: "分页参数无效" }, { status: 400 });
    }
    const { type, status, student, keyword } = parseFilters(request.nextUrl.searchParams);

    const { files } = await scanMedia();
    const filtered: MediaFileItem[] = files.filter((f) => {
      if (type !== "all" && f.type !== type) return false;
      if (status === "referenced" && !f.referenced) return false;
      if (status === "orphan" && f.referenced) return false;
      // 学生搜索：匹配关联学生（孤儿文件无关联学生，不会命中）
      if (student && !(f.userCode ?? "").toLowerCase().includes(student) && !(f.userName ?? "").toLowerCase().includes(student)) {
        return false;
      }
      // 文件名搜索：独立维度（孤儿文件可用此定位）
      if (keyword && !f.key.toLowerCase().includes(keyword)) return false;
      return true;
    });

    const start = (page - 1) * pageSize;
    return NextResponse.json({
      ok: true,
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
      filters: { type, status, student: student || null, keyword: keyword || null },
    });
  } catch (err) {
    console.error("Media files error:", err);
    // 服务器异常留痕（CR P2-1）：扫描/存储故障 500 记 failed
    const { ip, user_agent } = getRequestContext(request);
    const actor = await getAuditActor(request);
    void recordAudit({
      ...actor, action: "media:query", method: "GET", path: request.nextUrl.pathname,
      resource_type: "media", resource_id: null,
      status: "failed", error_message: err instanceof Error ? err.message : "服务器错误", ip, user_agent, metadata: null,
    });
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
