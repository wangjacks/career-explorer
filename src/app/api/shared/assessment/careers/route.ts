import { NextRequest, NextResponse } from "next/server";
import {
  getAssessmentByCode,
  getCurrentAssessmentResult,
  getOnetOccupations,
} from "@/lib/db";
import { verifyToken } from "@/lib/token";
import { RIASEC_CODE } from "@/lib/assessment-data";
import {
  DEFAULT_TOP_N,
  MAX_TOP_N,
  RIASEC_KEYS,
  emptyRiasecVector,
  hollandWeights,
  normalizeHollandCode,
  profileFromDimensionScores,
  rankCareers,
  type RiasecVector,
} from "@/lib/assessment-match";
import { onetDatasetInfo, ONET_ATTRIBUTION, toCareerCandidates } from "@/lib/onet";

/**
 * GET：当前学生最新霍兰德结果 → Top-N 推荐职业（#226，供 C1 推荐职业区块调用）。
 *
 * 权限：`/api/shared/*` 不在 proxy 里，本路由自鉴权——只认 cookie 里的会话 uid，**不接受别人
 * 的 user_id**（显式传别人 uid 直接 403，便于越权行为被测试与日志看见）。只有学生有这个页面，
 * 教师/管理员调用一律 403。
 *
 * 画像来源（可能随时间演化，函数保证确定性）：
 * 1. 结果快照的六维标准分（`scores_json` 的 `standard`，0–100）——信息最全；
 * 2. 只有三字码时按 3/2/1 权重构造方向向量——老数据 / 只有类型码的退路。
 *
 * 推荐本身是纯函数（`rankCareers`）：匹配不落库、不缓存，职业库变更后结果自然跟着变。
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const session = await verifyToken(token);
    if (!session.valid || session.uid == null) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }
    if (session.role !== "student") {
      return NextResponse.json({ error: "仅学生可查看本人测评推荐" }, { status: 403 });
    }

    // 越权防护：接口只认会话本人，显式传别人的 user_id 一律拒绝（不静默忽略）
    const requestedUserId = request.nextUrl.searchParams.get("user_id");
    if (requestedUserId !== null && requestedUserId !== String(session.uid)) {
      return NextResponse.json({ error: "无权查看他人的测评推荐" }, { status: 403 });
    }

    const limitParam = request.nextUrl.searchParams.get("limit");
    let limit = DEFAULT_TOP_N;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TOP_N) {
        return NextResponse.json(
          { error: `limit 必须是 1–${MAX_TOP_N} 的整数` },
          { status: 400 }
        );
      }
      limit = parsed;
    }

    const assessment = await getAssessmentByCode(RIASEC_CODE);
    if (!assessment) {
      return NextResponse.json({ error: "测评量表未配置" }, { status: 404 });
    }

    const result = await getCurrentAssessmentResult(session.uid, assessment.id);
    if (!result) {
      return NextResponse.json({ error: "还没有完成霍兰德测评" }, { status: 404 });
    }

    // 画像：优先六维标准分，其次三字码权重；两者都没有就无法推荐（脏数据要显式报错，不硬凑）
    let profile: RiasecVector | null = null;
    if (result.scores_json) {
      try {
        profile = profileFromDimensionScores(
          JSON.parse(result.scores_json) as { key: string; standard: number }[]
        );
      } catch (err) {
        console.error("Assessment careers: 解析得分快照失败", err);
      }
    }
    const profileSource = profile ? "scores" : "typeCode";
    if (!profile) profile = hollandWeights(result.type_code);
    if (!profile) {
      return NextResponse.json({ error: "测评结果缺少可用于匹配的分数" }, { status: 409 });
    }

    const rows = await getOnetOccupations();
    if (rows.length === 0) {
      return NextResponse.json({ error: "职业库为空，请先导入 O*NET 数据" }, { status: 503 });
    }

    const candidates = toCareerCandidates(rows);

    const careers = rankCareers(profile, candidates, { topN: limit });
    const dataset = onetDatasetInfo();

    // 回给前端的六维画像统一成 0–100（学生视角，与计分引擎口径一致）；只有三字码时按权重放大到 0–100
    const profileOut = emptyRiasecVector();
    for (const key of RIASEC_KEYS) {
      profileOut[key] =
        profileSource === "scores" ? Math.round(profile[key] * 10) / 10 : Math.round((profile[key] / 3) * 1000) / 10;
    }

    return NextResponse.json({
      assessment: {
        code: assessment.code,
        name: assessment.name,
        scaleVersion: assessment.scale_version,
        typeCode: normalizeHollandCode(result.type_code),
        completedAt: result.completed_at,
      },
      /** `scores` = 六维标准分画像；`typeCode` = 只有三字码时的权重退路 */
      profileSource,
      profile: profileOut,
      careers,
      dataset: {
        version: dataset.version,
        title: dataset.title,
        occupationCount: dataset.occupationCount,
        translatedCount: dataset.translatedCount,
      },
      attribution: ONET_ATTRIBUTION,
    });
  } catch (err) {
    console.error("Assessment careers GET error:", err);
    return NextResponse.json({ error: "获取职业推荐失败" }, { status: 500 });
  }
}
