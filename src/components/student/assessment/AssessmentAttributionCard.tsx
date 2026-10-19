import { ExternalLink, ShieldCheck } from "lucide-react";
import SectionCard from "./SectionCard";
import AssessmentDisclaimer from "./AssessmentDisclaimer";
import { EXTERNAL_LINK_REL, ONET_TOOLS_LICENSE_URL } from "@/lib/assessment-center-content";

/**
 * 页底「授权与免责」卡（#225）：O*NET 改编署名 + 授权说明 + 免责声明。
 *
 * O*NET Tools Developer License 要求署名与「USDOL/ETA 未审核这些修改」的声明随产品可见；
 * 权威文案是 `assessments` 表的授权字段（随 `/results` 接口下发），页面只负责渲染，
 * 不在前端复制一份（改口径只改库里的种子）。接口不可用时退化成一句简短来源说明 +
 * 兜底免责声明，保证页面上始终能看到「结果不作诊断/录用依据」。
 */
export default function AssessmentAttributionCard({
  attribution,
  licenseText,
  disclaimer,
}: {
  attribution?: string | null;
  licenseText?: string | null;
  disclaimer?: string | null;
}) {
  const hasAttribution = typeof attribution === "string" && attribution.trim() !== "";
  const hasLicense = typeof licenseText === "string" && licenseText.trim() !== "";

  return (
    <SectionCard
      id="assessment-attribution"
      title="授权与免责"
      icon={ShieldCheck}
      subtitle="测评题目改编自美国劳工部的 O*NET 材料，按 O*NET Tools Developer License 使用。"
    >
      {hasAttribution ? (
        <p className="text-xs text-muted leading-relaxed">{attribution}</p>
      ) : (
        <p className="text-xs text-muted leading-relaxed">
          本测评题目改编自 O*NET Career Exploration Tools（美国劳工部就业与培训署），依据 O*NET Tools
          Developer License 使用；O*NET® 是 USDOL/ETA 的商标。
        </p>
      )}

      {hasLicense && <p className="text-xs text-muted leading-relaxed">{licenseText}</p>}

      <a
        href={ONET_TOOLS_LICENSE_URL}
        target="_blank"
        rel={EXTERNAL_LINK_REL}
        className="inline-flex items-center gap-1 text-xs text-primary-strong underline underline-offset-2 hover:no-underline"
      >
        查看 O*NET Tools Developer License
        <ExternalLink size={12} aria-hidden />
      </a>

      <AssessmentDisclaimer text={disclaimer} />
    </SectionCard>
  );
}
