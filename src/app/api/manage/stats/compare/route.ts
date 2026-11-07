import { withDemoScope } from "@/lib/demo-scope";
import { NextResponse } from "next/server";
import { getCompareByClass } from "@/lib/db";

async function GET_impl() {
  try {
    const data = await getCompareByClass();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Stats compare GET error:", err);
    return NextResponse.json({ error: "获取对比数据失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
