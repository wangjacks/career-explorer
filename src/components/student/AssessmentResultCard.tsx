"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Compass, Loader2 } from "lucide-react";
import ProfileSectionHeader from "./ProfileSectionHeader";
import HollandCodeBadge from "./HollandCodeBadge";
import RiasecRadarChart from "./RiasecRadarChart";
import AssessmentDisclaimer from "./assessment/AssessmentDisclaimer";
import { formatResultTime } from "@/lib/assessment-flow";
import { deriveAssessmentCenter } from "@/lib/assessment-center";
import {
  buildCareerCards,
  buildRiasecBars,
  buildRiasecInterpretations,
  type CareerApiItem,
  type CareerCardView,
} from "@/lib/assessment-view";
import type { DimensionScore } from "@/lib/assessment-scoring";

/** 答题页入口：结果为空/重测都走这里（测评中心的独立入口见 #222，上线后由它承担导航） */
const QUIZ_HREF = "/dashboard/student/assessment/quiz";

interface AssessmentMeta {
  code: string;
  name: string;
  questionCount: number;
  scaleVersion: string;
  dimensions: { key: string; label: string }[];
  attribution: string;
  licenseText: string;
  disclaimer: string;
}

interface ResultView {
  id: number;
  typeCode: string | null;
  scores: DimensionScore[];
  completedAt: string;
  isCurrent: boolean;
  /** 该条结果实际作答量（旧记录回退为当时作答数；#283 起由结果接口逐条下发） */
  questionCount?: number;
}

interface ResultsPayload {
  assessment: AssessmentMeta;
  current: ResultView | null;
  history: ResultView[];
  inProgress: { answered: number; total: number; updatedAt: string } | null;
}

interface CareersPayload {
  careers?: CareerApiItem[];
  attribution?: string;
}

/**
 * 「我的档案」里的职业兴趣测评结果区（#224）。
 *
 * 与档案提交流程**完全解耦**：自己读 `/api/shared/assessment/results`，不看 `submissionClosed`、
 * 不参与档案版本快照、不出现「已归档 / 未提交」状态——档案截止了也照样能查看与重测。
 *
 * 推荐职业（#226）就绪后才出现：接口失败 / 无中文数据时**整块静默不渲染**，不影响结果区其余内容。
 * 数据都是结果快照（当时算好的六维分与三字码），页面不重算。
 */
export default function AssessmentResultCard() {
  const [data, setData] = useState<ResultsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [careers, setCareers] = useState<CareerCardView[]>([]);
  const [careersAttribution, setCareersAttribution] = useState("");

  const loadResults = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/shared/assessment/results");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "测评结果加载失败");
      setData(payload as ResultsPayload);
    } catch (err) {
      console.error("Failed to load assessment results:", err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- 面板进入时读一次本人测评结果（与档案数据并列、互不依赖） */
  useEffect(() => {
    void loadResults();
  }, [loadResults]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const currentId = data?.current?.id ?? null;

  // 推荐职业（#226）：只在有当前结果时补拉；失败/为空都静默（渐进增强）
  useEffect(() => {
    if (currentId === null) return;
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
  }, [currentId]);

  const current = data?.current ?? null;
  const inProgress = data?.inProgress ?? null;
  const assessmentView = deriveAssessmentCenter(data);

  if (loading) {
    return (
      <section className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
        <ProfileSectionHeader label="职业兴趣测评" />
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          正在读取测评结果…
        </p>
      </section>
    );
  }

  if (failed) {
    return (
      <section className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
        <ProfileSectionHeader label="职业兴趣测评" />
        <p className="text-sm text-muted">测评结果暂时读不到</p>
        <button
          type="button"
          onClick={() => void loadResults()}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition-colors"
        >
          重试
        </button>
      </section>
    );
  }

  // 无结果：空态引导去测评；有未完成草稿时提示接着答
  if (!current) {
    return (
      <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
        <ProfileSectionHeader label="职业兴趣测评" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">还没做过职业兴趣测评</p>
            <p className="mt-1 text-xs text-muted leading-relaxed">
              {assessmentView.questionCount > 0 && assessmentView.estimatedMinutes > 0
                ? `${assessmentView.questionCount} 道题、大约 ${assessmentView.estimatedMinutes} 分钟。`
                : "题目准备中。"}
              做完可以看到你的兴趣类型，以及可能适合你的职业方向。
            </p>
            {inProgress && (
              <p className="mt-1 text-xs text-muted">
                上次答到 {assessmentView.answered}/{assessmentView.total} 题，可以接着做。
              </p>
            )}
          </div>
          <Link
            href={QUIZ_HREF}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors flex-shrink-0"
          >
            <Compass className="h-4 w-4" aria-hidden />
            {inProgress ? "继续作答" : "开始测评"}
          </Link>
        </div>
      </section>
    );
  }

  const bars = buildRiasecBars(current.scores, current.typeCode);
  const interpretations = buildRiasecInterpretations(current.scores, current.typeCode);
  const completedAt = formatResultTime(current.completedAt);

  return (
    <section className="bg-card rounded-xl border border-border-soft p-5 space-y-5">
      <ProfileSectionHeader
        label="职业兴趣测评"
        trailing={
          <span className="text-xs text-muted text-right">
            {current.questionCount ? `本次 ${current.questionCount} 题` : null}
            {current.questionCount && completedAt ? " · " : null}
            {completedAt ? `完成于 ${completedAt}` : "已完成"}
          </span>
        }
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <HollandCodeBadge typeCode={current.typeCode} />
        <Link
          href={QUIZ_HREF}
          className="inline-flex items-center justify-center px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition-colors flex-shrink-0"
        >
          {inProgress ? "继续作答" : "重新测评"}
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
      <AssessmentDisclaimer text={data?.assessment.disclaimer} variant="inline" />
      {data?.assessment.attribution && (
        <p className="text-[11px] text-muted/80 leading-relaxed">{data.assessment.attribution}</p>
      )}
      {data?.assessment.licenseText && (
        <p className="text-[11px] text-muted/80 leading-relaxed">{data.assessment.licenseText}</p>
      )}
    </section>
  );
}
