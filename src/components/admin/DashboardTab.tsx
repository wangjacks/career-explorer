"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LabelList,
} from "recharts";
import { Loader2, TrendingUp, PieChart as PieChartIcon, BarChart3, TriangleAlert } from "lucide-react";
import { formatRateText } from "@/lib/stats-utils";

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
  total: number;
  submitted: number;
}

/** 数据绿：与品牌深翡翠同族，两种主题下都够对比（容器底为白/暗卡片） */
const DATA_GREEN = "#059669";
/** 大屏面板：固定深翡翠渐变，不随主题翻转，故面板内的前景色也固定（浅色下避开发灰的绿） */
const HERO_FACE = "linear-gradient(135deg, #065f46 0%, #064e3b 100%)";
/** 等宽栈与 globals.css 的 --font-mono 一致；SVG 属性不接受 var()，故写字面量 */
const MONO = "ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace";

/** 标签三维度按名称取语义色（与 --tag-* 同值），其余类别按 ui-conventions「>3 类循环取色」 */
const TAG_COLORS: Record<string, string> = {
  兴趣: "#059669",
  技能: "#0284c7",
  性格: "#f59e0b",
};
const FALLBACK_COLORS = ["#8b5cf6", "#0d9488", "#94a3b8", "#64748b"];
/** 点名册条超过此人数退化为按比例轨，避免上千个 DOM 节点 */
const ROSTER_MARK_CAP = 200;

const DAY_OPTIONS = [7, 14, 30, 60] as const;

/** recharts 的 payload 条目类型较宽（name/dataKey 可为 string|number，dataKey 还可能是函数），
    这里只取本页图表用到的字段，取值时统一转字符串 */
interface TooltipRow {
  name?: string | number;
  value?: unknown;
  color?: string;
  fill?: string;
  dataKey?: unknown;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<TooltipRow>;
  label?: string | number;
  /** 值后缀单位 */
  unit?: string;
  /** 覆盖行名（单序列图用） */
  name?: string;
  labelPrefix?: string;
  /** 追加汇总行，如「在册 24 人 · 提交率 75.0%」 */
  extra?: (rows: ReadonlyArray<TooltipRow>) => string;
}

/** 自定义 Tooltip：默认样式是白底黑字，暗色主题下刺眼且与卡片规范不符 */
function ChartTooltip({ active, payload, label, unit = "", name, labelPrefix = "", extra }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-border-soft bg-card px-3 py-2 text-xs shadow-lg">
      {label !== undefined && label !== "" && (
        <p className="mb-1 font-medium text-foreground">
          {labelPrefix}
          {label}
        </p>
      )}
      <div className="space-y-0.5">
        {payload.map((row, i) => (
          <p key={i} className="flex items-center gap-2">
            <span
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{ background: row.color ?? row.fill ?? "#94a3b8" }}
            />
            <span className="text-foreground">{name ?? row.name}</span>
            <span className="ml-auto pl-3 font-mono tabular-nums text-foreground">
              {String(row.value ?? "")}
              {unit}
            </span>
          </p>
        ))}
      </div>
      {extra && (
        <p className="mt-1.5 border-t border-border-soft pt-1.5 font-mono tabular-nums text-muted">
          {extra(payload)}
        </p>
      )}
    </div>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
              active
                ? "bg-primary text-white shadow-sm"
                : "text-gray-600 dark:text-gray-300 hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 空态：图标 + 说明 + 下一步（规范要求空屏幕是行动的邀请，不写「暂无数据」孤句） */
function ChartEmpty({ icon, title, hint, height = 240 }: { icon: ReactNode; title: string; hint: string; height?: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center" style={{ height }}>
      <span className="text-muted/50">{icon}</span>
      <p className="text-sm text-muted">{title}</p>
      <p className="max-w-xs text-xs text-muted/70">{hint}</p>
    </div>
  );
}

