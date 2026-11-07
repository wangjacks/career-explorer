/**
 * 导出请求的共享层（#331）：列表「导出名单」弹窗与「数据导出」页共用。
 *
 * 这里只放**纯参数拼装** + 浏览器下载动作：列定义仍以 `export-columns.ts` 为唯一权威，
 * 筛选参数复用 `profile-query.ts` 的 `buildProfileFilterParams`，避免两套导出入口慢慢分叉。
 */

import { buildProfileFilterParams, type ProfileListQuery } from "./profile-query";

export type ExportFormat = "csv" | "xlsx";
export type ExportImagePlacement = "in-cell" | "floating";

/** 弹窗里的一个勾选项；一个勾选项可对应多个导出列（如三条他人评价 / 两个图片 URL） */
export interface ExportColumnChoice {
  label: string;
  keys: readonly string[];
  hint?: string;
}

/** 列表头对应的主列：默认勾选，姓名固定且不可取消（#331） */
export const ROSTER_PRIMARY_COLUMN_CHOICES: readonly ExportColumnChoice[] = [
  { label: "学号", keys: ["student_id"] },
  { label: "虚拟形象（图片）", keys: ["avatar_url"] },
  {
    label: "他人评价",
    keys: ["evaluation_text_1", "evaluation_text_2", "evaluation_text_3"],
    hint: "三条评价文字分别成列；历史词云图片在「更多列」",
  },
  { label: "标签", keys: ["tags"] },
  { label: "兴趣测评（三字码）", keys: ["assessment_code"] },
  { label: "人格特质（Top2 画像）", keys: ["personality_traits"] },
  { label: "提交时间", keys: ["created_at"] },
];

/** 「更多列」：折叠、默认不勾选（#331） */
export const ROSTER_MORE_COLUMN_CHOICES: readonly ExportColumnChoice[] = [
  { label: "测评状态", keys: ["assessment_status"] },
  { label: "测评完成时间", keys: ["assessment_completed_at"] },
  { label: "六型得分（合成一列）", keys: ["assessment_scores"] },
  { label: "大五得分（合成一列）", keys: ["big_five_scores"] },
  { label: "推荐职业 Top3", keys: ["careers"] },
  { label: "历史评价词云图片", keys: ["evaluation_url"] },
  { label: "图片 URL", keys: ["avatar_link", "evaluation_link"], hint: "头像与历史评价图片的地址" },
];

/** 姓名固定导出，避免拿到无名数据 */
export const ROSTER_LOCKED_COLUMN_KEYS: readonly string[] = ["name"];

/** 弹窗默认列：姓名 + 主列表列；「更多列」默认全不选 */
export const ROSTER_DEFAULT_COLUMN_KEYS: readonly string[] = [
  ...ROSTER_LOCKED_COLUMN_KEYS,
  ...ROSTER_PRIMARY_COLUMN_CHOICES.flatMap((choice) => choice.keys),
];

/** 一个勾选项是否全部选中（用于三态展示；当前界面只做全选/全不选） */
export function isChoiceSelected(choice: ExportColumnChoice, selected: ReadonlySet<string>): boolean {
  return choice.keys.every((key) => selected.has(key));
}

export interface ExportRequestOptions {
  format: ExportFormat;
  columns: readonly string[];
  scope?: string;
  ids?: string;
  dateFrom?: string;
  dateTo?: string;
  filters?: ProfileListQuery;
  imagePlacement?: ExportImagePlacement;
  rowHeight?: number;
}

/** 拼 `/api/manage/export` 查询串（纯函数，便于单测） */
export function buildExportSearchParams(options: ExportRequestOptions): URLSearchParams {
  const params = new URLSearchParams();
  params.set("format", options.format);
  params.set("scope", options.scope ?? "all");
  params.set("columns", options.columns.join(","));

  if (options.scope === "byIds" && options.ids) params.set("ids", options.ids);
  if (options.scope === "date") {
    if (options.dateFrom) params.set("dateFrom", options.dateFrom);
    if (options.dateTo) params.set("dateTo", options.dateTo);
  }

  buildProfileFilterParams(options.filters, params);

  if (options.format === "xlsx") {
    params.set("imagePlacement", options.imagePlacement ?? "in-cell");
    params.set("rowHeight", String(options.rowHeight ?? 45));
  }
  return params;
}

/**
 * 下载导出文件（浏览器动作）：失败抛出可展示的中文错误，由调用方 toast。
 * 只允许客户端组件调用（依赖 document / URL.createObjectURL）。
 */
export async function downloadExportFile(params: URLSearchParams, format: ExportFormat): Promise<void> {
  const res = await fetch(`/api/manage/export?${params.toString()}`);
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? "导出失败");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `export_${Date.now()}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
