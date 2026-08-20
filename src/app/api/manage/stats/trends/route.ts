import { NextRequest, NextResponse } from "next/server";
import { getTrends } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const days = Number(request.nextUrl.searchParams.get("days") || "30");
    const trends = await getTrends(days);
    return NextResponse.json(trends);
  } catch (err) {
    console.error("Stats trends GET error:", err);
    return NextResponse.json({ error: "获取趋势数据失败" }, { status: 500 });
  }
}
