"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface TrendItem {
  date: string;
  count: number;
}

interface DistributionItem {
  category: string;
  count: number;
}

interface CompareItem {
  key: string;
  count: number;
}

const COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export default function DashboardTab() {
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [distribution, setDistribution] = useState<DistributionItem[]>([]);
  const [compare, setCompare] = useState<CompareItem[]>([]);
  const [compareBy, setCompareBy] = useState<"class" | "segment">("class");
  const [trendDays, setTrendDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, dRes, cRes] = await Promise.all([
        fetch(`/api/admin/stats/trends?days=${trendDays}`),
        fetch("/api/admin/stats/distribution"),
        fetch(`/api/admin/stats/compare?by=${compareBy}`),
      ]);
      if (tRes.ok) setTrends(await tRes.json());
      if (dRes.ok) setDistribution(await dRes.json());
      if (cRes.ok) setCompare(await cRes.json());
    } catch (err) {
      console.error("Dashboard load error:", err);
    }
    setLoading(false);
  }, [trendDays, compareBy]);

  /* eslint-disable react-hooks/set-state-in-effect -- data fetch on deps change */
  useEffect(() => {
    loadData();
  }, [loadData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (loading) {
    return <div className="text-center py-12 text-gray-400">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">趋势天数：</span>
          {[7, 14, 30, 60].map((d) => (
            <button
              key={d}
              onClick={() => setTrendDays(d)}
              className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                trendDays === d
                  ? "bg-green-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {d}天
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">对比维度：</span>
          <button
            onClick={() => setCompareBy("class")}
            className={`px-3 py-1 text-sm rounded-lg transition-colors ${
              compareBy === "class"
                ? "bg-green-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            班级
          </button>
          <button
            onClick={() => setCompareBy("segment")}
            className={`px-3 py-1 text-sm rounded-lg transition-colors ${
              compareBy === "segment"
                ? "bg-green-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            年级/院系
          </button>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trends Line Chart */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">提交趋势（近{trendDays}天）</h3>
          {trends.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  labelFormatter={(v) => `日期: ${v}`}
                  formatter={(value) => [`${value} 条`, "提交数"]}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-gray-400">暂无数据</div>
          )}
        </div>

        {/* Distribution Pie Chart */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">标签分类分布</h3>
          {distribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={distribution}
                  dataKey="count"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  label={(props: any) =>
                    `${props.category} ${((Number(props.percent) || 0) * 100).toFixed(0)}%`
                  }
                >
                  {distribution.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [`${value} 个`, "标签数"]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-gray-400">暂无数据</div>
          )}
        </div>

        {/* Compare Bar Chart */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 lg:col-span-2">
          <h3 className="font-semibold text-gray-800 mb-4">
            {compareBy === "class" ? "班级" : "年级/院系"}对比
          </h3>
          {compare.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={compare}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="key" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  formatter={(value) => [`${value} 条`, "提交数"]}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">暂无数据</div>
          )}
        </div>
      </div>
    </div>
  );
}
