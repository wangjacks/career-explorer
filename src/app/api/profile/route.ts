import { NextRequest, NextResponse } from "next/server";
import { getActiveTags, getStudentByCode, upsertSubmission } from "@/lib/db";
import { tagNamesToIds } from "@/lib/tag-utils";

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

    const student = await getStudentByCode(studentId);
    if (!student) {
      return NextResponse.json({ error: "学号不存在" }, { status: 404 });
    }

    const allTags = await getActiveTags();
    const tagIds = tagNamesToIds(tags as string[], allTags);
    if (tagIds.length === 0) {
      return NextResponse.json({ error: "没有有效的标签" }, { status: 400 });
    }

    await upsertSubmission(studentId, JSON.stringify(tagIds), avatarUrl || "", evaluationUrl || "");
    return NextResponse.json({ message: "保存成功" });
  } catch (err) {
    console.error("Profile POST error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
