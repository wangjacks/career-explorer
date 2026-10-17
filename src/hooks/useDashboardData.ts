"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  ClassTrendSeries,
  CompareItem,
  DistributionItem,
  TrendItem,
} from "@/lib/dashboard-utils";

export type { ClassTrendSeries, CompareItem, DistributionItem, TrendItem };

export function useDashboardData() {
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [distribution, setDistribution] = useState<DistributionItem[]>([]);
  const [compare, setCompare] = useState<CompareItem[]>([]);
  const [trendDays, setTrendDays] = useState(30);
  const [trendGroup, setTrendGroup] = useState<"total" | "class">("total");
  const [classTrend, setClassTrend] = useState<ClassTrendSeries | null>(null);
  const [firstLoading, setFirstLoading] = useState(true);
  const [trendPending, setTrendPending] = useState(false);
  const [errors, setErrors] = useState({ trends: false, distribution: false, compare: false });
  const loadError = errors.trends || errors.distribution || errors.compare;

  // 三个数据源各自记在途与失败：切换天数只重取趋势，若共用一个 loading，整块组件会退回
  // 「加载中」再重建（观感等同整页刷新），失败标记也会互相覆盖
  const trendRequest = useRef(0);
  const fetchTrendData = useCallback(async (days: number, group: "total" | "class") => {
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
      // 连点天数或切换分组会并发多个请求，晚到的旧口径结果必须丢弃，
      // 否则图上曲线与选中的天数 / 分组对不上
      if (request !== trendRequest.current) return;
      if (group === "class") setClassTrend(data);
      else setTrends(data);
      setErrors((e) => ({ ...e, trends: false }));
    } catch (err) {
      console.error("Trends load error:", err);
      if (request === trendRequest.current) setErrors((e) => ({ ...e, trends: true }));
    } finally {
      if (request === trendRequest.current) setTrendPending(false);
    }
  }, []);

  const fetchDistribution = useCallback(async () => {
    try {
      const res = await fetch("/api/manage/stats/distribution");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDistribution(await res.json());
      setErrors((e) => ({ ...e, distribution: false }));
    } catch (err) {
      console.error("Distribution load error:", err);
      setErrors((e) => ({ ...e, distribution: true }));
    }
  }, []);

  const fetchCompare = useCallback(async () => {
    try {
      const res = await fetch("/api/manage/stats/compare");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCompare(await res.json());
      setErrors((e) => ({ ...e, compare: false }));
    } catch (err) {
      console.error("Compare load error:", err);
      setErrors((e) => ({ ...e, compare: true }));
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- 首屏数据拉取与依赖变更时重取 */
  // 首屏一次拉齐三份，也只有这一次整屏加载态
  useEffect(() => {
    Promise.all([fetchTrendData(trendDays, trendGroup), fetchDistribution(), fetchCompare()]).then(() =>
      setFirstLoading(false)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首屏，用默认天数与默认分组
  }, []);

  // 天数或分组变化只重取趋势；首屏那次已由上面的 effect 拉过，故跳过本 effect 的首次运行
  const trendsLoaded = useRef(false);
  useEffect(() => {
    if (!trendsLoaded.current) {
      trendsLoaded.current = true;
      return;
    }
    fetchTrendData(trendDays, trendGroup);
  }, [trendDays, trendGroup, fetchTrendData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 重试：只重取失败/过期的数据源，已在屏的数据不动
  const reload = () => {
    fetchTrendData(trendDays, trendGroup);
    fetchDistribution();
    fetchCompare();
  };

  return {
    trends,
    distribution,
    compare,
    trendDays,
    trendGroup,
    setTrendDays,
    setTrendGroup,
    classTrend,
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
