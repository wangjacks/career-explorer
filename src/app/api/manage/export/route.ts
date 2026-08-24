import { NextRequest, NextResponse } from "next/server";
import { getStudents, getAllSubmitted } from "@/lib/db";
import ExcelJS from "exceljs";
import { imageSize } from "image-size";
import { embedImagesInCells, type CellImageEntry } from "@/lib/xlsx-cell-images";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

interface ExportRow {
  student_id: string;
  name: string;
  tags: string; // 已转换的标签名称，分号分隔
  avatar_url: string | null;
  evaluation_url: string | null;
  avatar_link: string | null;
  evaluation_link: string | null;
  created_at: string;
}

function columnToLetters(column: number): string {
  let result = "";
  let current = column;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

/** 将 users 行的标签 JSON（#94 起为名称文本数组）转为 "名称;名称" 展示字符串 */
function tagsToDisplay(tagsJson: string | null): string {
  if (!tagsJson) return "";
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed.map((t) => String(t)).join(";") : "";
  } catch {
    return "";
  }
}

export async function GET(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "csv";
  const scope = searchParams.get("scope") || "all";
  const idsParam = searchParams.get("ids") || "";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";
  const columnsParam = searchParams.get("columns") || "student_id,name,tags,avatar_url,evaluation_url,created_at";
  const imagePlacement = searchParams.get("imagePlacement") || "in-cell";
  const rowHeightParam = searchParams.get("rowHeight");
  const rowHeight = rowHeightParam === null ? 45 : Number(rowHeightParam);

  if (!(["in-cell", "floating"] as const).includes(imagePlacement as "in-cell" | "floating")) {
    return NextResponse.json({ error: "不支持的图片放置方式" }, { status: 400 });
  }
  if (format !== "xlsx" && searchParams.has("imagePlacement")) {
    return NextResponse.json({ error: "图片放置方式仅适用于 Excel 导出" }, { status: 400 });
  }
  if (!Number.isFinite(rowHeight) || rowHeight < 10 || rowHeight > 200) {
    return NextResponse.json({ error: "数据行高度须为 10-200 的数值" }, { status: 400 });
  }

  const selectedColumns = columnsParam.split(",").filter(Boolean);

  // 导出动作审计（#110）：记录范围参数；数据明细不入库（量大且含学生隐私）
  void recordAudit({
    ...actor, action: "export:excel", method: "GET", path: "/api/manage/export",
    resource_type: "export", resource_id: null,
    status: "success", error_message: null, ip, user_agent,
    metadata: { format, scope, columns: selectedColumns.length, imagePlacement },
  });

  // Build student list and submitted profiles
  const students = await getStudents();

  let rows: ExportRow[];

  if (scope === "students") {
    // Student list only (no profile data)
    rows = students.map((s) => ({
      student_id: s.user_code,
      name: s.name,
      tags: "",
      avatar_url: null,
      evaluation_url: null,
      avatar_link: null,
      evaluation_link: null,
      created_at: s.created_at,
    }));
  } else {
    const submitted = await getAllSubmitted();
    rows = submitted.map((r) => ({
      student_id: r.user_code,
      name: r.name,
      tags: tagsToDisplay(r.tags),
      avatar_url: r.avatar_url,
      evaluation_url: r.evaluation_url,
      avatar_link: r.avatar_url,
      evaluation_link: r.evaluation_url,
      created_at: r.submitted_at || "",
    }));

    // Apply filters
    if (scope === "byIds" && idsParam) {
      const filterIds = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
      rows = rows.filter((r) => filterIds.includes(r.student_id));
    }

    if (scope === "date" && (dateFrom || dateTo)) {
      rows = rows.filter((r) => {
        if (!r.created_at) return false;
        const d = r.created_at.slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      });
    }
  }

  // Column config
  const allColumnDefs: { key: string; header: string; width: number }[] = [
    { key: "student_id", header: "学号", width: 16 },
    { key: "name", header: "姓名", width: 12 },
    { key: "tags", header: "标签", width: 30 },
    { key: "avatar_url", header: format === "xlsx" ? "学生头像" : "学生头像URL", width: 35 },
    { key: "evaluation_url", header: format === "xlsx" ? "评价词云" : "评价词云URL", width: 35 },
    { key: "avatar_link", header: "学生头像URL", width: 35 },
    { key: "evaluation_link", header: "评价词云URL", width: 35 },
    { key: "created_at", header: "提交时间", width: 22 },
  ];

  const columns = allColumnDefs.filter((c) => selectedColumns.includes(c.key));

  // Format rows based on selected columns
  const formatRow = (row: ExportRow) => {
    const obj: Record<string, string> = {};
    for (const col of columns) {
      const isImageColumn = col.key === "avatar_url" || col.key === "evaluation_url";
      obj[col.key] = format === "xlsx" && isImageColumn
        ? ""
        : String(row[col.key as keyof ExportRow] ?? "");
    }
    return obj;
  };

  // CSV export
  if (format === "csv") {
    const header = columns.map((c) => c.header).join(",");
    const lines = rows.map((r) => {
      const formatted = formatRow(r);
      return columns.map((c) => `"${formatted[c.key] ?? ""}"`).join(",");
    });
    const csv = "\uFEFF" + header + "\n" + lines.join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="export_${Date.now()}.csv"`,
      },
    });
  }

  // Excel export
  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("数据导出");

    sheet.columns = columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width,
    }));

    // Style header
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B82F6" } };
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };

    // Add data rows
    for (const row of rows) {
      const formatted = formatRow(row);
      sheet.addRow(formatted);
    }

    // Apply configurable data row height (rows below header)
    for (let i = 0; i < rows.length; i++) {
      sheet.getRow(i + 2).height = rowHeight;
    }

    const cellImages: CellImageEntry[] = [];
    const imageColumns = columns.filter((c) => c.key === "avatar_url" || c.key === "evaluation_url");
    if (imageColumns.length > 0) {
      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2; // +2 because row 1 is header
        for (const col of imageColumns) {
            const url = rows[i][col.key as keyof ExportRow] as string | null;
            if (!url) continue;
            try {
              const imgUrl = new URL(url, request.url).toString();
              const imgRes = await fetch(imgUrl);
              if (!imgRes.ok) continue;
              const imgBuffer = await imgRes.arrayBuffer();
              const imgBuf = Buffer.from(imgBuffer);
              const contentType = imgRes.headers.get("content-type")?.split(";")[0].toLowerCase();
              const extension = contentType === "image/png" ? "png"
                : contentType === "image/gif" ? "gif"
                  : contentType === "image/bmp" ? "bmp"
                    : contentType === "image/tiff" ? "tif"
                      : contentType === "image/webp" ? "webp" : "jpg";
              const dims = imageSize(imgBuf);
              if (!dims.width || !dims.height) continue;

              if (imagePlacement === "in-cell") {
                cellImages.push({
                  cell: `${columnToLetters(columns.indexOf(col) + 1)}${rowNum}`,
                  buffer: imgBuf,
                  extension,
                });
                continue;
              }

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const imgId = workbook.addImage({ buffer: imgBuf as any, extension: "jpeg" });

              // Detect original dimensions and scale proportionally
              const targetH = 60;
              const targetW = dims.width && dims.height
                ? Math.round((dims.width / dims.height) * targetH)
                : targetH;

              const colIdx = columns.indexOf(col);
              sheet.addImage(imgId, {
                tl: { col: colIdx + 0.1, row: rowNum - 0.9 },
                ext: { width: targetW, height: targetH },
              });
            } catch (err) {
              console.warn("Failed to embed image in Excel:", url, err);
            }
        }
      }
    }

    const workbookBuffer = await workbook.xlsx.writeBuffer();
    const buffer: Buffer = imagePlacement === "in-cell"
      ? await embedImagesInCells(workbookBuffer, cellImages)
      : Buffer.from(new Uint8Array(workbookBuffer));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="export_${Date.now()}.xlsx"`,
      },
    });
  }

  return NextResponse.json({ error: "不支持的格式" }, { status: 400 });
}

