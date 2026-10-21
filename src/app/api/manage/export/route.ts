import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import {
  getStudents,
  getAllSubmitted,
  getSubmittedProfilesForExport,
  getClasses,
  getEnabledAssessments,
  getCurrentAssessmentResultsByUserCodes,
  getOnetOccupations,
  type AssessmentRow,
} from "@/lib/db";
import ExcelJS from "exceljs";
import { imageSize } from "image-size";
import { embedImagesInCells, type CellImageEntry } from "@/lib/xlsx-cell-images";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";
import { getStorage } from "@/lib/storage";
import { parseStoredEvaluationTexts } from "@/lib/evaluation-text";
import { profileFromDimensionScores, rankCareers, type RiasecKey } from "@/lib/assessment-match";
import { toCareerCandidates } from "@/lib/onet";
import { profileScaleViewOf, type ProfileAssessmentScaleView } from "@/lib/profile-assessment";
import {
  parseProfileFilters,
  resolveProfilePersonalityFilter,
  type ResolvedProfileListQuery,
} from "@/lib/profile-query";
import {
  DEFAULT_EXPORT_COLUMN_KEYS,
  buildClassNameMap,
  classNameOf,
  columnLetter,
  formatAssessmentStatus,
  formatBigFiveScores,
  formatSixScores,
  formatTopCareers,
  imageColumnIndex,
  isHollandAssessmentColumn,
  isImageColumn,
  isPersonalityColumn,
  parseColumnKeys,
  resolveExportColumns,
  type SixScoreValues,
} from "@/lib/export-columns";

interface ExportRow {
  student_id: string;
  name: string;
  /** 班级名（#233）：班级表内存关联，未分班为空串 */
  class_name: string;
  tags: string; // 已转换的标签名称，分号分隔
  avatar_url: string | null;
  /** 历史上传的评价词云图片；#162 起仅存量 */
  evaluation_url: string | null;
  /** 三条他人评价（#162）；未填或旧数据为空串 */
  evaluation_text_1: string;
  evaluation_text_2: string;
  evaluation_text_3: string;
  avatar_link: string | null;
  evaluation_link: string | null;
  /** 文件所在存储后端（#111）；本地代理路径与云对象 key 的解析依据 */
  storage_id: number | null;
  created_at: string;
  /** 当前有效测评结果（#233）：未测评为 false / 空串，导出的测评列整格留空 */
  has_assessment: boolean;
  assessment_completed_at: string;
  assessment_code: string;
  assessment_scores_json: string | null;
  /** 推荐职业 Top3（中文名优先，分号分隔）；职业库不可用或未测评时为空串 */
  careers: string;
  /** 大五 Top2 画像（#331）；未测 / 快照不可用时为空串 */
  personality_traits: string;
  /** 大五五维分合成一列（#331）；未测 / 快照不可用时为空串 */
  big_five_scores: string;
}

interface ExportFilters {
  scope: string;
  ids: string;
  dateFrom: string;
  dateTo: string;
  /** 与列表同一份筛选口径（#331）；导出时不再内存过滤，直接由 SQL 取全量命中行 */
  filters: ResolvedProfileListQuery;
}

function emptyRow(partial: Omit<ExportRow, "has_assessment" | "assessment_completed_at" | "assessment_code" | "assessment_scores_json" | "careers" | "personality_traits" | "big_five_scores">): ExportRow {
  return {
    ...partial,
    has_assessment: false,
    assessment_completed_at: "",
    assessment_code: "",
    assessment_scores_json: null,
    careers: "",
    personality_traits: "",
    big_five_scores: "",
  };
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

/** 导出 URL 列解析（#111）：本地代理路径原样保留；云后端签发限时签名 URL（30 分钟） */
async function resolveExportLink(url: string | null, storageId: number | null): Promise<string | null> {
  if (!url) return url;
  if (url.startsWith("/api/uploads/") || !storageId) return url;
  try {
    const storage = await getStorage(storageId);
    return await storage.getSignedUrl(url.split("?")[0]);
  } catch (err) {
    console.warn("Failed to sign export link:", url, err);
    return url;
  }
}

/** 服务端拉取图片内容（#111）：本地走内部代理；云走存储抽象（内网端点，省公网流量） */
async function fetchImageBuffer(
  url: string,
  storageId: number | null,
  baseUrl: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (url.startsWith("/api/uploads/")) {
    const res = await fetch(new URL(url, baseUrl).toString());
    if (!res.ok) return null;
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "image/jpeg",
    };
  }
  if (!storageId) return null;
  const storage = await getStorage(storageId);
  const buffer = await storage.read(url.split("?")[0]);
  return { buffer, contentType: "image/jpeg" };
}

