import { ExternalLink, ShieldCheck } from "lucide-react";
import SectionCard from "./SectionCard";
import AssessmentDisclaimer from "./AssessmentDisclaimer";
import CollapsibleCard from "./CollapsibleCard";
import {
  buildAttributionGroups,
  type AttributionScaleInput,
} from "@/lib/assessment-view";
import { EXTERNAL_LINK_REL, ONET_TOOLS_LICENSE_URL } from "@/lib/assessment-center-content";

const CARD_TITLE = "关于这些测评 · 授权与免责";
const CARD_SUBTITLE =
  "测评题目与职业推荐数据来自 O*NET、IPIP 等公开材料；署名、授权与免责声明集中在这里，全文不删减。";

/**
 * 页底「授权与免责」卡（#225 + #322）：O*NET 改编署名 + 授权说明 + 免责声明。
 *
 * O*NET Tools Developer License 要求署名与「USDOL/ETA 未审核这些修改」的声明随产品可见；
 * 权威文案是 `assessments` 表的授权字段（随 `/list`、`/results` 接口下发），页面只负责渲染，
 * 不在前端复制一份（改口径只改库里的种子）。接口不可用时退化成一句简短来源说明 +
 * 兜底免责声明，保证页面上始终能看到「结果不作诊断/录用依据」。
 *
 * #322 起「我的档案」页尾传 `scales`（多套量表）并开启 `collapsible`：
 * 声明全文全页只出现一次，结果卡内只留一行指针。**合规卡默认展开**——结果卡才是需要折叠的主体；
 * 法定声明必须首屏可见、可 Ctrl+F、可被屏幕阅读器读到，指针锚点也要落在正文上。
 * 仍保留折叠按钮，供学生手动收起；收起后 `keepMounted` 仍把文本留在 DOM。
 * 分组 / 去重 / O*NET 兜底判定在 `assessment-view.ts#buildAttributionGroups`（纯函数，有单测）。
 */
export default function AssessmentAttributionCard({
  attribution,
  licenseText,
  disclaimer,
  scales,
  careersAttribution,
  collapsible = false,
  defaultOpen = true,
}: {
  /** 单量表兼容入参（测评中心） */
  attribution?: string | null;
  licenseText?: string | null;
  disclaimer?: string | null;
  /** 多量表入参（我的档案页尾，按量表分组） */
  scales?: readonly AttributionScaleInput[];
  /** 推荐职业的 CC BY 4.0 署名（来自 `/careers`） */
  careersAttribution?: string | null;
  /** 页尾折叠（我的档案）；默认常驻展开 */
  collapsible?: boolean;
  /** 折叠态默认是否展开（学生页默认展开满足合规；教师弹窗可收起为「默认折叠」） */
  defaultOpen?: boolean;
}) {
  const {
    groups,
    disclaimers,
    careersAttribution: careersText,
  } = buildAttributionGroups({ scales, attribution, licenseText, disclaimer, careersAttribution });

  const content = (
    <>
      {groups.map((group) => (
        <div key={group.code} className="space-y-1.5">
          {group.name && <h3 className="text-xs font-semibold text-foreground">{group.name}</h3>}
          {group.attribution ? (
            <p className="text-xs text-muted leading-relaxed">{group.attribution}</p>
          ) : (
            group.onetFallback && (
              <p className="text-xs text-muted leading-relaxed">
                本测评题目改编自 O*NET Career Exploration Tools（美国劳工部就业与培训署），依据 O*NET Tools
                Developer License 使用；O*NET® 是 USDOL/ETA 的商标。
              </p>
            )
          )}
          {group.licenseText && <p className="text-xs text-muted leading-relaxed">{group.licenseText}</p>}
        </div>
      ))}

      {careersText && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold text-foreground">职业推荐数据</h3>
          <p className="text-xs text-muted leading-relaxed">{careersText}</p>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-foreground">免责声明</h3>
        {disclaimers.length > 0 ? (
          disclaimers.map((entry) => (
            <div key={entry.text} className="space-y-1">
              {/* 不同声明各自带量表归属，避免读者无法判断哪句属于哪套量表 */}
              {disclaimers.length > 1 && entry.scaleNames.length > 0 && (
                <h4 className="text-[11px] font-medium text-muted">{entry.scaleNames.join("、")}</h4>
              )}
              <AssessmentDisclaimer text={entry.text} />
            </div>
          ))
        ) : (
          <AssessmentDisclaimer />
        )}
      </div>

      <a
        href={ONET_TOOLS_LICENSE_URL}
        target="_blank"
        rel={EXTERNAL_LINK_REL}
        className="inline-flex items-center gap-1 text-xs text-primary-strong underline underline-offset-2 hover:no-underline"
      >
        查看 O*NET Tools Developer License
        <ExternalLink size={12} aria-hidden />
      </a>
    </>
  );

  if (collapsible) {
    return (
      <CollapsibleCard
        id="assessment-attribution"
        title={CARD_TITLE}
        subtitle={CARD_SUBTITLE}
        icon={ShieldCheck}
        defaultOpen={defaultOpen}
        keepMounted
      >
        {content}
      </CollapsibleCard>
    );
  }

  return (
    <SectionCard id="assessment-attribution" title={CARD_TITLE} subtitle={CARD_SUBTITLE} icon={ShieldCheck}>
      {content}
    </SectionCard>
  );
}