/** 拉取失败态：绝不能沿用空态文案——那会把「请求失败」说成「本来就没有数据」 */
function ChartFailed({ height = 240 }: { height?: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center" style={{ height }}>
      <TriangleAlert className="h-6 w-6 text-danger/70" strokeWidth={1.5} />
      <p className="text-sm text-muted">数据加载失败</p>
      <p className="max-w-xs text-xs text-muted/70">点上方横幅的「重试」重新获取。</p>
    </div>
  );
}

export default function DashboardTab() {
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [distribution, setDistribution] = useState<DistributionItem[]>([]);
  const [compare, setCompare] = useState<CompareItem[]>([]);
  const [trendDays, setTrendDays] = useState(30);
  const [firstLoading, setFirstLoading] = useState(true);
  const [trendPending, setTrendPending] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [errors, setErrors] = useState({ trends: false, distribution: false, compare: false });
  const loadError = errors.trends || errors.distribution || errors.compare;

  // 三个数据源各自记在途与失败：切换天数只重取趋势，若共用一个 loading，整块组件会退回
  // 「加载中」再重建（观感等同整页刷新），失败标记也会互相覆盖
  const trendRequest = useRef(0);
  const fetchTrends = useCallback(async (days: number) => {
    const request = ++trendRequest.current;
    setTrendPending(true);
    try {
      const res = await fetch(`/api/manage/stats/trends?days=${days}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // 连点天数会并发多个请求，晚到的旧窗口结果必须丢弃，否则图上曲线与选中的天数不一致
      if (request !== trendRequest.current) return;
      setTrends(data);
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
    Promise.all([fetchTrends(trendDays), fetchDistribution(), fetchCompare()]).then(() =>
      setFirstLoading(false)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首屏，用默认天数
  }, []);

  // 天数变化只重取趋势；首屏那次已由上面的 effect 拉过，故跳过本 effect 的首次运行
  const trendsLoaded = useRef(false);
  useEffect(() => {
    if (!trendsLoaded.current) {
      trendsLoaded.current = true;
      return;
    }
    fetchTrends(trendDays);
  }, [trendDays, fetchTrends]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 重试：只重取失败/过期的数据源，已在屏的数据不动
  const reload = () => {
    fetchTrends(trendDays);
    fetchDistribution();
    fetchCompare();
  };

  // 在册 / 已提交 / 未提交 / 提交率：由已拉取的 compare 求和，口径与「数据概览」的总提交数同源
  const totals = useMemo(() => {
    const enrolled = compare.reduce((sum, c) => sum + c.total, 0);
    const submitted = compare.reduce((sum, c) => sum + c.submitted, 0);
    return {
      enrolled,
      submitted,
      unsubmitted: Math.max(0, enrolled - submitted),
      rateText: formatRateText(submitted, enrolled, 1),
    };
  }, [compare]);

  // 点名册条：每人一格，每 10 格断一栏（花名册分栏）；超上限退化为比例轨（见 ROSTER_MARK_CAP）
  const rosterGroups = useMemo(() => {
    if (totals.enrolled > ROSTER_MARK_CAP) return [];
    const groups: boolean[][] = [];
    for (let start = 0; start < totals.enrolled; start += 10) {
      const size = Math.min(10, totals.enrolled - start);
      groups.push(Array.from({ length: size }, (_, k) => start + k < totals.submitted));
    }
    return groups;
  }, [totals.enrolled, totals.submitted]);
  const tickStep = Math.min(6, Math.round(400 / Math.max(1, totals.enrolled)));

  // 对比图：拆出未提交段以便堆叠，提交率作柱顶标签；「未分班」排末尾（与班级概览行序一致）
  const compareChart = useMemo(
    () =>
      [...compare]
        .sort((a, b) => Number(a.key === "未分班") - Number(b.key === "未分班"))
        .map((item) => ({
          key: item.key,
          submitted: item.submitted,
          unsubmitted: Math.max(0, item.total - item.submitted),
          rateLabel: formatRateText(item.submitted, item.total, 1),
        })),
    [compare]
  );

  // 标签分布：按次数降序 + 语义配色，列表即图例，不再依赖扇区外挂标签
  const distChart = useMemo(() => {
    let fallbackIndex = 0;
    return [...distribution]
      .sort((a, b) => b.count - a.count)
      .map((item) => ({
        ...item,
        color:
          TAG_COLORS[item.category] ??
          FALLBACK_COLORS[fallbackIndex++ % FALLBACK_COLORS.length],
      }));
  }, [distribution]);
  const tagTotal = distChart.reduce((sum, d) => sum + d.count, 0);
  const tagMax = distChart[0]?.count ?? 1;
  // 环形图与右侧列表共用的悬停读数：图上去掉 Tooltip 后，单维度数值由中心固定显示
  const activeDist = distChart.find((d) => d.category === activeTag) ?? null;

  const trendTotal = trends.reduce((sum, t) => sum + t.count, 0);

  if (firstLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>加载中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-600 dark:text-red-400">部分数据加载失败，图表可能不完整</p>
          <button
            onClick={reload}
            className="rounded-lg bg-danger px-3 py-1 text-sm text-white transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            重试
          </button>
        </div>
      )}

      {/* 提交进度大屏：在册学生即主体，每人一格 */}
      <section className="overflow-hidden rounded-2xl shadow-lg" style={{ backgroundImage: HERO_FACE }}>
        <div className="px-6 py-6 sm:px-8 sm:py-7">
          <p className="text-[11px] font-medium tracking-[0.2em] text-emerald-100/85">全校提交进度</p>

          {totals.enrolled === 0 ? (
            errors.compare ? (
              <p className="mt-6 text-sm text-amber-200">提交进度加载失败，点上方横幅的「重试」重新获取。</p>
            ) : (
              <p className="mt-6 text-sm text-emerald-100/90">
                还没有在册学生，导入学生名单后这里会显示提交进度。
              </p>
            )
          ) : (
            <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                <div>
                  <p className="font-mono text-5xl font-bold leading-none tabular-nums text-white">
                    {totals.submitted}
                    <span className="ml-2 text-2xl font-medium text-emerald-200/80">
                      / {totals.enrolled}
                    </span>
                  </p>
                  <p className="mt-2 text-xs text-emerald-100/85">已提交 / 在册</p>
                </div>
                <div>
                  <p className="font-mono text-4xl font-bold leading-none tabular-nums text-white">
                    {totals.rateText}
                  </p>
                  <p className="mt-2 text-xs text-emerald-100/85">提交率</p>
                </div>
              </div>

              <div className="lg:max-w-[50%]">
                {totals.enrolled > ROSTER_MARK_CAP ? (
                  <div
                    role="img"
                    aria-label={`已提交 ${totals.submitted} 人，在册 ${totals.enrolled} 人，未提交 ${totals.unsubmitted} 人`}
                    className="h-4 w-full overflow-hidden rounded-sm bg-amber-400/15"
                  >
                    <div
                      className="h-full bg-emerald-300/90"
                      style={{ width: `${(totals.submitted / totals.enrolled) * 100}%` }}
                    />
                  </div>
                ) : (
                  <div
                    role="img"
                    aria-label={`已提交 ${totals.submitted} 人，在册 ${totals.enrolled} 人，未提交 ${totals.unsubmitted} 人`}
                    className="flex flex-wrap gap-x-3 gap-y-1.5"
                  >
                    {rosterGroups.map((group, gi) => (
                      <span key={gi} className="inline-flex gap-[3px]">
                        {group.map((filled, i) => (
                          <span
                            key={i}
                            className={`h-4 w-[5px] rounded-[1px] animate-[roster-tick_0.3s_ease-out_both] ${
                              filled
                                ? "bg-emerald-300/90"
                                : "border border-amber-300/60 bg-amber-400/10"
                            }`}
                            style={{ animationDelay: `${(gi * 10 + i) * tickStep}ms` }}
                          />
                        ))}
                      </span>
                    ))}
                  </div>
                )}
                {totals.unsubmitted > 0 ? (
                  <p className="mt-3 text-xs font-medium text-amber-300">
                    还差 {totals.unsubmitted} 人未提交
                  </p>
                ) : (
                  <p className="mt-3 text-xs font-medium text-emerald-200">全员已提交</p>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* 提交趋势 */}
        <div className="rounded-xl border border-border-soft bg-card p-5 lg:col-span-7">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium tracking-[0.2em] text-muted">时间窗口</p>
              <h3 className="mt-1 text-sm font-semibold text-foreground">提交趋势（单位：人数）</h3>
            </div>
            <div className="flex items-center gap-2">
              {trendPending && (
                <span role="status" className="flex items-center gap-1 text-[11px] text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  更新中
                </span>
              )}
              <Segmented
                label="趋势天数"
                options={DAY_OPTIONS.map((d) => ({ value: d, label: `${d}天` }))}
                value={trendDays}
                onChange={setTrendDays}
              />
            </div>
          </div>
          <div className="text-muted" aria-busy={trendPending}>
            {/* 失败态要压过旧数据：天数变了以后，留在屏上的上一窗口曲线与选中的天数并不对应；
                补零后长度恒等于 trendDays，故空态判据是「窗口内是否有提交」而非数组长度 */}
            {errors.trends ? (
              <ChartFailed />
            ) : trends.some((t) => t.count > 0) ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={trends} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="dashTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={DATA_GREEN} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={DATA_GREEN} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.14} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fontFamily: MONO, fill: "currentColor" }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fontFamily: MONO, fill: "currentColor" }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    width={32}
                  />
                  <Tooltip
                    cursor={{ stroke: "currentColor", strokeOpacity: 0.25 }}
                    content={(p) => <ChartTooltip {...p} unit=" 人" name="提交人数" labelPrefix="日期 " />}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke={DATA_GREEN}
                    strokeWidth={2}
                    fill="url(#dashTrendFill)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty
                icon={<TrendingUp className="h-6 w-6" strokeWidth={1.5} />}
                title="所选窗口内还没有提交记录"
                hint="把趋势天数调大一些，或确认学生是否已开始填写档案。"
              />
            )}
          </div>
          <p className="mt-3 border-t border-border-soft pt-3 text-xs text-muted">
            {errors.trends ? (
              "趋势数据加载失败，暂不显示本窗口合计"
            ) : (
              <>
                近 {trendDays} 天共{" "}
                <span className="font-mono tabular-nums text-foreground">{trendTotal}</span> 人提交
              </>
            )}
          </p>
        </div>

        {/* 标签分类分布 */}
        <div className="rounded-xl border border-border-soft bg-card p-5 lg:col-span-5">
          <div className="mb-4">
            <p className="text-[11px] font-medium tracking-[0.2em] text-muted">标签维度</p>
            <h3 className="mt-1 text-sm font-semibold text-foreground">标签分类分布（单位：标签次数）</h3>
          </div>
          {distChart.length > 0 ? (
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <div
                className="relative h-[168px] w-[168px] flex-shrink-0 text-muted"
                onMouseLeave={() => setActiveTag(null)}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    {/* 不给环形图挂 Tooltip：recharts 的饼图 Tooltip 锚在每个扇区的中点上，
                        跨扇区时会一跳一跳；数值本来就在右侧列表里，改为悬停时中心固定读数 */}
                    <Pie
                      data={distChart}
                      dataKey="count"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={78}
                      paddingAngle={2}
                      stroke="none"
                      onMouseEnter={(_, index) => setActiveTag(distChart[index]?.category ?? null)}
                    >
                      {distChart.map((item) => (
                        <Cell
                          key={item.category}
                          fill={item.color}
                          fillOpacity={activeTag && activeTag !== item.category ? 0.3 : 1}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-2xl font-bold tabular-nums text-foreground">
                    {activeDist ? activeDist.count : tagTotal}
                  </span>
                  <span className="max-w-[92px] truncate text-[11px] text-muted" title={activeDist?.category}>
                    {activeDist ? activeDist.category : "标签次数"}
                  </span>
                </div>
              </div>
              <ul className="w-full min-w-0 flex-1 space-y-1" onMouseLeave={() => setActiveTag(null)}>
                {distChart.map((item) => (
                  <li
                    key={item.category}
                    onMouseEnter={() => setActiveTag(item.category)}
                    className={`flex items-center gap-2 rounded-md px-1 py-0.5 text-xs transition-colors ${
                      activeTag === item.category ? "bg-gray-100 dark:bg-gray-800" : ""
                    }`}
                  >
                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: item.color }} />
                    <span className="w-14 flex-shrink-0 truncate text-foreground" title={item.category}>
                      {item.category}
                    </span>
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${(item.count / tagMax) * 100}%`, background: item.color }}
                      />
                    </span>
                    <span className="w-8 flex-shrink-0 text-right font-mono tabular-nums text-muted">
                      {item.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : errors.distribution ? (
            <ChartFailed height={168} />
          ) : (
            <ChartEmpty
              height={168}
              icon={<PieChartIcon className="h-6 w-6" strokeWidth={1.5} />}
              title="还没有标签数据"
              hint="学生提交档案后，这里会按兴趣 / 技能 / 性格等维度汇总标签次数。"
            />
          )}
        </div>

        {/* 对比 */}
        <div className="rounded-xl border border-border-soft bg-card p-5 lg:col-span-12">
          <div className="mb-3">
            <p className="text-[11px] font-medium tracking-[0.2em] text-muted">分组对比</p>
            <h3 className="mt-1 text-sm font-semibold text-foreground">
              班级对比（单位：人数，柱高 = 总人数）
            </h3>
          </div>
          {compareChart.length > 0 ? (
            <div className="text-muted">
              <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DATA_GREEN }} />
                  已提交
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-current opacity-20" />
                  未提交
                </span>
                <span className="text-muted/70">柱顶为该组提交率</span>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={compareChart} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.14} />
                  <XAxis
                    dataKey="key"
                    tick={{ fontSize: 11, fill: "currentColor" }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={8}
                    tickFormatter={(v: string) => (v.length > 6 ? `${v.slice(0, 6)}…` : v)}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fontFamily: MONO, fill: "currentColor" }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    width={32}
                  />
                  <Tooltip
                    cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
                    content={(p) => (
                      <ChartTooltip
                        {...p}
                        unit=" 人"
                        extra={(rows) => {
                          const picked = (key: string) =>
                            Number(rows.find((r) => String(r.dataKey) === key)?.value ?? 0);
                          const submitted = picked("submitted");
                          const unsubmitted = picked("unsubmitted");
                          return `在册 ${submitted + unsubmitted} 人 · 提交率 ${formatRateText(submitted, submitted + unsubmitted, 1)}`;
                        }}
                      />
                    )}
                  />
                  <Bar dataKey="submitted" name="已提交" stackId="total" fill={DATA_GREEN} />
                  {/* 标签挂在「未提交」段：柱顶即堆叠顶。minPointSize=1 是必需的——recharts 会在渲染前
                      丢弃零尺寸柱（Bar.js 的 `height === 0` 过滤），全班已提交时该段高度为 0，
                      标签连渲染机会都没有；给 1px 让它留下，肉眼仍是「没有这一段」 */}
                  <Bar
                    dataKey="unsubmitted"
                    name="未提交"
                    stackId="total"
                    fill="currentColor"
                    fillOpacity={0.14}
                    minPointSize={1}
                    radius={[3, 3, 0, 0]}
                  >
                    <LabelList
                      dataKey="rateLabel"
                      position="top"
                      fontSize={11}
                      fontFamily={MONO}
                      fill="currentColor"
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : errors.compare ? (
            <ChartFailed height={300} />
          ) : (
            <ChartEmpty
              height={300}
              icon={<BarChart3 className="h-6 w-6" strokeWidth={1.5} />}
              title="还没有在册学生"
              hint="先在「班级管理」与「学生名单」中建立班级并导入学生，这里就能看到各组提交对比。"
            />
          )}
        </div>
      </div>
    </div>
  );
}
