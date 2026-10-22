"use client";

import { useState, useMemo, type ReactNode } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
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
  LabelList,
} from "recharts";
import { Loader2, TrendingUp, PieChart as PieChartIcon, BarChart3, TriangleAlert } from "lucide-react";
import { formatRateText } from "@/lib/stats-utils";
import { isUnassignedClassKey } from "@/lib/class-identity";
import type { DashboardCopy } from "@/lib/dashboard-copy";
import { computeTrendTotal, type TrendView } from "@/lib/dashboard-trend";
import {
  ROSTER_MARK_CAP,
  buildClassSeries,
  type CompareItem,
  type computeDashboardTotals,
  type DistributionItem,
} from "@/lib/dashboard-utils";

type DashboardTotals = ReturnType<typeof computeDashboardTotals>;

/** 数据绿：与品牌深翡翠同族，两种主题下都够对比（容器底为白/暗卡片） */
export const DATA_GREEN = "#059669";
/** 大屏面板：固定深翡翠渐变，不随主题翻转，故面板内的前景色也固定（浅色下避开发灰的绿） */
export const HERO_FACE = "linear-gradient(135deg, #065f46 0%, #064e3b 100%)";
/** 等宽栈与 globals.css 的 --font-mono 一致；SVG 属性不接受 var()，故写字面量 */
export const MONO = "ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace";

/** 标签三维度按名称取语义色（与 --tag-* 同值），其余类别按 ui-conventions「>3 类循环取色」 */
export const TAG_COLORS: Record<string, string> = {
  兴趣: "#059669",
  技能: "#0284c7",
  性格: "#f59e0b",
};
export const FALLBACK_COLORS = ["#8b5cf6", "#0d9488", "#94a3b8", "#64748b"];
/** 分班多序列配色：8 色循环，两种主题下都够对比 */
export const SERIES_COLORS = ["#059669", "#0284c7", "#f59e0b", "#8b5cf6", "#e11d48", "#0d9488", "#7c3aed", "#b45309"];

export const DAY_OPTIONS = [7, 14, 30, 60] as const;

/** 趋势分组的取值：全校合计（面积图）与按班级分层（多序列折线）共用同一个时间窗口。
    按钮文字取自文案表——教师侧的按钮要和「怎么看（全校 · 分班级）」用同一个词 */
export const TREND_GROUP_VALUES = ["total", "class"] as const;

/** recharts 的 payload 条目类型较宽（name/dataKey 可为 string|number，dataKey 还可能是函数），
    这里只取本页图表用到的字段，取值时统一转字符串 */
export interface TooltipRow {
  name?: string | number;
  value?: unknown;
  color?: string;
  fill?: string;
  dataKey?: unknown;
}

