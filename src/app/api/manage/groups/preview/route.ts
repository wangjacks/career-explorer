import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../classes/helpers";
import {
  buildGroupingPreview,
  classExists,
  parseJsonBody,
  parseStrategy,
  parseVariant,
  parseWeights,
  rosterOf,
} from "../helpers";
import { getStudents } from "@/lib/db";


/**
 * POST：生成分组**预览**（#345）——只算不写库。
 *
 * 读权限与现有 GET 一致（教师可预览全校班级、管理员全部）：预览不改任何数据。
 * 预览里的换人 / 设组长都只发生在客户端内存，应用时才提交给 `POST /api/manage/groups` 并再校验一次。
 */
async function POST_impl(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await parseJsonBody<{
      classId?: unknown;
      strategy?: unknown;
      weights?: unknown;
      variant?: unknown;
    }>(request);
    if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

    const classId = Number(body.classId);
    if (!Number.isInteger(classId) || classId <= 0) {
      return NextResponse.json({ error: "缺少或无效的 classId" }, { status: 400 });
    }
    if (!(await classExists(classId))) {
      return NextResponse.json({ error: "班级不存在" }, { status: 404 });
    }
    const strategy = parseStrategy(body.strategy);
    if (!strategy) return NextResponse.json({ error: "未知的分组策略" }, { status: 400 });
    const weights = parseWeights(body.weights);
    if (!weights) return NextResponse.json({ error: "权重必须是 0–1 的数字" }, { status: 400 });
    const variant = parseVariant(body.variant);
    if (variant === null) {
      return NextResponse.json({ error: "variant 必须是非负整数" }, { status: 400 });
    }

    const roster = rosterOf(await getStudents(), classId);
    if (roster.length === 0) {
      return NextResponse.json({ error: "该班没有学生，无法分组" }, { status: 400 });
    }

    const preview = await buildGroupingPreview(classId, { strategy, weights, variant });
    return NextResponse.json({ ok: true, preview });
  } catch (err) {
    console.error("Groups preview POST error:", err);
    return NextResponse.json({ error: "生成预览失败" }, { status: 500 });
  }
}

export const POST = withDemoScope(POST_impl);
