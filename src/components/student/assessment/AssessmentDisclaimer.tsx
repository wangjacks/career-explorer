import { Info } from "lucide-react";
import { resolveDisclaimer } from "@/lib/assessment-center-content";

/**
 * 免责声明（#225，测评中心与结果区共用）。
 *
 * 文案优先用 `assessments` 表下发的 `disclaimer`（权威在库里，随接口返回），
 * 没有接口数据时用兜底文案——保证「结果只用于生涯探索、不作诊断/录用依据」这句
 * 在任何状态下都可见（合规要求，见 `docs/plan-assessment.md` 第 2 节）。
 *
 * `variant="inline"` 是结果区用的紧凑样式（跟在结果卡底部），`card` 是测评中心用的卡片样式。
 */
export default function AssessmentDisclaimer({
  text,
  variant = "card",
}: {
  text?: string | null;
  variant?: "card" | "inline";
}) {
  const content = resolveDisclaimer(text);
  if (variant === "inline") {
    return (
      <p className="flex items-start gap-1.5 text-xs text-muted leading-relaxed">
        <Info size={13} className="mt-0.5 flex-shrink-0" aria-hidden />
        <span>{content}</span>
      </p>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border-soft bg-background px-3 py-2.5">
      <Info size={15} className="mt-0.5 flex-shrink-0 text-accent" aria-hidden />
      <p className="text-xs text-muted leading-relaxed">{content}</p>
    </div>
  );
}
