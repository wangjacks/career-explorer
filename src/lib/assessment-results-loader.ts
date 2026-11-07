/**
 * 「我的档案」测评数据的**唯一拉取入口**（#323）。
 *
 * 期 1（#322）把结果区改成折叠卡后，数据仍由 `AssessmentResultsSection` 自己 fetch；
 * 期 2 要在折叠卡之上加一层速览卡，如果速览卡各自再 fetch 一遍，就会出现
 * 「进页面发三轮请求、摘要和详情还可能不一致」。因此把拉取序列抽到这里：
 *
 * ```
 * GET /api/shared/assessment/list          ← 1 次（启用量表清单）
 * GET /api/shared/assessment/results?code= ← 每套启用量表 1 次（并行，单套失败独立降级）
 * GET /api/shared/assessment/careers       ← ≤1 次（仅当霍兰德有当前结果）
 * ```
 *
 * 纯函数式：`fetcher` 由调用方注入（生产传 `fetch`，测试传计数桩），
 * 返回结果里带 `failedCodes` / `listFailed`，让摘要卡与详情卡各自决定怎么降级。
 * 这里不碰 React、不读 DOM，可直接单测「进入页面只发一轮请求」。
 */

import {
  buildCareerCards,
  resultCardMode,
  type AssessmentResultsPayload,
  type CareerApiItem,
  type CareerCardView,
} from "./assessment-view";
import { normalizeAssessmentList, type AssessmentListItem } from "./assessment-list";

/** 只依赖 `ok` / `json` 的最小 fetch 形状，便于单测注入计数桩 */
export type ResultsFetcher = (input: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface CareersPayload {
  careers?: CareerApiItem[];
  attribution?: string;
  error?: string;
}

export interface AssessmentResultsData {
  /** 启用量表清单（list 失败时为空数组，`listFailed` 为 true） */
  scales: AssessmentListItem[];
  /** 各量表结果，按 code 索引；失败的 code 不在其中 */
  payloads: Record<string, AssessmentResultsPayload>;
  /** 单独失败的量表 code（只有那一张卡降级） */
  failedCodes: string[];
  /** 推荐职业（霍兰德有当前结果时才有；失败/为空都是空数组） */
  careers: CareerCardView[];
  /** 推荐职业接口下发的 CC BY 4.0 署名 */
  careersAttribution: string;
  /** 推荐职业接口失败（有霍兰德结果但没有推荐时区分「失败」与「为空」） */
  careersFailed: boolean;
  /** 量表清单本身失败（整个结果区不可用） */
  listFailed: boolean;
}

export const EMPTY_ASSESSMENT_RESULTS: AssessmentResultsData = {
  scales: [],
  payloads: {},
  failedCodes: [],
  careers: [],
  careersAttribution: "",
  careersFailed: false,
  listFailed: false,
};

/**
 * 拉取全量测评数据。**任何单点失败都不抛出**：清单失败返回 `listFailed`，
 * 单套失败进 `failedCodes`，推荐职业失败静默为空——调用方据此分级降级。
 */
export async function loadAssessmentResultsData(fetcher: ResultsFetcher): Promise<AssessmentResultsData> {
  let scales: AssessmentListItem[] = [];
  try {
    const res = await fetcher("/api/shared/assessment/list");
    const payload = (await res.json()) as { assessments?: unknown; error?: string };
    if (!res.ok) throw new Error(payload?.error || "测评量表清单加载失败");
    scales = normalizeAssessmentList(payload?.assessments);
  } catch (err) {
    console.error("Failed to load assessment list:", err);
    return { ...EMPTY_ASSESSMENT_RESULTS, listFailed: true };
  }

  // 逐套并行补拉：单套失败只记在那一张卡上，不拖垮整个结果区
  const failures: string[] = [];
  const loaded = await Promise.all(
    scales.map(async (item) => {
      try {
        const res = await fetcher(`/api/shared/assessment/results?code=${encodeURIComponent(item.code)}`);
        const data = (await res.json()) as AssessmentResultsPayload & { error?: string };
        if (!res.ok) throw new Error(data?.error || "测评结果加载失败");
        return [item.code, data] as const;
      } catch (err) {
        console.error(`Failed to load assessment results (${item.code}):`, err);
        failures.push(item.code);
        return null;
      }
    })
  );
  const payloads: Record<string, AssessmentResultsPayload> = {};
  for (const row of loaded) {
    if (row) payloads[row[0]] = row[1];
  }

  // 推荐职业（#226）：全页只拉一次，霍兰德有当前结果时才请求；失败/为空都静默
  let careers: CareerCardView[] = [];
  let careersAttribution = "";
  let careersFailed = false;
  const hasHollandCurrent = scales.some((item) => resultCardMode(item) === "holland" && payloads[item.code]?.current);
  if (hasHollandCurrent) {
    try {
      const res = await fetcher("/api/shared/assessment/careers?limit=6");
      const payload = (await res.json()) as CareersPayload;
      if (!res.ok) throw new Error(payload?.error || "推荐职业加载失败");
      careers = buildCareerCards(payload.careers);
      careersAttribution = typeof payload.attribution === "string" ? payload.attribution : "";
    } catch (err) {
      console.error("Failed to load career recommendations:", err);
      careersFailed = true;
    }
  }

  return { scales, payloads, failedCodes: failures, careers, careersAttribution, careersFailed, listFailed: false };
}
