import { NextResponse } from "next/server";
import { getCompareByClass } from "@/lib/db";

export async function GET() {
  try {
    const data = await getCompareByClass();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Stats compare GET error:", err);
    return NextResponse.json({ error: "获取对比数据失败" }, { status: 500 });
  }
}
