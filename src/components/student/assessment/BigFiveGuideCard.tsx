import { BookOpen, Sparkles } from "lucide-react";
import SectionCard from "./SectionCard";
import { BIG_FIVE_INTRO, BIG_FIVE_RIASEC_NOTE } from "@/lib/assessment-center-content";

/**
 * 大五人格科普卡（#291）。
 *
 * 与霍兰德六型卡同一套卡片体系：每个方面给一句通俗介绍 + 得分偏高 / 偏低时的常见表现标签。
 * 只讲「这个方面看的是什么」，**不评判哪种表现更好**，也不给「适合什么职业」的结论。
 *
 * 文案在 `assessment-center-content.ts` 的 `BIG_FIVE_INTRO`，名称与 `IPIP_DIMENSIONS` 一致（单测锁定）；
 * 卡底补一段与霍兰德六型的呼应关系，避免学生把两套结果硬套在一起。
 */
export default function BigFiveGuideCard() {
  return (
    <SectionCard
      title="大五人格是什么"
      icon={BookOpen}
      subtitle="大五把比较稳定的性格特点归纳成五个方面，每个人在每个方面都有自己的位置——没有好坏之分。"
    >
      <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {BIG_FIVE_INTRO.map((dimension) => (
          <li key={dimension.key} className="rounded-lg border border-border-soft bg-background px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300 text-xs font-bold"
                aria-hidden
              >
                {dimension.key}
              </span>
              <p className="text-sm font-medium text-foreground">
                {dimension.label}
                <span className="ml-1.5 text-[11px] font-normal text-muted">{dimension.english}</span>
              </p>
            </div>
            <p className="mt-1 text-xs text-muted leading-relaxed">{dimension.summary}</p>
            <div className="mt-1.5 space-y-1">
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-muted">得分偏高</span>
                {dimension.high.map((keyword) => (
                  <span
                    key={keyword}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-muted">得分偏低</span>
                {dimension.low.map((keyword) => (
                  <span
                    key={keyword}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="space-y-1.5 border-t border-border-soft pt-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Sparkles size={13} className="text-accent" aria-hidden />
          大五与霍兰德六型的关系
        </p>
        <p className="text-xs text-muted leading-relaxed">{BIG_FIVE_RIASEC_NOTE}</p>
      </div>
    </SectionCard>
  );
}
