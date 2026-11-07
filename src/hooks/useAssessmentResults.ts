"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EMPTY_ASSESSMENT_RESULTS,
  loadAssessmentResultsData,
  type AssessmentResultsData,
} from "@/lib/assessment-results-loader";

export interface UseAssessmentResultsResult {
  data: AssessmentResultsData;
  /** 首轮加载中（摘要卡与结果区共用一个 loading，避免两处各自骨架） */
  loading: boolean;
  /** 量表清单失败（整个测评数据不可用；单套失败见 `data.failedCodes`） */
  failed: boolean;
  reload: () => void;
}

/**
 * 「我的档案」测评数据 hook（#323）：页面只挂一次，摘要卡与折叠详情卡**共用同一份数据**。
 *
 * 拉取序列在 `assessment-results-loader.ts`（纯函数、有单测）；本 hook 只负责状态与生命周期。
 * `enabled` 由页面按会话角色传入——未登录时不必先打一堆 401。
 */
export function useAssessmentResults(enabled: boolean): UseAssessmentResultsResult {
  const [data, setData] = useState<AssessmentResultsData>(EMPTY_ASSESSMENT_RESULTS);
  // 初始按「加载中」处理：会话就绪后 enabled 变 true 时不会先闪一帧空态卡片
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const next = await loadAssessmentResultsData((input) => fetch(input));
    setData(next);
    setFailed(next.listFailed);
    setLoading(false);
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- 会话就绪后拉取本人测评数据（与档案数据并列、互不依赖） */
  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return { data, loading, failed, reload };
}
