import { NextResponse } from "next/server";
import { resetTagsToDefaults } from "@/lib/db";

/** 恢复默认预设（#94 补充）：清空全部标签后重插默认预设（需前端二次确认） */
export async function POST() {
  try {
    await resetTagsToDefaults();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Tags restore POST error:", err);
    return NextResponse.json({ error: "恢复默认失败" }, { status: 500 });
  }
}