/** 得分快照 → 匹配画像（解析失败/非 RIASEC 当作无画像，对应学生推荐列留空） */
function profileOfScores(scoresJson: string | null): ReturnType<typeof profileFromDimensionScores> {
  if (!scoresJson) return null;
  try {
    const parsed = JSON.parse(scoresJson) as { key: string; standard: number }[];
    return profileFromDimensionScores(Array.isArray(parsed) ? parsed : null);
  } catch (err) {
    console.error("Failed to parse assessment scores for export:", err);
    return null;
  }
}

interface ScaleEntry {
  row: AssessmentRow;
  view: ProfileAssessmentScaleView;
}

/**
 * 取启用中的量表清单（#331）：只有勾选测评列或带人格筛选时才查。
 * 失败只让对应列留空（`failed` 供带人格筛选的请求转 503），不打断默认列导出。
 */
async function loadScaleEntries(
  selectedKeys: readonly string[],
  force = false
): Promise<{ entries: ScaleEntry[]; failed: boolean }> {
  const needsScales =
    force || selectedKeys.some((key) => isHollandAssessmentColumn(key) || isPersonalityColumn(key));
  if (!needsScales) return { entries: [], failed: false };
  try {
    const enabled = await getEnabledAssessments();
    return { entries: enabled.map((row) => ({ row, view: profileScaleViewOf(row) })), failed: false };
  } catch (err) {
    console.error("Export assessment scale lookup degraded:", err);
    return { entries: [], failed: true };
  }
}

/**
 * 组装导出行（#233 / #331）：学生表全量 / 已提交档案两种来源，班级名内存关联；
 * 带筛选时按列表同一份 SQL 口径**全量**取行（不分页），再按需批查当前有效测评结果。
 */
