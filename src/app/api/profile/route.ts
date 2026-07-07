import { NextRequest, NextResponse } from "next/server";
import { insertProfile } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tags, avatarUrl } = body;

    if (!Array.isArray(tags) || tags.length === 0) {
      return NextResponse.json({ error: "标签不能为空" }, { status: 400 });
    }

    const id = insertProfile(tags, avatarUrl || "");
    return NextResponse.json({ id, message: "保存成功" });
  } catch {
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
