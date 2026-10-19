import { NextRequest, NextResponse } from "next/server";
import {
  getSubmittedProfiles,
  clearSubmissions,
  getAssessmentByCode,
  getCurrentAssessmentResultsByUserCodes,
} from "@/lib/db";
import { RIASEC_CODE } from "@/lib/assessment-data";
import { parseScores } from "@/lib/assessment-flow";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "20", 10);

    const { rows, total } = await getSubmittedProfiles(page, pageSize);

    // #234：给本页每行补「兴趣测评」字段（列表列 + 详情弹窗条形）。
    // 只认 status=completed 且 is_current=1 的结果——草稿与历史版本都不算「测过」；
    // 未测行统一给 none / null，前端据此渲染灰胶囊而不是否定式样式。
    // 按当页学号一次批查（与 #233 导出共用同一个数据层方法），不做全校扫表。
    const studentCodes = rows.map((r) => r.user_code);
    const assessment = await getAssessmentByCode(RIASEC_CODE);
    const results =
      assessment && studentCodes.length > 0
        ? await getCurrentAssessmentResultsByUserCodes(assessment.id, studentCodes)
        : [];
    const resultByCode = new Map(results.map((r) => [r.user_code, r]));

    return NextResponse.json({
      data: rows.map((r) => {
        // #94：标签文本直存，原样返回（容忍旧格式）
        let tags: string[] = [];
        try {
          const parsed = r.tags ? JSON.parse(r.tags) : [];
          tags = Array.isArray(parsed) ? parsed.map((t) => String(t)) : [];
        } catch {}
        const result = resultByCode.get(r.user_code);
        return {
          // #95：补充数字 userId，供版本历史等关联查询使用
          userId: r.id,
          studentId: r.user_code,
          studentName: r.name,
          tags,
          avatarUrl: r.avatar_url,
          evaluationUrl: r.evaluation_url,
          storageId: r.storage_id,
          createdAt: r.submitted_at,
          // #234：已测给三字码 + 完成时间 + 六型快照；未测统一为 none / null
          assessmentCode: result?.type_code ?? null,
          assessmentStatus: result ? "completed" : "none",
          assessmentAt: result?.completed_at ?? null,
          // 只下发条形需要的「维度 + 标准分」，不把 raw / band / 作答计数带到教师端
          assessmentScores: result
            ? parseScores(result.scores_json).map(({ key, standard }) => ({ key, standard }))
            : null,
        };
      }),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    console.error("Profiles GET error:", err);
    return NextResponse.json({ error: "获取档案列表失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "请选择要删除的记录" }, { status: 400 });
    }
    const deleted = await clearSubmissions(ids);
    return NextResponse.json({ deleted, message: `已删除 ${deleted} 条记录` });
  } catch (err) {
    console.error("Profiles DELETE error:", err);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