async function buildExportRows(
  filters: ExportFilters,
  selectedKeys: readonly string[],
  scaleEntries: readonly ScaleEntry[]
): Promise<ExportRow[]> {
  const filtersActive = Boolean(
    filters.filters.q?.trim() ||
      (filters.filters.tags?.length ?? 0) > 0 ||
      (filters.filters.lead ?? "all") !== "all" ||
      filters.filters.interest ||
      filters.filters.personality
  );
  const [students, submitted, classes] = await Promise.all([
    // 只有「学生名单」导出需要整表名单；其余范围按已提交档案取行，避免多余的全表读
    filters.scope === "students" ? getStudents() : Promise.resolve([]),
    // #331：带筛选时直接走数据库（与列表同口径、含所有页）；无筛选保持原 getAllSubmitted 行为
    filters.scope === "students"
      ? Promise.resolve([])
      : filtersActive
        ? getSubmittedProfilesForExport(filters.filters)
        : getAllSubmitted(),
    getClasses(),
  ]);
  const classNames = buildClassNameMap(classes);

  let rows: ExportRow[];
  if (filters.scope === "students") {
    // 学生名单：只导出名单基础信息，档案/测评字段按学号照常补齐（不因缺档案而丢弃该行）
    rows = students.map((s) =>
      emptyRow({
        student_id: s.user_code,
        name: s.name,
        class_name: classNameOf(s.class_id, classNames),
        tags: "",
        avatar_url: null,
        evaluation_url: null,
        evaluation_text_1: "",
        evaluation_text_2: "",
        evaluation_text_3: "",
        avatar_link: null,
        evaluation_link: null,
        storage_id: null,
        created_at: s.created_at,
      })
    );
  } else {
    rows = submitted.map((r) => {
      const evaluationTexts = parseStoredEvaluationTexts(r.evaluation_text);
      return emptyRow({
        student_id: r.user_code,
        name: r.name,
        class_name: classNameOf(r.class_id, classNames),
        tags: tagsToDisplay(r.tags),
        avatar_url: r.avatar_url,
        evaluation_url: r.evaluation_url,
        evaluation_text_1: evaluationTexts[0] ?? "",
        evaluation_text_2: evaluationTexts[1] ?? "",
        evaluation_text_3: evaluationTexts[2] ?? "",
        avatar_link: r.avatar_url,
        evaluation_link: r.evaluation_url,
        storage_id: r.storage_id ?? null,
        created_at: r.submitted_at || "",
      });
    });

    // Apply filters
    if (filters.scope === "byIds" && filters.ids) {
      const filterIds = filters.ids.split(",").map((s) => s.trim()).filter(Boolean);
      rows = rows.filter((r) => filterIds.includes(r.student_id));
    }

    if (filters.scope === "date" && (filters.dateFrom || filters.dateTo)) {
      rows = rows.filter((r) => {
        if (!r.created_at) return false;
        const d = r.created_at.slice(0, 10);
        if (filters.dateFrom && d < filters.dateFrom) return false;
        if (filters.dateTo && d > filters.dateTo) return false;
        return true;
      });
    }
  }

  // 导出 URL 列：云后端转限时签名链接（#111；本地代理路径原样保留）
  for (const r of rows) {
    r.avatar_link = await resolveExportLink(r.avatar_link, r.storage_id);
    r.evaluation_link = await resolveExportLink(r.evaluation_link, r.storage_id);
  }

  const needsHolland = selectedKeys.some(isHollandAssessmentColumn);
  const needsBigFive = selectedKeys.some(isPersonalityColumn);
  const needsCareers = selectedKeys.includes("careers");
  if ((!needsHolland && !needsBigFive) || rows.length === 0) return rows;

  const hollandEntry = scaleEntries.find((entry) => entry.view.scoringMode === "typological") ?? null;
  const bigFiveEntry = scaleEntries.find((entry) => entry.view.scoringMode === "dimensional") ?? null;

  // 每个量表各批查一次：未测评学生不出现在结果里，对应格留空（不填 0）
  if (needsHolland && hollandEntry) {
    try {
      const summaries = await getCurrentAssessmentResultsByUserCodes(
        hollandEntry.row.id,
        rows.map((r) => r.student_id)
      );
      const summaryByCode = new Map(summaries.map((summary) => [summary.user_code, summary]));
      for (const row of rows) {
        const summary = summaryByCode.get(row.student_id);
        if (!summary) continue;
        row.has_assessment = true;
        row.assessment_completed_at = summary.completed_at ?? "";
        row.assessment_code = summary.type_code ?? "";
        row.assessment_scores_json = summary.scores_json;
      }
    } catch (err) {
      console.error("Export holland results lookup degraded:", err);
    }
  }

  if (needsBigFive && bigFiveEntry) {
    try {
      const summaries = await getCurrentAssessmentResultsByUserCodes(
        bigFiveEntry.row.id,
        rows.map((r) => r.student_id)
      );
      const summaryByCode = new Map(summaries.map((summary) => [summary.user_code, summary]));
      for (const row of rows) {
        const summary = summaryByCode.get(row.student_id);
        if (!summary) continue;
        const values = formatBigFiveScores(summary.scores_json, bigFiveEntry.view.dimensions);
        row.personality_traits = values.traits;
        row.big_five_scores = values.composite;
      }
    } catch (err) {
      console.error("Export big five results lookup degraded:", err);
    }
  }

  if (needsCareers) {
    const occupationRows = await getOnetOccupations();
    if (occupationRows.length > 0) {
      const candidates = toCareerCandidates(occupationRows);
      for (const row of rows) {
        const profile = profileOfScores(row.assessment_scores_json);
        if (!profile) continue;
        row.careers = formatTopCareers(rankCareers(profile, candidates, { topN: 3 }));
      }
    }
  }

  return rows;
}

