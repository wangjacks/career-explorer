import { ExternalLink, ShieldCheck } from "lucide-react";
import SectionCard from "./SectionCard";
import AssessmentDisclaimer from "./AssessmentDisclaimer";
import CollapsibleCard from "../CollapsibleCard";
import { EXTERNAL_LINK_REL, ONET_TOOLS_LICENSE_URL } from "@/lib/assessment-center-content";

/** 一套量表的授权声明（页尾卡按量表分组展示） */
export interface AttributionScale {
  code: string;
  name: string;
  attribution?: string | null;
  licenseText?: string | null;
  disclaimer?: string | null;
}

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
 * 声明全文全页只出现一次，结果卡内只留一行指针；测评中心沿用单量表入参、保持常驻展开。
 */
export default function AssessmentAttributionCard({
  attribution,
  licenseText,
  disclaimer,
  scales,
  careersAttribution,
  collapsible = false,
}: {
  /** 单量表兼容入参（测评中心） */
  attribution?: string | null;
  licenseText?: string | null;
  disclaimer?: string | null;
  /** 多量表入参（我的档案页尾，按量表分组） */
  scales?: readonly AttributionScale[];
  /** 推荐职业的 CC BY 4.0 署名（来自 `/careers`） */
  careersAttribution?: string | null;
  /** 页尾折叠（我的档案）；默认常驻展开 */
  collapsible?: boolean;
}) {
  const groups: AttributionScale[] =
    scales && scales.length > 0
      ? [...scales]
      : [{ code: "legacy", name: "", attribution, licenseText, disclaimer }];
  // 兼容测评中心「接口失败也常驻来源说明」的旧行为：仅单量表占位（legacy）时给 O*NET 兜底文案；
  // 真正启用的单套量表即使缺 attribution 也不能套 O*NET 文案（可能是 IPIP）
  const useOnetFallback =
    groups.length === 1 &&
    groups[0].code === "legacy" &&
    !(groups[0].attribution ?? "").trim();
  // 两套量表的免责声明通常逐字相同：去重后只展示一次，避免同一句话出现两遍
  const disclaimerTexts = Array.from(
    new Set(groups.map((group) => (group.disclaimer ?? "").trim()).filter(Boolean))
  );
  const careersText = (careersAttribution ?? "").trim();

  const content = (
    <>
      {groups.map((group) => {
        const groupAttribution = (group.attribution ?? "").trim();
        const groupLicense = (group.licenseText ?? "").trim();
        return (
          <div key={group.code} className="space-y-1.5">
            {group.name && <h3 className="text-xs font-semibold text-foreground">{group.name}</h3>}
            {groupAttribution ? (
              <p className="text-xs text-muted leading-relaxed">{groupAttribution}</p>
            ) : (
              useOnetFallback && (
                <p className="text-xs text-muted leading-relaxed">
                  本测评题目改编自 O*NET Career Exploration Tools（美国劳工部就业与培训署），依据 O*NET Tools
                  Developer License 使用；O*NET® 是 USDOL/ETA 的商标。
                </p>
              )
            )}
            {groupLicense && <p className="text-xs text-muted leading-relaxed">{groupLicense}</p>}
          </div>
        );
      })}

      {careersText && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold text-foreground">职业推荐数据</h3>
          <p className="text-xs text-muted leading-relaxed">{careersText}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-foreground">免责声明</h3>
        {disclaimerTexts.length > 0 ? (
          disclaimerTexts.map((text) => <AssessmentDisclaimer key={text} text={text} />)
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
