"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import CollapsibleCard from "./CollapsibleCard";
import ChartLoadingPlaceholder from "./ChartLoadingPlaceholder";
import { chartAriaLabel } from "@/lib/profile-ui";

/**
 * 雷达图按需加载（#324）：折叠卡展开前不下载 recharts；`ssr:false` 因为图表依赖容器宽度。
 * 折叠卡收起时子内容不挂载，因此这里的 dynamic 只在展开后触发。
 */
const ScoreRadarChart = dynamic(() => import("./ScoreRadarChart"), {
  ssr: false,
  loading: () => <ChartLoadingPlaceholder />,
});
import { formatResultTime } from "@/lib/assessment-flow";
import {
  buildBigFiveBars,
  buildBigFiveHeadline,
  buildBigFiveInterpretations,
  buildRadarPoints,
  buildResultTrailing,
  type AssessmentResultsPayload,
} from "@/lib/assessment-view";

/** 答题页入口：重测 / 继续作答都要带上本量表的 code（#289 起答题页按 `?code=` 取量表） */
const QUIZ_HREF = "/dashboard/student/assessment/quiz";

/**
 * 五大人格结果卡（#292 + #322）：**只在 dimensional 量表上渲染**（由 `AssessmentResultCard` 在入口分流）。
 *
 * 构成与霍兰德卡平级但内容不同：画像标签（最高两维）→ 五维雷达 + 条形排名（标「主要特质」）→
 * 逐维高 / 低分解读 → 页尾合规指针。大五没有三字码、也没有职业推荐，
 * 所以这里不 import 任何 RIASEC 视图函数（E/A/C 同名不同义，混用会把外向性画成企业型）。
 */
export default function FiveFactorResultCard({
  data,
  code,
  id,
  open,
  onOpenChange,
  highlight = false,
}: {
  data: AssessmentResultsPayload;
  code: string;
  /** 页面锚点（#323：速览卡定位到这里） */
  id?: string;
  /** 受控展开（#323）；不传则由折叠卡自管 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 被摘要卡定位时短暂高亮（#323） */
  highlight?: boolean;
}) {
  const current = data.current;
  // 父组件只在有当前结果时渲染本卡；这里仅做类型收窄
  if (!current) return null;

  const dimensions = data.assessment.dimensions;
  const bars = buildBigFiveBars(current.scores, dimensions);
  const interpretations = buildBigFiveInterpretations(current.scores, dimensions);
  const headline = buildBigFiveHeadline(current.scores, dimensions);
  const points = buildRadarPoints(current.scores, dimensions);
  const trailing = buildResultTrailing({
    questionCount: current.questionCount,
    completedAt: formatResultTime(current.completedAt),
    historyCount: data.history.length,
  });

  return (
    <CollapsibleCard
      id={id}
      title={data.assessment.name}
      status="completed"
      subtitle={trailing}
      open={open}
      onOpenChange={onOpenChange}
      highlight={highlight}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="bg-brand rounded-xl px-4 py-3 text-white">
          <p className="text-[11px] text-white/70">你的主要特质</p>
          <p className="mt-1 text-lg sm:text-xl font-extrabold tracking-wide">{headline || "—"}</p>
        </div>
        <Link
          href={`${QUIZ_HREF}?code=${encodeURIComponent(code)}`}
          className="inline-flex items-center justify-center px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition-colors flex-shrink-0"
        >
          {data.inProgress ? "继续作答" : "重新测评"}
        </Link>
      </div>

      {/* 两种视图并列：雷达看整体形状，条状排名看具体高低；窄屏上下堆叠 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <ScoreRadarChart
            points={points}
            seriesName="人格得分"
            // #324：读屏可读到每一维分数（图形本身对读屏不可见）
            ariaLabel={chartAriaLabel("五大人格得分雷达图", points)}
          />
        </div>
        <ul className="min-w-0 space-y-2.5" aria-label="五大人格得分排名">
          {bars.map((bar) => (
            <li key={bar.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-foreground">
                  {bar.label}
                  {bar.isPrimary && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400">
                      主要特质
                    </span>
                  )}
                </span>
                <span className="text-muted font-mono text-xs">{bar.standard.toFixed(1)}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${bar.percent}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">逐维解读</h3>
        <ul className="space-y-2">
          {interpretations.map((item) => (
            <li key={item.key} className="rounded-lg bg-background px-3 py-2">
              <p className="text-sm font-medium text-foreground">
                {item.label}
                <span className="ml-1.5 text-xs text-muted">{item.level === "high" ? "偏高" : "偏低"}</span>
                {item.isPrimary && <span className="ml-1.5 text-xs text-muted">主要特质</span>}
              </p>
              <p className="mt-0.5 text-xs text-muted leading-relaxed">{item.text}</p>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        本测评的署名、授权与免责声明见页尾
        <a
          href="#assessment-attribution"
          className="ml-1 text-primary-strong underline underline-offset-2 hover:no-underline"
        >
          「关于这些测评」
        </a>
        。
      </p>
    </CollapsibleCard>
  );
}
