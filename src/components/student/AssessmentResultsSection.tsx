"use client";

import { Loader2, Sparkles } from "lucide-react";
import ProfileSectionHeader from "./ProfileSectionHeader";
import CollapsibleCard from "./CollapsibleCard";
import AssessmentResultCard from "./AssessmentResultCard";
import { CROSS_SCALE_LINKS, resultCardMode } from "@/lib/assessment-view";
import type { AssessmentResultsData } from "@/lib/assessment-results-loader";
import { ASSESSMENT_RESULTS_ID, assessmentDetailId } from "@/lib/profile-summary";

export interface AssessmentResultsSectionProps {
  /** 页面统一拉取的数据（#323：摘要与详情共用一份，本组件不再自己 fetch） */
  data: AssessmentResultsData;
  loading: boolean;
  /** 量表清单失败（整个结果区不可用）；单套失败在 `data.failedCodes` 里 */
  failed: boolean;
  onRetry: () => void;
  /** 受控展开的卡（#323：摘要卡「查看详情」时由页面指定） */
  expandedCode: string | null;
  onExpandedChange: (code: string | null) => void;
  /** 被摘要卡定位时短暂高亮的元素 id（卡片 id 或结果区容器） */
  highlightId?: string | null;
}

/**
 * 「我的档案」测评结果区（#224 + #292 + #322 + #323）：按**量表清单循环渲染每套折叠卡**。
 *
 * 期 2（#323）起本组件是**受控展示层**：
 * - 数据由页面用 `useAssessmentResults()` 拉一次，摘要卡与这里消费同一份（不再各自 fetch）；
 * - 每张折叠卡的展开状态可由页面控制（速览卡「查看详情」→ 展开 + 滚动 + 高亮）；
 * - 卡片锚点 id 统一用 `assessmentDetailId(code)`，结果区容器 id 用 `ASSESSMENT_RESULTS_ID`。
 *
 * 与档案提交流程仍然完全解耦：不看 `submissionClosed`、不参与档案版本快照。
 * 霍兰德与大五各有一份当前结果时，在卡片下方补一张「人格与兴趣一起看」折叠卡（#292）。
 */
export default function AssessmentResultsSection({
  data,
  loading,
  failed,
  onRetry,
  expandedCode,
  onExpandedChange,
  highlightId = null,
}: AssessmentResultsSectionProps) {
  const { scales, payloads, failedCodes, careers } = data;
  const highlighted = highlightId === ASSESSMENT_RESULTS_ID;

  if (loading) {
    return (
      <section
        id={ASSESSMENT_RESULTS_ID}
        className={`bg-card rounded-xl border border-border-soft p-5 space-y-3 scroll-mt-24 transition-shadow duration-300 ${
          highlighted ? "ring-2 ring-accent/70 shadow-lg" : ""
        }`}
      >
        <ProfileSectionHeader label="职业测评" />
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          正在读取测评结果…
        </p>
      </section>
    );
  }

  if (failed) {
    return (
      <section
        id={ASSESSMENT_RESULTS_ID}
        className={`bg-card rounded-xl border border-border-soft p-5 space-y-3 scroll-mt-24 transition-shadow duration-300 ${
          highlighted ? "ring-2 ring-accent/70 shadow-lg" : ""
        }`}
      >
        <ProfileSectionHeader label="职业测评" />
        <p className="text-sm text-muted">测评结果暂时读不到</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition-colors"
        >
          重试
        </button>
      </section>
    );
  }

  if (scales.length === 0) {
    // 清单为空 = 没有启用中的量表（停用后不出现在档案页），整个结果区不占位
    return <div id={ASSESSMENT_RESULTS_ID} />;
  }

  // 提示卡讲的是霍兰德 × 大五的对应关系：两类各有一份当前结果才出现。
  // 不写「完成数 ≥ 2」——将来第三套量表（如再一套 dimensional）都完成时不该弹这张卡。
  const hasHollandResult = scales.some((item) => resultCardMode(item) === "holland" && payloads[item.code]?.current);
  const hasBigFiveResult = scales.some((item) => resultCardMode(item) === "big-five" && payloads[item.code]?.current);

  return (
    <div id={ASSESSMENT_RESULTS_ID} className="space-y-5 scroll-mt-24">
      {scales.map((item) => {
        const payload = payloads[item.code];
        const cardId = assessmentDetailId(item.code);
        if (!payload) {
          // 单套补拉失败：只让这张卡显示重试，不影响其他量表
          return (
            <section
              key={item.code}
              id={cardId}
              className={`bg-card rounded-xl border border-border-soft p-5 space-y-3 scroll-mt-24 transition-shadow duration-300 ${
                highlightId === cardId ? "ring-2 ring-accent/70 shadow-lg" : ""
              }`}
            >
              <ProfileSectionHeader label={item.name} />
              <p className="text-sm text-muted">这套测评的结果暂时读不到</p>
              {failedCodes.includes(item.code) && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition-colors"
                >
                  重试
                </button>
              )}
            </section>
          );
        }
        return (
          <AssessmentResultCard
            key={item.code}
            id={cardId}
            code={item.code}
            data={payload}
            careers={resultCardMode(item) === "holland" ? careers : []}
            open={expandedCode === item.code}
            onOpenChange={(next) => onExpandedChange(next ? item.code : null)}
            highlight={highlightId === cardId}
          />
        );
      })}

      {hasHollandResult && hasBigFiveResult && <CrossScaleTipCard />}
    </div>
  );
}

/** 「人格与兴趣一起看」折叠卡（#292 / #322）：霍兰德与大五都有当前结果时出现 */
function CrossScaleTipCard() {
  return (
    <CollapsibleCard
      title="人格与兴趣一起看"
      icon={Sparkles}
      subtitle="兴趣和性格常常互相印证。这两份结果放在一起对照，能帮你看得更清楚："
    >
      <ul className="space-y-2">
        {CROSS_SCALE_LINKS.map((link) => (
          <li key={`${link.riasec}-${link.bigFive}`} className="rounded-lg bg-background px-3 py-2">
            <p className="text-xs font-medium text-foreground">
              {link.riasecLabel} × {link.bigFiveLabel}
            </p>
            <p className="mt-0.5 text-xs text-muted leading-relaxed">{link.text}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted leading-relaxed">
        两边没有同时高也很正常：兴趣会被经历改变，性格相对稳定，放在一起看是互补，不是互相否定。
      </p>
    </CollapsibleCard>
  );
}