export interface ChartTooltipProps {
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
export function ChartTooltip({ active, payload, label, unit = "", name, labelPrefix = "", extra }: ChartTooltipProps) {
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

export function Segmented<T extends string | number>({
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
export function ChartEmpty({ icon, title, hint, height = 240 }: { icon: ReactNode; title: string; hint: string; height?: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center" style={{ height }}>
      <span className="text-muted/50">{icon}</span>
      <p className="text-sm text-muted">{title}</p>
      <p className="max-w-xs text-xs text-muted/70">{hint}</p>
    </div>
  );
}

/** 拉取失败态：绝不能沿用空态文案——那会把「请求失败」说成「本来就没有数据」 */
export function ChartFailed({ height = 240, copy }: { height?: number; copy: DashboardCopy }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center" style={{ height }}>
      <TriangleAlert className="h-6 w-6 text-danger/70" strokeWidth={1.5} />
      <p className="text-sm text-muted">{copy.chartFailedTitle}</p>
      <p className="max-w-xs text-xs text-muted/70">{copy.chartFailedHint}</p>
    </div>
  );
}

/** 首次取数态：与空态同样不能混用——「还没到」和「确实没有」是两件事 */
export function ChartLoading({ height = 240, hint }: { height?: number; hint: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-2 text-center"
      style={{ height }}
    >
      <Loader2 className="h-5 w-5 animate-spin text-muted/60" />
      <p className="text-xs text-muted/70">{hint}</p>
    </div>
  );
}

/** 提交进度大屏：在册学生即主体，每人一格 */
export function SubmissionHero({
  totals,
  rosterGroups,
  tickStep,
  caption,
  compareFailed,
  copy,
}: {
  totals: DashboardTotals;
  rosterGroups: boolean[][];
  tickStep: number;
  caption: string;
  compareFailed: boolean;
  copy: DashboardCopy;
}) {
  const ariaTotals = copy.heroAriaTotals(totals.submitted, totals.enrolled, totals.unsubmitted);

  return (
    <section className="overflow-hidden rounded-2xl shadow-lg" style={{ backgroundImage: HERO_FACE }}>
      <div className="px-6 py-6 sm:px-8 sm:py-7">
        <p className="text-[11px] font-medium tracking-[0.2em] text-emerald-100/85">{caption}</p>

        {totals.enrolled === 0 ? (
          compareFailed ? (
            <p className="mt-6 text-sm text-amber-200">{copy.heroProgressFailed}</p>
          ) : (
            <p className="mt-6 text-sm text-emerald-100/90">{copy.heroNoStudents}</p>
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
                <p className="mt-2 text-xs text-emerald-100/85">{copy.heroSubmittedOfTotal}</p>
              </div>
              <div>
                <p className="font-mono text-4xl font-bold leading-none tabular-nums text-white">
                  {totals.rateText}
                </p>
                <p className="mt-2 text-xs text-emerald-100/85">{copy.heroRateLabel}</p>
              </div>
            </div>

            <div className="lg:max-w-[50%]">
              {totals.enrolled > ROSTER_MARK_CAP ? (
                <div
                  role="img"
                  aria-label={ariaTotals}
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
                  aria-label={ariaTotals}
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
                  {copy.heroMissing(totals.unsubmitted)}
                </p>
              ) : (
                <p className="mt-3 text-xs font-medium text-emerald-200">{copy.heroAllSubmitted}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** 提交趋势卡：天数与分组仅作用于本图，另外两块图恒定全量（#165 验收第三条） */
export function TrendCard({
  trendView,
  trendDays,
  trendGroup,
  setTrendDays,
  setTrendGroup,
  trendPending,
  trendsFailed,
  copy,
}: {
  trendView: TrendView;
  trendDays: number;
  trendGroup: "total" | "class";
  setTrendDays: (days: number) => void;
  setTrendGroup: (group: "total" | "class") => void;
  trendPending: boolean;
  trendsFailed: boolean;
  copy: DashboardCopy;
}) {
  /**
   * 只认与当前（天数, 分组）完全匹配的那一份（#262）：切口径的在途期屏上是加载态，
   * 不是上一窗口的曲线配上「近 7 天」这类错配；命中缓存的组合则直接画出来，不闪。
   */
  const entry = trendView.status === "ready" ? trendView.entry : null;
  const trends = entry?.group === "total" ? entry.trends : [];
  const classTrend = entry?.group === "class" ? entry.classTrend : null;

  // 分班多序列：按 series 顺序生成 s0... 位置字段，班名不直接当图表字段
  const classGroups = classTrend?.series ?? [];
  const classSeries = useMemo(
    () => buildClassSeries(classTrend?.series ?? [], classTrend?.points ?? []),
    [classTrend]
  );
  const classTrendHasData = classGroups.some((group) =>
    (classTrend?.points ?? []).some((p) => (p.counts[group.key] ?? 0) > 0)
  );

  /** 趋势图：全校合计画面积图，按班级画多序列折线 + 自绘图例（recharts 自带图例的暗色文字不可控） */
  const renderTrendChart = () => {
    if (trendView.status === "loading") {
      return (
        <ChartLoading hint={trendGroup === "class" ? copy.trendLoadingByClass : copy.trendLoadingTotal} />
      );
    }
    if (trendGroup === "class") {
      // 空态判据是「窗口内是否有提交」而非数组长度：补零后点数恒等于 trendDays
      if (!classTrendHasData) {
        return (
          <ChartEmpty
            icon={<TrendingUp className="h-6 w-6" strokeWidth={1.5} />}
            title={copy.trendEmptyTitle}
            hint={copy.trendEmptyHint}
          />
        );
      }
      return (
        <>
          <ul className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            {classGroups.map((group, i) => (
              <li key={group.key} className="inline-flex items-center gap-1.5">
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
                />
                {copy.classLabel(group.key, group.label)}
              </li>
            ))}
          </ul>
          {/* 高度 220 + 图例约 20，与合计模式（240）的卡片高度对齐 */}
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={classSeries} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
                content={(p) => (
                  <ChartTooltip {...p} unit={copy.tooltipPeopleUnit} labelPrefix={copy.tooltipDatePrefix} />
                )}
              />
              {classGroups.map((group, i) => (
                <Line
                  key={group.key}
                  type="monotone"
                  dataKey={`s${i}`}
                  name={copy.classLabel(group.key, group.label)}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      );
    }
    if (!trends.some((t) => t.count > 0)) {
      return (
        <ChartEmpty
          icon={<TrendingUp className="h-6 w-6" strokeWidth={1.5} />}
          title={copy.trendEmptyTitle}
          hint={copy.trendEmptyHint}
        />
      );
    }
    return (
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
            content={(p) => (
              <ChartTooltip
                {...p}
                unit={copy.tooltipPeopleUnit}
                name={copy.trendTooltipSeriesName}
                labelPrefix={copy.tooltipDatePrefix}
              />
            )}
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
    );
  };

  return (
    <div className="rounded-xl border border-border-soft bg-card p-5 lg:col-span-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-[0.2em] text-muted">
            {copy.trendEyebrow(trendDays, trendGroup === "class")}
          </p>
          <h3 className="mt-1 text-sm font-semibold text-foreground">{copy.trendTitle(trendGroup === "class")}</h3>
          {/* 作用域写在这里：天数与分组只重取本图，另外两块图恒定全量（#165 验收第三条） */}
          <p className="mt-0.5 text-[11px] text-muted/70">{copy.trendScopeNote}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {trendPending && trendView.status === "ready" && (
            <span role="status" className="flex items-center gap-1 text-[11px] text-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              {copy.trendPendingNote}
            </span>
          )}
          <Segmented
            label={copy.trendGroupAriaLabel}
            options={TREND_GROUP_VALUES.map((value) => ({
              value,
              label: value === "class" ? copy.trendGroupClassLabel : copy.trendGroupTotalLabel,
            }))}
            value={trendGroup}
            onChange={setTrendGroup}
          />
          <Segmented
            label={copy.trendDaysAriaLabel}
            options={DAY_OPTIONS.map((d) => ({ value: d, label: copy.trendDaysOptionLabel(d) }))}
            value={trendDays}
            onChange={setTrendDays}
          />
        </div>
      </div>
      <div className="text-muted" aria-busy={trendPending}>
        {/* 失败态压过取数视图（#262）：图上与卡底合计都只认与当前选择匹配的那一份，
            因此剩下的两种屏幕是「这一组选择取回来了但没有提交」与「这一组选择取失败了」 */}
        {trendsFailed ? <ChartFailed copy={copy} /> : renderTrendChart()}
      </div>
      <p className="mt-3 border-t border-border-soft pt-3 text-xs text-muted">
        {trendsFailed ? (
          copy.trendFailedSummary
        ) : !entry ? (
          copy.trendSummaryLoading
        ) : (
          <>
            {copy.trendSummaryPrefix(trendDays)}
            <span className="font-mono tabular-nums text-foreground">{computeTrendTotal(entry)}</span>
            {copy.trendSummarySuffix}
          </>
        )}
      </p>
    </div>
  );
}

/** 标签分类分布卡：环形图与右侧列表共用的悬停读数，交互自闭合在卡内 */
export function DistributionCard({
  distribution,
  distributionFailed,
  copy,
}: {
  distribution: DistributionItem[];
  distributionFailed: boolean;
  copy: DashboardCopy;
}) {
  const [activeTag, setActiveTag] = useState<string | null>(null);

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

  return (
    <div className="rounded-xl border border-border-soft bg-card p-5 lg:col-span-5">
      <div className="mb-4">
        <p className="text-[11px] font-medium tracking-[0.2em] text-muted">{copy.distEyebrow}</p>
        <h3 className="mt-1 text-sm font-semibold text-foreground">{copy.distTitle}</h3>
        <p className="mt-0.5 text-[11px] text-muted/70">{copy.fullScopeNote}</p>
      </div>
      {/* 与趋势卡刻意相反：这块与对比图都没有会影响口径的控件，重取失败时留在屏上的旧图仍然成立，
          换成失败态反而丢掉有用信息；失败与否由顶部横幅「部分数据加载失败」负责说明。
          故这里的判据是「屏上有没有数据」在前，失败态只兜住「从未取到数据」 */}
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
                {activeDist ? activeDist.category : copy.distCenterLabel}
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
      ) : distributionFailed ? (
        <ChartFailed height={168} copy={copy} />
      ) : (
        <ChartEmpty
          height={168}
          icon={<PieChartIcon className="h-6 w-6" strokeWidth={1.5} />}
          title={copy.distEmptyTitle}
          hint={copy.distEmptyHint}
        />
      )}
    </div>
  );
}

/** 班级对比卡：堆叠柱状图，柱顶为该组提交率 */
export function CompareCard({
  compare,
  compareFailed,
  copy,
}: {
  compare: CompareItem[];
  compareFailed: boolean;
  copy: DashboardCopy;
}) {
  // 对比图：拆出未提交段以便堆叠，提交率作柱顶标签；未分班哨兵排末尾（与班级概览行序一致）
  // `label` 是展示名：X 轴与 tooltip 都用它，否则轴上是「还没分班」、悬停读数是「未分班」，
  // 同一组两个名字（#242 评审 P2）。排序仍按身份键进行。
  const compareChart = useMemo(
    () =>
      [...compare]
        .sort((a, b) => Number(isUnassignedClassKey(a.key)) - Number(isUnassignedClassKey(b.key)))
        .map((item) => ({
          label: copy.classLabel(item.key, item.label),
          submitted: item.submitted,
          unsubmitted: Math.max(0, item.total - item.submitted),
          rateLabel: formatRateText(item.submitted, item.total, 1),
        })),
    [compare, copy]
  );

  return (
    <div className="rounded-xl border border-border-soft bg-card p-5 lg:col-span-12">
      <div className="mb-3">
        <p className="text-[11px] font-medium tracking-[0.2em] text-muted">{copy.compareEyebrow}</p>
        <h3 className="mt-1 text-sm font-semibold text-foreground">{copy.compareTitle}</h3>
        <p className="mt-0.5 text-[11px] text-muted/70">{copy.fullScopeNote}</p>
      </div>
      {/* 保留旧图、失败态只兜「从未取到数据」：理由同标签分布卡的注释 */}
      {compareChart.length > 0 ? (
        <div className="text-muted">
          <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DATA_GREEN }} />
              {copy.compareLegendSubmitted}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-current opacity-20" />
              {copy.compareLegendUnsubmitted}
            </span>
            <span className="text-muted/70">{copy.compareRateNote}</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={compareChart} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.14} />
              <XAxis
                dataKey="label"
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
                    unit={copy.tooltipPeopleUnit}
                    extra={(rows) => {
                      const picked = (key: string) =>
                        Number(rows.find((r) => String(r.dataKey) === key)?.value ?? 0);
                      const submitted = picked("submitted");
                      const unsubmitted = picked("unsubmitted");
                      return copy.compareTooltipTotals(submitted + unsubmitted, formatRateText(submitted, submitted + unsubmitted, 1));
                    }}
                  />
                )}
              />
              <Bar dataKey="submitted" name={copy.compareLegendSubmitted} stackId="total" fill={DATA_GREEN} />
              {/* 标签挂在「未提交」段：柱顶即堆叠顶。minPointSize=1 是必需的——recharts 会在渲染前
                  丢弃零尺寸柱（Bar.js 的 `height === 0` 过滤），全班已提交时该段高度为 0，
                  标签连渲染机会都没有；给 1px 让它留下，肉眼仍是「没有这一段」 */}
              <Bar
                dataKey="unsubmitted"
                name={copy.compareLegendUnsubmitted}
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
      ) : compareFailed ? (
        <ChartFailed height={300} copy={copy} />
      ) : (
        <ChartEmpty
          height={300}
          icon={<BarChart3 className="h-6 w-6" strokeWidth={1.5} />}
          title={copy.compareEmptyTitle}
          hint={copy.compareEmptyHint}
        />
      )}
    </div>
  );
}
