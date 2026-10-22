"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClassTrendSeries,
  CompareItem,
  DistributionItem,
  TrendItem,
} from "@/lib/dashboard-utils";
import {
  mergeTrendEntry,
  selectTrendView,
  trendEntryKey,
  type TrendCache,
  type TrendEntry,
  type TrendGroup,
  type TrendView,
} from "@/lib/dashboard-trend";

export type { ClassTrendSeries, CompareItem, DistributionItem, TrendItem };

export interface DashboardDataOptions {
  /** 教师端已移除趋势图：跳过趋势取数；默认 true，管理员端行为不变 */
  includeTrends?: boolean;
  /** 教师端新看板用完成矩阵取代班级对比：跳过 compare 取数；默认 true */
  includeCompare?: boolean;
}

export function useDashboardData({ includeTrends = true, includeCompare = true }: DashboardDataOptions = {}) {
  const [distribution, setDistribution] = useState<DistributionItem[]>([]);
  const [compare, setCompare] = useState<CompareItem[]>([]);
  const [trendDays, setTrendDays] = useState(30);
  const [trendGroup, setTrendGroup] = useState<TrendGroup>("total");
  const [trendCache, setTrendCache] = useState<TrendCache>({});
  // 失败按「哪一组选择失败的」记：切回一个已缓存的口径不会再发请求，
  // 用布尔位会把别的窗口的失败一直盖在能正常显示的数据上
  const [trendFailedKey, setTrendFailedKey] = useState<string | null>(null);
  const [firstLoading, setFirstLoading] = useState(true);
  const [trendPending, setTrendPending] = useState(false);
  const [distributionFailed, setDistributionFailed] = useState(false);
  const [compareFailed, setCompareFailed] = useState(false);

  const currentTrendKey = trendEntryKey({ days: trendDays, group: trendGroup });
  const errors = {
    trends: trendFailedKey === currentTrendKey,
    distribution: distributionFailed,
    compare: compareFailed,
  };
  const loadError = errors.trends || errors.distribution || errors.compare;

  /**
   * 趋势按 `(group, days)` 分槽缓存（#262）：屏上只渲染与当前选择完全匹配的那一份，
   * 因此在途期间是加载态而不是上一口径的曲线，切回旧组合则直接命中旧槽。
   *
   * 三个数据源各自记在途与失败：切换天数只重取趋势，若共用一个 loading，整块组件会退回
   * 「加载中」再重建（观感等同整页刷新），失败标记也会互相覆盖
   */
  const trendCacheRef = useRef<TrendCache>({});
  const trendInFlight = useRef(new Set<string>());
  // 只守在途/失败这类共享标志；数据本身各归各槽，不受序号影响
  const trendRequest = useRef(0);

  const fetchTrendData = useCallback(
    async (days: number, group: TrendGroup, { force = false }: { force?: boolean } = {}) => {
      const key = trendEntryKey({ days, group });
      if (trendInFlight.current.has(key)) return;
      if (!force && key in trendCacheRef.current) return;
      trendInFlight.current.add(key);
      const request = ++trendRequest.current;
      setTrendPending(true);
      try {
        const url =
          group === "class"
            ? `/api/manage/stats/class-trends?days=${days}`
            : `/api/manage/stats/trends?days=${days}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // 连点天数或切换分组会并发多个请求：晚到的旧口径结果仍属于旧口径，
        // 让它写进自己那一槽，屏上不屏上由当前选择决定（而不是丢弃或互相覆盖）
        const entry: TrendEntry =
          group === "class"
            ? { days, group, classTrend: data as ClassTrendSeries }
            : { days, group, trends: data as TrendItem[] };
        trendCacheRef.current = mergeTrendEntry(trendCacheRef.current, entry);
        setTrendCache(trendCacheRef.current);
        if (request === trendRequest.current) {
          setTrendFailedKey((failed) => (failed === key ? null : failed));
        }
      } catch (err) {
        console.error("Trends load error:", err);
        if (request === trendRequest.current) setTrendFailedKey(key);
      } finally {
        trendInFlight.current.delete(key);
        if (request === trendRequest.current) setTrendPending(false);
      }
    },
    []
  );

  const fetchDistribution = useCallback(async () => {
    try {
      const res = await fetch("/api/manage/stats/distribution");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDistribution(await res.json());
      setDistributionFailed(false);
    } catch (err) {
      console.error("Distribution load error:", err);
      setDistributionFailed(true);
    }
  }, []);

  const fetchCompare = useCallback(async () => {
    try {
      const res = await fetch("/api/manage/stats/compare");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCompare(await res.json());
      setCompareFailed(false);
    } catch (err) {
      console.error("Compare load error:", err);
      setCompareFailed(true);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- 首屏数据拉取与依赖变更时重取 */
  // 首屏一次拉齐三份，也只有这一次整屏加载态
  useEffect(() => {
    const tasks = [fetchDistribution()];
    if (includeCompare) tasks.push(fetchCompare());
    if (includeTrends) tasks.push(fetchTrendData(trendDays, trendGroup));
    Promise.all(tasks).then(() => setFirstLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首屏，用默认天数与默认分组
  }, []);

  // 天数或分组变化只重取趋势。首屏那次已由上面的 effect 发起，同键仍在途，这里直接被吸收；
  // 已缓存过的组合同样不再发请求（切回不闪、不重复取）
  useEffect(() => {
    if (!includeTrends) return;
    fetchTrendData(trendDays, trendGroup);
  }, [trendDays, trendGroup, includeTrends, fetchTrendData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const trendView: TrendView = useMemo(
    () => selectTrendView(trendCache, { days: trendDays, group: trendGroup }),
    [trendCache, trendDays, trendGroup]
  );

  // 重试：只重取失败/过期的数据源，已在屏的数据不动；趋势强制重取当前组合（缓存命中也要刷新）
  const reload = () => {
    if (includeTrends) fetchTrendData(trendDays, trendGroup, { force: true });
    fetchDistribution();
    if (includeCompare) fetchCompare();
  };

  return {
    distribution,
    compare,
    trendDays,
    trendGroup,
    setTrendDays,
    setTrendGroup,
    trendView,
    firstLoading,
    trendPending,
    errors,
    loadError,
    reload,
    fetchTrendData,
    fetchDistribution,
    fetchCompare,
  };
}
