import { BookOpen, Sparkles } from "lucide-react";
import SectionCard from "@/components/assessment/SectionCard";
import { ASSESSMENT_TIPS, RIASEC_INTRO } from "@/lib/assessment-center-content";

/**
 * RIASEC 六型科普卡（#225）。
 *
 * 目的：让学生在作答**之前**大致知道「六型是什么」，交卷后拿到三字码时不至于看不懂。
 * 只讲倾向与偏好，不做人格判断、不给「适合什么职业」的结论（结论在结果区，且只是参考）。
 *
 * 文案是自建的通俗介绍（参考 O*NET 对六类的公开描述改写），不复述任何商业量表的题面/解释文本。
 */
export default function RiasecGuideCard() {
  return (
    <SectionCard
      title="霍兰德六型是什么"
      icon={BookOpen}
      subtitle="职业兴趣可以归纳成六种倾向，每个人都是六种倾向的不同组合——你会有一个主要类型，再加上两三个次要类型。"
    >
      <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {RIASEC_INTRO.map((type) => (
          <li key={type.key} className="rounded-lg border border-border-soft bg-background px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300 text-xs font-bold"
                aria-hidden
              >
                {type.key}
              </span>
              <p className="text-sm font-medium text-foreground">
                {type.label}
                <span className="ml-1.5 text-[11px] font-normal text-muted">{type.english}</span>
              </p>
            </div>
            <p className="mt-1 text-xs text-muted leading-relaxed">{type.summary}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {type.keywords.map((keyword) => (
                <span
                  key={keyword}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >
                  {keyword}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <div className="space-y-1.5 border-t border-border-soft pt-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Sparkles size={13} className="text-accent" aria-hidden />
          作答前的小提示
        </p>
        <ul className="space-y-1.5">
          {ASSESSMENT_TIPS.map((tip) => (
            <li key={tip} className="text-xs text-muted leading-relaxed">
              · {tip}
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}
