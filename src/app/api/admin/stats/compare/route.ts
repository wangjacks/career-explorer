import { NextRequest, NextResponse } from "next/server";
import { getCompareBy } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const by = request.nextUrl.searchParams.get("by") === "segment" ? "segment" : "class";
    const data = await getCompareBy(by);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Stats compare GET error:", err);
    return NextResponse.json({ error: "获取对比数据失败" }, { status: 500 });
  }
}
