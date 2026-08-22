import { NextRequest, NextResponse } from "next/server";
import { getMaxCustomTags, setProfileConfig } from "@/lib/db";

/** 档案功能设置（#94）：管理/教师面板读写；表单端读取上限走开放端点 /api/tags */

export async function GET() {
  try {
    const maxCustomTags = await getMaxCustomTags();
    return NextResponse.json({ maxCustomTags });
  } catch (err) {
    console.error("Profile config GET error:", err);
    return NextResponse.json({ error: "获取配置失败" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const value = Number(body.maxCustomTags);
    if (!Number.isInteger(value) || value < 1 || value > 20) {
      return NextResponse.json({ error: "自定义标签上限须为 1-20 的整数" }, { status: 400 });
    }
    await setProfileConfig("max_custom_tags", String(value));
    return NextResponse.json({ ok: true, maxCustomTags: value });
  } catch (err) {
    console.error("Profile config PUT error:", err);
    return NextResponse.json({ error: "保存配置失败" }, { status: 500 });
  }
}