/** 单行单列取值：测评列按快照格式化，图片列在 Excel 里留空（图片另行内嵌/浮动） */
function formatCell(
  row: ExportRow,
  key: string,
  format: "csv" | "xlsx",
  sixScores: SixScoreValues
): string {
  if (key.startsWith("score_")) {
    const dimension = key.slice("score_".length) as RiasecKey;
    return sixScores.perDimension[dimension] ?? "";
  }
  if (key.startsWith("evaluation_text_")) {
    const value = String((row as unknown as Record<string, unknown>)[key] ?? "");
    if (format === "csv") {
      // CSV 单行化 + 防公式注入：学生评价是自由文本，不能直接以 = + - @ 开头落进表格
      const flattened = value.replace(/\r?\n/g, " ");
      return /^[=+\-@]/.test(flattened) ? `'${flattened}` : flattened;
    }
    return value;
  }
  switch (key) {
    case "class_name":
      return row.class_name;
    case "assessment_status":
      return formatAssessmentStatus(row.has_assessment);
    case "assessment_completed_at":
      return row.assessment_completed_at;
    case "assessment_code":
      return row.assessment_code;
    case "assessment_scores":
      return sixScores.composite;
    case "careers":
      return row.careers;
    case "personality_traits":
      return row.personality_traits;
    case "big_five_scores":
      return row.big_five_scores;
    default:
      if (format === "xlsx" && isImageColumn(key)) return "";
      return String((row as unknown as Record<string, unknown>)[key] ?? "");
  }
}

function formatRow(row: ExportRow, columns: { key: string }[], format: "csv" | "xlsx"): Record<string, string> {
  const sixScores = formatSixScores(row.assessment_scores_json);
  const values: Record<string, string> = {};
  for (const column of columns) values[column.key] = formatCell(row, column.key, format, sixScores);
  return values;
}

function quoteCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function GET_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  const { searchParams } = new URL(request.url);

  // 能力探测（#233）：前端据此决定「推荐职业 Top3」按钮是否可点（依赖 O*NET 职业库就绪）
  if (searchParams.get("capabilities") === "1") {
    try {
      const occupationRows = await getOnetOccupations();
      return NextResponse.json({ recommendations: occupationRows.length > 0 });
    } catch (err) {
      // 职业库读不出来按「未就绪」处理：界面把按钮置灰，而不是用 500 打断整个导出面板
      console.error("Failed to detect export capabilities:", err);
      return NextResponse.json({ recommendations: false });
    }
  }

  const format = searchParams.get("format") || "csv";
  const scope = searchParams.get("scope") || "all";
  const idsParam = searchParams.get("ids") || "";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";
  const columnsParam = searchParams.get("columns");
  // 未传 columns 时用默认列（与 #233 之前完全一致）；显式传空串表示「一列都不选」，按空列导出
  const selectedKeys = columnsParam === null ? [...DEFAULT_EXPORT_COLUMN_KEYS] : parseColumnKeys(columnsParam);
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
  if (format !== "csv" && format !== "xlsx") {
    return NextResponse.json({ error: "不支持的格式" }, { status: 400 });
  }

  // #331：筛选参数与列表共用同一份解析/校验；导出只消费，不再内存过滤
  const parsedFilters = parseProfileFilters(searchParams);
  if (!parsedFilters.ok) {
    return NextResponse.json({ error: parsedFilters.error }, { status: 400 });
  }
  const { entries: scaleEntries, failed: scaleLoadFailed } = await loadScaleEntries(
    selectedKeys,
    Boolean(parsedFilters.value.personality)
  );
  const resolvedFilters = resolveProfilePersonalityFilter(
    parsedFilters.value,
    scaleEntries.map((entry) => entry.view)
  );
  if (!resolvedFilters.ok) {
    // 量表读取失败 ≠ 没有启用的维度型量表：前者按 503 让客户端重试
    return NextResponse.json(
      { error: resolvedFilters.error },
      { status: scaleLoadFailed ? 503 : 400 }
    );
  }

  // 导出动作审计（#110）：记录范围参数；数据明细不入库（量大且含学生隐私）
  void recordAudit({
    ...actor, action: "export:excel", method: "GET", path: "/api/manage/export",
    resource_type: "export", resource_id: null,
    status: "success", error_message: null, ip, user_agent,
    metadata: {
      format,
      scope,
      columns: selectedKeys.length,
      imagePlacement,
      filtered:
        Boolean(parsedFilters.value.q?.trim()) ||
        (parsedFilters.value.tags?.length ?? 0) > 0 ||
        (parsedFilters.value.lead ?? "all") !== "all" ||
        Boolean(parsedFilters.value.interest) ||
        Boolean(parsedFilters.value.personality),
    },
  });

  const exportFormat: "csv" | "xlsx" = format;
  const columns = resolveExportColumns(selectedKeys, exportFormat);
  const rows = await buildExportRows(
    { scope, ids: idsParam, dateFrom, dateTo, filters: resolvedFilters.filters },
    selectedKeys,
    scaleEntries
  );

  // CSV export
  if (exportFormat === "csv") {
    const header = columns.map((c) => quoteCsv(c.header)).join(",");
    const lines = rows.map((r) => {
      const formatted = formatRow(r, columns, "csv");
      return columns.map((c) => quoteCsv(formatted[c.key] ?? "")).join(",");
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
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("数据导出");

  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
  }));

  // Style header
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B82F6" } };

  // Add data rows
  for (const row of rows) {
    sheet.addRow(formatRow(row, columns, "xlsx"));
  }

  // Apply configurable data row height (rows below header)
  for (let i = 0; i < rows.length; i++) {
    sheet.getRow(i + 2).height = rowHeight;
  }

  // #162：三条他人评价自动换行，避免长文本在当前行高下被截断
  const evaluationTextColumnIndexes = columns
    .map((column, index) => (column.key.startsWith("evaluation_text_") ? index + 1 : 0))
    .filter((index) => index > 0);
  for (let i = 0; i < rows.length; i += 1) {
    for (const columnIndex of evaluationTextColumnIndexes) {
      sheet.getCell(i + 2, columnIndex).alignment = { wrapText: true, vertical: "top" };
    }
  }

  const cellImages: CellImageEntry[] = [];
  const imageColumns = columns.filter((c) => isImageColumn(c.key));
  if (imageColumns.length > 0) {
    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // +2 because row 1 is header
      for (const col of imageColumns) {
        const url = rows[i][col.key as keyof ExportRow] as string | null;
        if (!url) continue;
        try {
          const img = await fetchImageBuffer(url, rows[i].storage_id, request.url);
          if (!img) continue;
          const imgBuf = img.buffer;
          const contentType = img.contentType.split(";")[0].toLowerCase();
          const extension = contentType === "image/png" ? "png"
            : contentType === "image/gif" ? "gif"
              : contentType === "image/bmp" ? "bmp"
                : contentType === "image/tiff" ? "tif"
                  : contentType === "image/webp" ? "webp" : "jpg";
          const dims = imageSize(imgBuf);
          if (!dims.width || !dims.height) continue;

          // 图片锚点由**最终列下标**算出：插入班级/测评列后仍落在头像/词云列（#233 验收点）
          const columnIndex = imageColumnIndex(columns, col.key);
          if (columnIndex === 0) continue;

          if (imagePlacement === "in-cell") {
            cellImages.push({
              cell: `${columnLetter(columnIndex)}${rowNum}`,
              buffer: imgBuf,
              extension,
            });
            continue;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const imgId = workbook.addImage({ buffer: imgBuf as any, extension: "jpeg" });

          // Detect original dimensions and scale proportionally
          const targetH = 60;
          const targetW = Math.round((dims.width / dims.height) * targetH);

          sheet.addImage(imgId, {
            tl: { col: columnIndex - 1 + 0.1, row: rowNum - 0.9 },
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

// Preview endpoint
async function POST_impl(request: NextRequest) {
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

  const selectedKeys = parseColumnKeys(typeof columnsParam === "string" ? columnsParam : null);
  const keys = typeof columnsParam === "string" ? selectedKeys : [...DEFAULT_EXPORT_COLUMN_KEYS];
  const { entries: scaleEntries } = await loadScaleEntries(keys);
  const rows = await buildExportRows(
    {
      scope: scope ?? "all",
      ids: ids ?? "",
      dateFrom: dateFrom ?? "",
      dateTo: dateTo ?? "",
      filters: { lead: "all" },
    },
    keys,
    scaleEntries
  );
  const columns = resolveExportColumns(keys, "csv");
  const preview = rows.slice(0, 10).map((row) => formatRow(row, columns, "csv"));

  return NextResponse.json({
    total: rows.length,
    columns: columns.map((column) => ({ key: column.key, header: column.header })),
    preview,
  });
}

export const GET = withDemoScope(GET_impl);
export const POST = withDemoScope(POST_impl);
