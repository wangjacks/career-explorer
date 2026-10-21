"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Compass } from "lucide-react";
import ProfileSectionHeader from "./ProfileSectionHeader";
import HollandCodeBadge from "./HollandCodeBadge";
import RiasecRadarChart from "./RiasecRadarChart";
import FiveFactorResultCard from "./FiveFactorResultCard";
import AssessmentDisclaimer from "./assessment/AssessmentDisclaimer";
import { formatResultTime } from "@/lib/assessment-flow";
import { deriveAssessmentCenter } from "@/lib/assessment-center";
import {
  buildCareerCards,
  buildResultTrailing,
  buildRiasecBars,
  buildRiasecInterpretations,
  resultCardMode,
  type AssessmentResultsPayload,
  type CareerApiItem,
  type CareerCardView,
} from "@/lib/assessment-view";

/**
 * 答题页入口：空态 / 重测 / 继续作答都走这里，并带上本量表的 code（#289 起答题页按 `?code=` 取量表）
 */
function quizHref(code: string): string {
  return `/dashboard/student/assessment/quiz?code=${encodeURIComponent(code)}`;
}

interface CareersPayload {
  careers?: CareerApiItem[];
  attribution?: string;
}

/**
 * 单套量表的结果卡（#224 + #292）：**在入口按计分模式分流**。
 *
 * - `dimensional`（大五人格）→ `FiveFactorResultCard`：画像标签 + 五维雷达/排名/高低分解读，无三字码、无职业推荐；
 * - `typological`（霍兰德）→ 沿用 #224 的卡：三字码 + 六型雷达/排名/解读 + 推荐职业。
 *
 * 数据由 `AssessmentResultsSection` 按量表清单统一取好再传进来；本组件不再自己 fetch 结果，
 * 只保留霍兰德卡的「推荐职业」渐进增强（大五分永不请求 `/careers`）。
 * 空态与耗时口径复用 `deriveAssessmentCenter` 的统一算法，不写死题量 / 分钟数。
 */
export default function AssessmentResultCard({
  code,
  data,
}: {
  code: string;
  data: AssessmentResultsPayload;
}) {
  const current = data.current;
  const mode = resultCardMode(data.assessment);
  const [careers, setCareers] = useState<CareerCardView[]>([]);
  const [careersAttribution, setCareersAttribution] = useState("");

  // 推荐职业（#226）：只在霍兰德卡有当前结果时补拉；失败/为空都静默（渐进增强）
  const currentId = current?.id ?? null;
  const wantsCareers = mode === "holland" && currentId !== null;

  useEffect(() => {
    if (!wantsCareers) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/shared/assessment/careers?limit=6");
        const payload = (await res.json()) as CareersPayload;
        if (!res.ok) throw new Error(payload?.attribution || "推荐职业加载失败");
        if (cancelled) return;
        setCareers(buildCareerCards(payload.careers));
        setCareersAttribution(typeof payload.attribution === "string" ? payload.attribution : "");
      } catch (err) {
        // 推荐是渐进增强（A3 未就绪 / 数据为空都属正常）：整块不渲染即可，不打扰学生
        console.error("Failed to load career recommendations:", err);
        if (!cancelled) setCareers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wantsCareers]);

  // 无结果：空态引导去该量表的答题页；有未完成草稿时提示接着答
  if (!current) {
    const assessmentView = deriveAssessmentCenter(data);
    const inProgress = data.inProgress;
    return (
      <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
        <ProfileSectionHeader label={data.assessment.name} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">还没做过「{data.assessment.name}」</p>
            <p className="mt-1 text-xs text-muted leading-relaxed">
              {assessmentView.questionCount > 0 && assessmentView.estimatedMinutes > 0
                ? `${assessmentView.questionCount} 道题、大约 ${assessmentView.estimatedMinutes} 分钟。`
                : "题目准备中。"}
              {mode === "big-five"
                ? "做完可以看到你的五大人格画像，了解自己在哪些方面更有优势。"
                : "做完可以看到你的兴趣类型，以及可能适合你的职业方向。"}
            </p>
            {inProgress && (
              <p className="mt-1 text-xs text-muted">
                上次答到 {assessmentView.answered}/{assessmentView.total} 题，可以接着做。
              </p>
            )}
          </div>
          <Link
            href={quizHref(code)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors flex-shrink-0"
          >
            <Compass className="h-4 w-4" aria-hidden />
            {inProgress ? "继续作答" : "开始测评"}
          </Link>
        </div>
      </section>
    );
  }

  if (mode === "big-five") {
    return <FiveFactorResultCard data={data} code={code} />;
  }

  // 霍兰德卡（#224 原有内容）：按行排列的六型视图 + 推荐职业
  const bars = buildRiasecBars(current.scores, current.typeCode);
  const interpretations = buildRiasecInterpretations(current.scores, current.typeCode);
  const completedAt = formatResultTime(current.completedAt);
  const trailing = buildResultTrailing({
    questionCount: current.questionCount,
    completedAt,
    historyCount: data.history.length,
  });

  return (
    <section className="bg-card rounded-xl border border-border-soft p-5 space-y-5">
      <ProfileSectionHeader
        label={data.assessment.name}
        trailing={<span className="text-xs text-muted text-right">{trailing}</span>}
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <HollandCodeBadge typeCode={current.typeCode} />
        <Link
          href={quizHref(code)}
          className="inline-flex items-center justify-center px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition-colors flex-shrink-0"
        >
          {data.inProgress ? "继续作答" : "重新测评"}
        </Link>
      </div>

      {/* 两种视图并列：雷达看整体形状，条状排名看具体高低 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border-soft px-2 py-1">
          <RiasecRadarChart scores={current.scores} />
        </div>
        <ul className="space-y-2.5" aria-label="六型兴趣得分排名">
          {bars.map((bar) => (
            <li key={bar.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-foreground">
                  {bar.label}
                  {bar.isTop && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400">
                      主要兴趣
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
        <h3 className="text-sm font-medium text-foreground">六型逐条解读</h3>
        <ul className="space-y-2">
          {interpretations.map((item) => (
            <li key={item.key} className="rounded-lg bg-background px-3 py-2">
              <p className="text-sm font-medium text-foreground">
                {item.label}
                {item.isTop && <span className="ml-1.5 text-xs text-muted">主要兴趣</span>}
              </p>
              <p className="mt-0.5 text-xs text-muted leading-relaxed">{item.text}</p>
            </li>
          ))}
        </ul>
      </div>

      {/* 推荐职业（#226）：无数据/接口失败时整块不渲染 */}
      {careers.length > 0 && (
        <div className="space-y-3 border-t border-border-soft pt-4">
          <h3 className="text-sm font-medium text-foreground">可能适合你的职业</h3>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {careers.map((career) => (
              <li key={career.code} className="rounded-lg border border-border-soft bg-background px-3 py-2">
                <p className="text-sm text-foreground">{career.displayName}</p>
                {career.hasChineseName && (
                  <p className="mt-0.5 text-[11px] text-muted/80">{career.englishName}</p>
                )}
                {career.meta && <p className="mt-1 text-xs text-muted">{career.meta}</p>}
              </li>
            ))}
          </ul>
          {careersAttribution && <p className="text-[11px] text-muted/80 leading-relaxed">{careersAttribution}</p>}
        </div>
      )}

      {/* 署名 / 授权 / 免责：O*NET Tools Developer License 要求随结果展示（#221）。
          免责声明用测评中心与结果区共用的组件（#225），保证两边文案口径一致。 */}
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