// Preview endpoint
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  const body = await request.json();
  const { scope, ids, dateFrom, dateTo, columns: columnsParam } = body;
  void recordAudit({
    ...actor, action: "export:excel", method: "POST", path: "/api/manage/export",
    resource_type: "export", resource_id: null,
    status: "success", error_message: null, ip, user_agent,
    metadata: { preview: true, scope: scope ?? "all" },
  });

  const students = await getStudents();

  let rows: ExportRow[];

  if (scope === "students") {
    rows = students.map((s) => ({
      student_id: s.user_code,
      name: s.name,
      tags: "",
      avatar_url: null,
      evaluation_url: null,
      avatar_link: null,
      evaluation_link: null,
      created_at: s.created_at,
    }));
  } else {
    const submitted = await getAllSubmitted();
    rows = submitted.map((r) => ({
      student_id: r.user_code,
      name: r.name,
      tags: tagsToDisplay(r.tags),
      avatar_url: r.avatar_url,
      evaluation_url: r.evaluation_url,
      avatar_link: r.avatar_url,
      evaluation_link: r.evaluation_url,
      created_at: r.submitted_at || "",
    }));

    if (scope === "byIds" && ids) {
      const filterIds = ids.split(",").map((s: string) => s.trim()).filter(Boolean);
      rows = rows.filter((r) => filterIds.includes(r.student_id));
    }

    if (scope === "date" && (dateFrom || dateTo)) {
      rows = rows.filter((r) => {
        if (!r.created_at) return false;
        const d = r.created_at.slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      });
    }
  }

  const selectedColumns = (columnsParam || "student_id,name,tags").split(",");
  const preview = rows.slice(0, 10).map((r) => {
    const obj: Record<string, string> = {};
    for (const key of selectedColumns) {
      obj[key] = String(r[key as keyof ExportRow] ?? "");
    }
    return obj;
  });

  return NextResponse.json({ total: rows.length, preview });
}
