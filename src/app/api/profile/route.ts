import { NextRequest, NextResponse } from "next/server";
import { insertProfile } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { studentId, tags, avatarUrl, evaluationUrl } = body;

    if (!studentId || !/^\d{12}$/.test(studentId)) {
      return NextResponse.json({ error: "学号必须为12位数字" }, { status: 400 });
    }

    if (!Array.isArray(tags) || tags.length === 0) {
      return NextResponse.json({ error: "标签不能为空" }, { status: 400 });
    }

    await insertProfile(studentId, tags, avatarUrl || "", evaluationUrl || "");
    return NextResponse.json({ message: "保存成功" });
  } catch {
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
