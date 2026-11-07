import { ExternalLink, Link2 } from "lucide-react";
import SectionCard from "@/components/assessment/SectionCard";
import { ASSESSMENT_HELP_LINKS, EXTERNAL_LINK_REL } from "@/lib/assessment-center-content";

/**
 * 权威渠道外链卡（#225 / #291）：学职平台（教育部学信网）与 IPIP 国际人格题库。
 *
 * 为什么不自己做：国内已有权威免费渠道，平台内容版权归官方，我们只做外链推荐、不复刻题目
 * （口径见 `docs/plan-assessment.md` 第 2 节）；IPIP 条目属于公有领域，用来源链接注明出处。
 *
 * 外链一律 `target="_blank"` + `rel="noopener noreferrer"`：新窗口打开，且不给新页面
 * `window.opener` 反向控制本页的机会。链接文案在 `assessment-center-content.ts`，单测锁 https。
 */
export default function AssessmentLinksCard() {
  return (
    <SectionCard
      title="更多权威渠道"
      icon={Link2}
      subtitle="下面是学职平台（教育部学信网）的官方入口与 IPIP 国际人格题库，测评与职业信息都可以免费使用，作为补充参考。"
    >
      <ul className="space-y-2">
        {ASSESSMENT_HELP_LINKS.map((link) => (
          <li key={link.id}>
            <a
              href={link.href}
              target="_blank"
              rel={EXTERNAL_LINK_REL}
              className="group flex items-start gap-3 rounded-lg border border-border-soft bg-background px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-primary-soft/40"
            >
              <ExternalLink size={15} className="mt-0.5 text-accent flex-shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium text-foreground group-hover:text-primary-strong">{link.title}</span>
                  <span className="text-[11px] text-muted">{link.source}</span>
                </span>
                <span className="mt-0.5 block text-xs text-muted leading-relaxed">{link.description}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted/80 leading-relaxed">
        外链会在新窗口打开，其内容与服务由对应平台提供。
      </p>
    </SectionCard>
  );
}
