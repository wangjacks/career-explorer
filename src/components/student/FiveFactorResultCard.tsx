"use client";

import Link from "next/link";
import ProfileSectionHeader from "./ProfileSectionHeader";
import ScoreRadarChart from "./ScoreRadarChart";
import AssessmentDisclaimer from "./assessment/AssessmentDisclaimer";
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
 * 五大人格结果卡（#292）：**只在 dimensional 量表上渲染**（由 `AssessmentResultCard` 在入口分流）。
 *
 * 构成与霍兰德卡平级但内容不同：画像标签（最高两维）→ 五维雷达 + 条形排名（标「主要特质」）→
 * 逐维高 / 低分解读 → 免责声明与署名。大五没有三字码、也没有职业推荐，
 * 所以这里不 import 任何 RIASEC 视图函数（E/A/C 同名不同义，混用会把外向性画成企业型）。
 */
export default function FiveFactorResultCard({
  data,
  code,
}: {
  data: AssessmentResultsPayload;
  code: string;
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
    completedAt: current.completedAt,
    historyCount: data.history.length,
  });

  return (
    <section className="bg-card rounded-xl border border-border-soft p-5 space-y-5">
      <ProfileSectionHeader label={data.assessment.name} trailing={<span className="text-xs text-muted">{trailing}</span>} />

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

      {/* 两种视图并列：雷达看整体形状，条状排名看具体高低 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border-soft px-2 py-1">
          <ScoreRadarChart points={points} seriesName="人格得分" ariaLabel="五大人格得分雷达图" />
        </div>
        <ul className="space-y-2.5" aria-label="五大人格得分排名">
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

      {/* 署名 / 授权 / 免责：与霍兰德卡同一个组件与同一份接口文案，保证口径一致 */}
      <AssessmentDisclaimer text={data.assessment.disclaimer} variant="inline" />
      {data.assessment.attribution && (
        <p className="text-[11px] text-muted/80 leading-relaxed">{data.assessment.attribution}</p>
      )}
      {data.assessment.licenseText && (
        <p className="text-[11px] text-muted/80 leading-relaxed">{data.assessment.licenseText}</p>
      )}
    </section>
  );
}
