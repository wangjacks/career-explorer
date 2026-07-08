import { NextRequest, NextResponse } from "next/server";
import { getAllProfilesRaw, getAllStudents } from "@/lib/db";
import ExcelJS from "exceljs";

function checkAuth(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const password = process.env.ADMIN_PASSWORD || "admin123";
  return auth === `Bearer ${password}`;
}

interface ExportRow {
  student_id: string;
  name: string;
  tags: string;
  avatar_url: string | null;
  evaluation_url: string | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "csv";
  const scope = searchParams.get("scope") || "all";
  const idsParam = searchParams.get("ids") || "";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";
  const columnsParam = searchParams.get("columns") || "student_id,name,tags,avatar_url,evaluation_url,created_at";
  const embedImages = searchParams.get("embedImages") === "true";

  const selectedColumns = columnsParam.split(",").filter(Boolean);

  // Build student name map
  const students = await getAllStudents();
  const nameMap = new Map(students.map((s) => [s.student_id, s.name]));

  // Get and filter profiles
  let rows: ExportRow[];

  if (scope === "students") {
    // Student list only (no profile data)
    rows = students.map((s) => ({
      student_id: s.student_id,
      name: s.name,
      tags: "",
      avatar_url: null,
      evaluation_url: null,
      created_at: s.created_at,
    }));
  } else {
    const allProfiles = await getAllProfilesRaw();
    rows = allProfiles.map((r) => ({
      student_id: r.student_id,
      name: nameMap.get(r.student_id) || "",
      tags: r.tags,
      avatar_url: r.avatar_url,
      evaluation_url: r.evaluation_url,
      created_at: r.created_at,
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
    { key: "avatar_url", header: "虚拟形象URL", width: 35 },
    { key: "evaluation_url", header: "评价词云URL", width: 35 },
    { key: "created_at", header: "提交时间", width: 22 },
  ];

  const columns = allColumnDefs.filter((c) => selectedColumns.includes(c.key));

  // Format rows based on selected columns
  const formatRow = (row: ExportRow) => {
    const obj: Record<string, string> = {};
    for (const col of columns) {
      if (col.key === "tags") {
        obj[col.key] = JSON.parse(row.tags || "[]").join(";");
      } else {
        obj[col.key] = String(row[col.key as keyof ExportRow] ?? "");
      }
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

    // Embed images if requested
    if (embedImages) {
      const imageCols = columns.filter((c) => c.key === "avatar_url" || c.key === "evaluation_url");
      if (imageCols.length > 0) {
        for (let i = 0; i < rows.length; i++) {
          const rowNum = i + 2; // +2 because row 1 is header
          for (const col of imageCols) {
            const url = rows[i][col.key as keyof ExportRow] as string | null;
            if (!url) continue;
            try {
              const imgUrl = new URL(url, request.url).toString();
              const imgRes = await fetch(imgUrl);
              if (!imgRes.ok) continue;
              const imgBuffer = await imgRes.arrayBuffer();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const imgId = workbook.addImage({ buffer: Buffer.from(imgBuffer) as any, extension: "jpeg" });
              const colIdx = columns.indexOf(col);
              sheet.addImage(imgId, {
                tl: { col: colIdx + 0.1, row: rowNum - 0.9 },
                ext: { width: 60, height: 60 },
              });
              sheet.getRow(rowNum).height = 50;
            } catch {}
          }
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer, {
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
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const { scope, ids, dateFrom, dateTo, columns: columnsParam } = body;

  const students = await getAllStudents();
  const nameMap = new Map(students.map((s) => [s.student_id, s.name]));

  let rows: ExportRow[];

  if (scope === "students") {
    rows = students.map((s) => ({
      student_id: s.student_id,
      name: s.name,
      tags: "",
      avatar_url: null,
      evaluation_url: null,
      created_at: s.created_at,
    }));
  } else {
    const allProfiles = await getAllProfilesRaw();
    rows = allProfiles.map((r) => ({
      student_id: r.student_id,
      name: nameMap.get(r.student_id) || "",
      tags: r.tags,
      avatar_url: r.avatar_url,
      evaluation_url: r.evaluation_url,
      created_at: r.created_at,
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
      if (key === "tags") {
        obj[key] = JSON.parse(r.tags || "[]").join(";");
      } else {
        obj[key] = String(r[key as keyof ExportRow] ?? "");
      }
    }
    return obj;
  });

  return NextResponse.json({ total: rows.length, preview });
}
