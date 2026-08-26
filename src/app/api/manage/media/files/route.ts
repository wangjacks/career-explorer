import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { scanMedia, type MediaFileItem } from "@/lib/media-scan";

/** 筛选参数解析（全部可选，默认全量） */
function parseFilters(sp: URLSearchParams) {
  const type = sp.get("type") ?? "all";
  const status = sp.get("status") ?? "all";
  const student = (sp.get("student") ?? "").trim().toLowerCase();
  return {
    type: ["all", "avatar", "evaluation", "thumbnail", "other"].includes(type) ? type : "all",
    status: ["all", "referenced", "orphan"].includes(status) ? status : "all",
    student,
  };
}

/**
 * 媒体资源全量列表（#117）：全部存储文件（含被引用），支持类型/引用状态/学生筛选与分页。仅 admin。
 * 排序：最近修改降序；引用状态与关联学生在扫描时计算（服务端为准）。
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
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const page = Number(request.nextUrl.searchParams.get("page") ?? 1);
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return NextResponse.json({ error: "分页参数无效" }, { status: 400 });
    }
    const { type, status, student } = parseFilters(request.nextUrl.searchParams);

    const { files } = await scanMedia();
    const filtered: MediaFileItem[] = files.filter((f) => {
      if (type !== "all" && f.type !== type) return false;
      if (status === "referenced" && !f.referenced) return false;
      if (status === "orphan" && f.referenced) return false;
      if (student && !(f.userCode ?? "").toLowerCase().includes(student) && !(f.userName ?? "").toLowerCase().includes(student)) {
        return false;
      }
      return true;
    });

    const start = (page - 1) * pageSize;
    return NextResponse.json({
      ok: true,
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
      filters: { type, status, student: student || null },
    });
  } catch (err) {
    console.error("Media files error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
