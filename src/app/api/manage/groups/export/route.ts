import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getClassGroupMembers, getClassGroups, getClasses, getStudents } from "@/lib/db";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { getSession } from "../../classes/helpers";
import { actorOf, rosterOf } from "../helpers";

const AUDIT = {
  action: "group:export",
  method: "GET",
  path: "/api/manage/groups/export",
  resource_type: "group",
} as const;

/**
 * GET：导出某班的**当前**分组（组号 / 学号 / 姓名）。
 * 表内不放标题行、班级信息进文件名，保证「导出 → 编辑 → 导入」是干净的 round-trip；
 * 未分组的班级导出空白模板（全班学生 + 空组号列），教师可直接在表里填组号再导入。
 */
export async function GET(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const fail = (session: Awaited<ReturnType<typeof getSession>>, error: string, metadata?: unknown) => {
    void recordAudit({
      ...actorOf(session),
      ...AUDIT,
      resource_id: null,
      status: "failed",
      error_message: error,
      ip,
      user_agent,
      metadata,
    });
  };
  let session: Awaited<ReturnType<typeof getSession>> = null;
  try {
    session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const classId = Number(request.nextUrl.searchParams.get("classId"));
    if (!Number.isInteger(classId) || classId <= 0) {
      fail(session, "缺少或无效的 classId", { classId: request.nextUrl.searchParams.get("classId") });
      return NextResponse.json({ error: "缺少或无效的 classId" }, { status: 400 });
    }

    // 导出是读操作：与「读不限班级」一致，不按归属裁剪（教师可导全校名单）
    const klass = (await getClasses()).find((c) => c.id === classId);
    if (!klass) {
      fail(session, "班级不存在", { classId });
      return NextResponse.json({ error: "班级不存在" }, { status: 404 });
    }

    const [students, groups, links] = await Promise.all([
      getStudents(),
      getClassGroups(classId),
      getClassGroupMembers(classId),
    ]);
    const groupNoById = new Map(groups.map((g) => [g.id, g.group_no]));
    const groupNoByUser = new Map<number, number>();
    for (const link of links) {
      const no = groupNoById.get(link.group_id);
      if (no !== undefined) groupNoByUser.set(link.user_id, no);
    }

    // 已进组的按组号 + 学号排前面，未进组的按学号排在后面（空白模板里也一样可读）。
    // 只按学号排会让组号在表里来回跳——教师拿到文件看到的是乱序名单，不是分组表。
    const roster = rosterOf(students, classId);
    const byGroupThenCode = (a: { groupNo: number | null; userCode: string }, b: { groupNo: number | null; userCode: string }) => {
      const an = a.groupNo ?? Number.MAX_SAFE_INTEGER;
      const bn = b.groupNo ?? Number.MAX_SAFE_INTEGER;
      if (an !== bn) return an - bn;
      return a.userCode < b.userCode ? -1 : a.userCode > b.userCode ? 1 : 0;
    };
    const rows = roster
      .map((s) => ({ groupNo: groupNoByUser.get(s.id) ?? null, userCode: s.user_code, name: s.name }))
      .sort(byGroupThenCode);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("分组");
    sheet.columns = [
      { header: "组号", key: "groupNo", width: 8 },
      { header: "学号", key: "userCode", width: 18 },
      { header: "姓名", key: "name", width: 14 },
    ];
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    for (const row of rows) {
      // 未进组写空串而不是 null：null 读回来是空单元格，ExcelJS 会给不同解析分支，空白模板要稳定可读
      const added = sheet.addRow({ ...row, groupNo: row.groupNo ?? "" });
      // 学号必须是文本单元格：12 位数字进 Excel 会被当数值、丢前导零并转成科学计数
      added.getCell("userCode").numFmt = "@";
    }

    const buffer = Buffer.from(new Uint8Array(await workbook.xlsx.writeBuffer()));
    void recordAudit({
      ...actorOf(session),
      ...AUDIT,
      resource_id: String(classId),
      status: "success",
      error_message: null,
      ip,
      user_agent,
      metadata: {
        classId,
        studentCount: rows.length,
        groupedCount: rows.filter((r) => r.groupNo !== null).length,
        groupCount: groups.length,
      },
    });

    // 日期走 Asia/Shanghai（与库内时间戳同口径）：toISOString 是 UTC，晚上导出会写成前一天
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
    const name = `分组_${klass.name}_${today}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="grouping_${classId}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  } catch (err) {
    console.error("Group export error:", err);
    if (session) fail(session, err instanceof Error ? err.message : "导出分组失败");
    return NextResponse.json({ error: "导出分组失败" }, { status: 500 });
  }
}
