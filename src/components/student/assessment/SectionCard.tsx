import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * 测评中心内容卡的统一外壳（#225）。
 *
 * 统一「`bg-card rounded-xl border border-border-soft` + 左侧强调条 + 标题」这一套外观，
 * 内容卡只写正文，避免每张卡各写一遍边框/间距导致风格漂移（验收要求内容卡与 hero、状态卡风格统一）。
 */
export default function SectionCard({
  title,
  subtitle,
  icon: Icon,
  id,
  trailing,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  /** 页面内锚点（如页底授权区 `#assessment-attribution`） */
  id?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-1 h-4 rounded-full bg-accent" aria-hidden />
        {Icon && <Icon size={16} className="text-accent" aria-hidden />}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {trailing && <div className="ml-auto">{trailing}</div>}
      </div>
      {subtitle && <p className="text-xs text-muted leading-relaxed">{subtitle}</p>}
      {children}
    </section>
  );
}
