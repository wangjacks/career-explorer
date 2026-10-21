"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

/**
 * 「结论先行 + 详情折叠」外壳（#322）。
 *
 * 我的档案里的测评结果卡、跨量表提示卡与页尾授权卡共用同一套折叠壳：
 * - 折叠控件是 `button + aria-expanded + aria-controls`，键盘可达、焦点可见，不引新依赖；
 * - 默认收起，展开才**挂载**内容（`keepMounted` 例外）——雷达图在收起时不会以 0 宽初始化；
 * - 页尾合规文本用 `keepMounted` 保留在 DOM 里（视觉折叠但内容不消失）。
 */
export type CollapsibleCardStatus = "completed" | "in-progress" | "not-started";

const STATUS_META: Record<CollapsibleCardStatus, { label: string; className: string }> = {
  completed: {
    label: "已测",
    className: "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  },
  "in-progress": {
    label: "进行中",
    className: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  "not-started": {
    label: "未测",
    className: "bg-gray-100 text-muted dark:bg-gray-800",
  },
};

export default function CollapsibleCard({
  id,
  title,
  subtitle,
  status,
  icon: Icon,
  action,
  defaultOpen = false,
  keepMounted = false,
  children,
}: {
  /** 页面内锚点（如页尾授权卡 `#assessment-attribution`） */
  id?: string;
  title: string;
  /** 标题下的口径行（题量 / 完成时间 / 次数） */
  subtitle?: string;
  status?: CollapsibleCardStatus;
  icon?: LucideIcon;
  /** 标题右侧的独立操作（如未测量表的「去测评」），不能放进折叠按钮里 */
  action?: ReactNode;
  defaultOpen?: boolean;
  /** 收起时仍挂载内容（只用于无图表的合规文本，保证文本留在 DOM） */
  keepMounted?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const panelVisible = open || keepMounted;

  return (
    <section id={id} className="bg-card rounded-xl border border-border-soft">
      <div className="flex items-start gap-3 p-5">
        <span className="mt-0.5 h-4 w-1 flex-shrink-0 rounded-full bg-accent" aria-hidden />
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-foreground">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelVisible ? panelId : undefined}
            onClick={() => setOpen((value) => !value)}
            className="flex w-full items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                {Icon && <Icon size={16} className="text-accent" aria-hidden />}
                <span>{title}</span>
                {status && (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_META[status].className}`}>
                    {STATUS_META[status].label}
                  </span>
                )}
              </span>
              {subtitle && (
                <span className="mt-1 block text-xs font-normal leading-relaxed text-muted">{subtitle}</span>
              )}
            </span>
            <ChevronDown
              size={16}
              aria-hidden
              className={`mt-0.5 flex-shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            />
            {/* 读屏可听到「展开 / 收起」，不依赖 aria-expanded 的隐含语义 */}
            <span className="sr-only">{open ? "收起详情" : "展开详情"}</span>
          </button>
        </h2>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>

      {panelVisible && (
        <div
          id={panelId}
          hidden={!open}
          className="space-y-5 border-t border-border-soft px-5 pb-5 pt-4"
        >
          {children}
        </div>
      )}
    </section>
  );
}
