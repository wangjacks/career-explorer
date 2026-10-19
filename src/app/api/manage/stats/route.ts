import { withDemoScope } from "@/lib/demo-scope";
import { NextResponse } from "next/server";
import { getStats } from "@/lib/db";

async function GET_impl() {
  try {
    const stats = await getStats();
    return NextResponse.json(stats);
  } catch (err) {
    console.error("Stats GET error:", err);
    return NextResponse.json({ error: "获取统计失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
