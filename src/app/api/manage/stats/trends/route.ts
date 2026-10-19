import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getTrends } from "@/lib/db";
import { normalizeTrendDays } from "@/lib/stats-utils";

async function GET_impl(request: NextRequest) {
  try {
    // 缺参走 DEFAULT_TREND_DAYS（默认值只在 stats-utils 里定义一处）
    const days = normalizeTrendDays(request.nextUrl.searchParams.get("days"));
    const trends = await getTrends(days);
    return NextResponse.json(trends);
  } catch (err) {
    console.error("Stats trends GET error:", err);
    return NextResponse.json({ error: "获取趋势数据失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
