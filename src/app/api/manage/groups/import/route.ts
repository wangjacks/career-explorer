import { NextRequest, NextResponse } from "next/server";
import { replaceClassGrouping } from "@/lib/db";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { getSession, canModifyClass } from "../../classes/helpers";
import {
  MAX_GROUP_NO,
  actorOf,
  buildGroupingView,
  classExists,
  groupFailureWriter,
  parseJsonBody,
  rosterOf,
} from "../helpers";
import { getStudents } from "@/lib/db";

const AUDIT = {
  action: "group:import",
  method: "POST",
  path: "/api/manage/groups/import",
  resource_type: "group",
} as const;

interface ImportRow {
  groupNo: number | null;
  userCode: string;
}

/**
 * 解析导入行：只接受 `GET /api/manage/groups/export` 的三列格式（组号 / 学号 / 姓名）。
 * 姓名不参与判定（学号才是唯一标识，名单里的姓名才是权威值），空组号 = 该生不进组。
 */
function parseRows(input: unknown): { rows: ImportRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: ImportRow[] = [];
  if (!Array.isArray(input)) {
    errors.push("文件没有数据行");
    return { rows, errors };
  }
  if (input.length === 0) {
    // 空表要单独说：否则下面会报「缺少本班 6 人」，把「文件是空的」说成「你漏了人」
    errors.push("文件没有数据行");
    return { rows, errors };
  }
  input.forEach((raw, i) => {
    const line = `第 ${i + 1} 行`;
    if (typeof raw !== "object" || raw === null) {
      errors.push(`${line}：不是数据行`);
      return;
    }
    const item = raw as Record<string, unknown>;
    const userCode = String(item.userCode ?? "").trim();
    if (!/^\d{12}$/.test(userCode)) {
      errors.push(`${line}：学号「${userCode || "（空）"}」不是 12 位数字`);
      return;
    }
    const cell = item.groupNo;
    if (cell === null || cell === undefined || String(cell).trim() === "") {
      rows.push({ groupNo: null, userCode });
      return;
    }
    const groupNo = Number(String(cell).trim());
    if (!Number.isInteger(groupNo) || groupNo <= 0 || groupNo > MAX_GROUP_NO) {
      errors.push(`${line}：组号「${String(cell)}」必须是 1 到 ${MAX_GROUP_NO} 的整数`);
      return;
    }
    rows.push({ groupNo, userCode });
  });
  return { rows, errors };
}

/**
 * POST：**全量覆盖**某班的当前分组（不写历史批次）。
 * 严格校验：文件里的学号集合必须与班级名单完全一致——全量覆盖下缺人 = 学生静默消失，
 * 因此任何缺人 / 多人 / 未知学号 / 重复学号都整份拒绝并列出差异，绝不部分生效。
 */
export async function POST(request: NextRequest) {
  const fail = groupFailureWriter(request, AUDIT);
  let session: Awaited<ReturnType<typeof getSession>> = null;
  try {
    session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await parseJsonBody<{ classId?: unknown; rows?: unknown }>(request);
    if (!body) {
      fail(session, "请求体不是合法 JSON");
      return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
    }
    const classId = Number(body.classId);
    if (!Number.isInteger(classId) || classId <= 0) {
      fail(session, "缺少或无效的 classId", { classId: body.classId });
      return NextResponse.json({ error: "缺少或无效的 classId" }, { status: 400 });
    }
    if (!(await canModifyClass(session, classId))) {
      fail(session, "无权调整该班级分组", { classId });
      return NextResponse.json({ error: "无权调整该班级分组" }, { status: 403 });
    }
    if (!(await classExists(classId))) {
      fail(session, "班级不存在", { classId });
      return NextResponse.json({ error: "班级不存在" }, { status: 404 });
    }

    const { rows, errors } = parseRows(body.rows);
    if (errors.length > 0) {
      fail(session, `导入校验失败 ${errors.length} 项`, { classId, errors: errors.slice(0, 20) });
      return NextResponse.json({ error: "导入校验失败", errors: errors.slice(0, 20) }, { status: 400 });
    }

    const roster = rosterOf(await getStudents(), classId);
    const byCode = new Map(roster.map((s) => [s.user_code, s]));
    const seen = new Set<string>();
    const duplicates: string[] = [];
    const unknown: string[] = [];
    for (const r of rows) {
      if (seen.has(r.userCode)) duplicates.push(r.userCode);
      else seen.add(r.userCode);
      if (!byCode.has(r.userCode)) unknown.push(r.userCode);
    }
    const missing = roster.filter((s) => !seen.has(s.user_code)).map((s) => s.user_code);

    const diffs: string[] = [];
    if (duplicates.length > 0) diffs.push(`学号重复 ${duplicates.length} 处（${duplicates.slice(0, 3).join("、")}）`);
    if (unknown.length > 0) diffs.push(`本班没有这些学号 ${unknown.length} 个（${unknown.slice(0, 3).join("、")}）`);
    if (missing.length > 0) diffs.push(`文件缺少本班学生 ${missing.length} 人（${missing.slice(0, 3).join("、")}）`);
    if (diffs.length > 0) {
      fail(session, `名单不一致：${diffs.join("；")}`, {
        classId,
        duplicateCount: duplicates.length,
        unknownCount: unknown.length,
        missingCount: missing.length,
      });
      return NextResponse.json({ error: "文件与本班名单不一致", errors: diffs }, { status: 400 });
    }

    // 按学号回查 id：文件里的姓名只是给人看的，落库一律用名单里的姓名与 id
    const byGroup = new Map<number, number[]>();
    for (const r of rows) {
      if (r.groupNo === null) continue;
      const list = byGroup.get(r.groupNo) ?? [];
      list.push(byCode.get(r.userCode)!.id);
      byGroup.set(r.groupNo, list);
    }
    const groups = [...byGroup.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([groupNo, userIds]) => ({ group_no: groupNo, user_ids: userIds }));

    await replaceClassGrouping(classId, groups);

    void recordAudit({
      ...actorOf(session),
      ...AUDIT,
      resource_id: String(classId),
      status: "success",
      error_message: null,
      ...getRequestContext(request),
      metadata: {
        classId,
        groupCount: groups.length,
        studentCount: rows.length,
        groupedCount: groups.reduce((sum, g) => sum + g.user_ids.length, 0),
        ungroupedCount: rows.length - groups.reduce((sum, g) => sum + g.user_ids.length, 0),
      },
    });

    return NextResponse.json({ ok: true, view: await buildGroupingView(classId) });
  } catch (err) {
    console.error("Group import error:", err);
    fail(session, err instanceof Error ? err.message : "导入分组失败");
    return NextResponse.json({ error: "导入分组失败" }, { status: 500 });
  }
}
