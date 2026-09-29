import { NextRequest, NextResponse } from "next/server";
import { getTrendsByClass } from "@/lib/db";
import { normalizeTrendDays } from "@/lib/stats-utils";

export async function GET(request: NextRequest) {
  try {
    // 缺参走 DEFAULT_TREND_DAYS（默认值只在 stats-utils 里定义一处）
    const days = normalizeTrendDays(request.nextUrl.searchParams.get("days"));
    const series = await getTrendsByClass(days);
    return NextResponse.json(series);
  } catch (err) {
    console.error("Stats class-trends GET error:", err);
    return NextResponse.json({ error: "获取分班趋势数据失败" }, { status: 500 });
  }
}
