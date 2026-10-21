import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import {
  getSubmittedProfiles,
  clearSubmissions,
  getAssessmentByCode,
  getCurrentAssessmentResultsByUserCodes,
  type AssessmentResultSummary,
} from "@/lib/db";
import { RIASEC_CODE } from "@/lib/assessment-data";
import { parseScores } from "@/lib/assessment-flow";
import { assessmentLeadOf } from "@/lib/profile-assessment";
import { parseProfilesQuery } from "@/lib/profile-query";

async function GET_impl(request: NextRequest) {
  try {
    // #295：筛选 / 排序 / 分页全部由服务端完成（此前在浏览器里只过滤当页 20 行，跨页学生筛不到）。
    // 参数口径与校验统一在 profile-query.ts，非法参数显式 400，避免静默忽略筛选条件。
    const parsed = parseProfilesQuery(request.nextUrl.searchParams);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { page, pageSize, filters } = parsed.value;

    const { rows, total } = await getSubmittedProfiles(page, pageSize, filters);

    // #234：给本页每行补「兴趣测评」字段（列表列 + 详情弹窗条形）。
    // 只认 status=completed 且 is_current=1 的结果——草稿与历史版本都不算「测过」；
    // 未测行统一给 none / null，前端据此渲染灰胶囊而不是否定式样式。
    // 按当页学号一次批查（与 #233 导出共用同一个数据层方法），不做全校扫表。
    // 量表缺失 / 测评数据层故障只降级为「全部未测」：列表本身是主功能，不能因此整体 500。
    const resultByCode = new Map<string, AssessmentResultSummary>();
    if (rows.length > 0) {
      try {
        const assessment = await getAssessmentByCode(RIASEC_CODE);
        if (assessment) {
          const results = await getCurrentAssessmentResultsByUserCodes(
            assessment.id,
            rows.map((r) => r.user_code)
          );
          for (const result of results) resultByCode.set(result.user_code, result);
        }
      } catch (err) {
        console.error("Profiles assessment lookup degraded:", err);
      }
    }

    return NextResponse.json({
      data: rows.map((r) => {
        // #94：标签文本直存，原样返回（容忍旧格式）
        let tags: string[] = [];
        try {
          const parsed = r.tags ? JSON.parse(r.tags) : [];
          tags = Array.isArray(parsed) ? parsed.map((t) => String(t)) : [];
        } catch {}
        const result = resultByCode.get(r.user_code);
        // 状态与徽章同源：三字码合法才算「已测」，避免接口说 completed、界面显示未测
        const assessed = assessmentLeadOf(result?.type_code) !== null;
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
          assessmentCode: assessed ? result!.type_code : null,
          assessmentStatus: assessed ? "completed" : "none",
          assessmentAt: assessed ? (result!.completed_at ?? null) : null,
          // 只下发条形需要的「维度 + 标准分」，不把 raw / band / 作答计数带到教师端
          assessmentScores: assessed
            ? parseScores(result!.scores_json).map(({ key, standard }) => ({ key, standard }))
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

async function DELETE_impl(request: NextRequest) {
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

export const GET = withDemoScope(GET_impl);
export const DELETE = withDemoScope(DELETE_impl);
