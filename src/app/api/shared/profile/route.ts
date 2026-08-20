import { NextRequest, NextResponse } from "next/server";
import { getActiveTags, getClasses, getStudentByCode, getTags, getUserById, upsertSubmission } from "@/lib/db";
import { tagNamesToIds, tagIdsToNames } from "@/lib/tag-utils";
import { verifyToken } from "@/lib/token";

/** 会话查询：登录学生获取本人档案（含班级名与标签名） */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const result = await verifyToken(token);
    if (!result.valid) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }
    if (result.role !== "student" || result.uid == null) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const user = await getUserById(result.uid);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const classes = await getClasses();
    const className =
      user.class_id != null
        ? classes.find((c) => c.id === user.class_id)?.name ?? "未分班"
        : "未分班";

    let tagNames: string[] = [];
    if (user.tags) {
      try {
        const ids = JSON.parse(user.tags) as number[];
        const allTags = await getTags();
        tagNames = tagIdsToNames(ids, allTags);
      } catch (err) {
        console.error("Profile GET tags parse error:", err);
      }
    }

    return NextResponse.json({
      name: user.name,
      user_code: user.user_code,
      class_name: className,
      tags: tagNames,
      avatar_url: user.avatar_url || "",
      evaluation_url: user.evaluation_url || "",
      submitted_at: user.submitted_at,
    });
  } catch (err) {
    console.error("Profile GET error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { studentId } = body;
    const { tags, avatarUrl, evaluationUrl } = body;

    // 登录态扩展：学生会话未传 studentId 时默认本人编号；快速提交模式不受影响
    if (!studentId) {
      const token = request.cookies.get("auth_token")?.value;
      if (token) {
        const result = await verifyToken(token);
        if (result.valid && result.role === "student" && result.uid != null) {
          const user = await getUserById(result.uid);
          if (user) studentId = user.user_code;
        }
      }
    }

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
