"use client";

import { ArrowDown, Briefcase, Compass, Fingerprint, Tags } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import ProfileSectionHeader from "./ProfileSectionHeader";
import type { SummaryCard, SummaryCardKind, ProfileSummary } from "@/lib/profile-summary";

const KIND_ICONS: Record<SummaryCardKind, LucideIcon> = {
  interest: Compass,
  personality: Fingerprint,
  careers: Briefcase,
  profile: Tags,
};

/** 标签胶囊的兜底配色（分类色由页面经 tagColors 传入，缺失时用中性色） */
/** 标签分类色缺失时的兜底（教师详情弹窗的身份区 / 版本历史标签共用同一兜底，#332） */
export const FALLBACK_TAG_CLASS = "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";

/**
 * 「我的档案」速览四卡（#323）：首屏结论区，放在 hero 与资料区之间。
 *
 * - 桌面 2×2、移动单列；每卡结构统一：图标 + 标题 + 右上「查看详情 ↓」+ 结论主体；
 * - 只做展示与转发：数据由页面统一拉取（摘要与折叠详情共用一份），点击统一交给 `onAction`；
 * - 三态（ready / empty / degraded）各自独立，单卡降级不影响其它卡。
 */
export default function ProfileSummaryBoard({
  summary,
  loading,
  onAction,
  tagColors,
}: {
  summary: ProfileSummary;
  loading: boolean;
  onAction: (card: SummaryCard) => void;
  /** 标签名称 → 胶囊配色（与「我的档案资料」同源的三色映射） */
  tagColors?: Map<string, string>;
}) {
  return (
    <section aria-labelledby="profile-summary-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span id="profile-summary-heading">
          <ProfileSectionHeader label="速览" />
        </span>
        <span className="text-xs text-muted">一屏读完结论，点「查看详情」展开对应内容</span>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-busy="true" aria-label="速览加载中">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="animate-pulse space-y-3 rounded-xl border border-border-soft bg-card p-4"
            >
              <div className="h-4 w-24 rounded bg-gray-100 dark:bg-gray-800" />
              <div className="h-6 w-40 rounded bg-gray-100 dark:bg-gray-800" />
              <div className="h-2 w-full rounded bg-gray-100 dark:bg-gray-800" />
              <div className="h-2 w-2/3 rounded bg-gray-100 dark:bg-gray-800" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {summary.cards.map((card) => (
            <SummaryCardView key={card.kind} card={card} onAction={onAction} tagColors={tagColors} />
          ))}
        </div>
      )}
    </section>
  );
}

function SummaryCardView({
  card,
  onAction,
  tagColors,
}: {
  card: SummaryCard;
  onAction: (card: SummaryCard) => void;
  tagColors?: Map<string, string>;
}) {
  const Icon = KIND_ICONS[card.kind];
  const hasDetailButton = card.state === "ready" && (card.cta.action === "detail" || card.cta.action === "profile");

  return (
    <section
      aria-labelledby={`summary-${card.kind}-title`}
      className="flex h-full flex-col gap-3 rounded-xl border border-border-soft bg-card p-4"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <h3 id={`summary-${card.kind}-title`} className="min-w-0 flex-1 text-sm font-semibold text-foreground">
          {card.title}
        </h3>
        {hasDetailButton && (
          <button
            type="button"
            onClick={() => onAction(card)}
            aria-controls={card.cta.targetId}
            className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-lg px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            查看详情
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        {card.code && (
          <p className="font-mono text-2xl font-extrabold leading-none tracking-[0.15em] text-foreground">
            {card.code}
          </p>
        )}
        {card.headline && <p className="text-sm font-medium text-foreground">{card.headline}</p>}
        {card.caption && <p className="text-xs text-muted leading-relaxed">{card.caption}</p>}

        {card.bars && card.bars.length > 0 && (
          <ul className="space-y-1.5" aria-label={`${card.title}的分数`}>
            {card.bars.map((bar) => (
              <li key={bar.label} className="flex items-center gap-2 text-xs">
                <span className="w-14 flex-shrink-0 truncate text-muted">{bar.label}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(0, Math.min(100, bar.percent))}%` }}
                  />
                </span>
                <span className="w-9 flex-shrink-0 text-right font-mono tabular-nums text-muted">
                  {bar.standard.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {card.items && card.items.length > 0 && (
          <ul className="space-y-1.5">
            {card.items.map((item, index) => (
              <li key={`${item.title}-${index}`} className="min-w-0">
                <p className="truncate text-sm text-foreground">
                  <span className="mr-1 text-xs text-muted">{index + 1}.</span>
                  {item.title}
                </p>
                {item.subtitle && <p className="truncate text-xs text-muted">{item.subtitle}</p>}
              </li>
            ))}
          </ul>
        )}

        {card.tokens && card.tokens.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {card.tokens.map((token) => (
              <span
                key={token}
                className={`rounded-full px-2 py-0.5 text-xs ${tagColors?.get(token) ?? FALLBACK_TAG_CLASS}`}
              >
                {token}
              </span>
            ))}
          </div>
        )}

        {card.completion && card.completion.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="资料完成度">
            {card.completion.map((item) => (
              <li
                key={item.label}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                  item.done
                    ? "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-gray-100 text-muted dark:bg-gray-800"
                }`}
              >
                {item.label}
                <span aria-hidden>{item.done ? "✓" : "—"}</span>
                <span className="sr-only">{item.done ? "已完成" : "未完成"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!hasDetailButton && card.cta.action !== "none" &&
        (card.cta.href ? (
          // 「去测评 / 继续作答」是跳转：用原生链接，保留新标签页 / 预取等浏览器行为
          <Link
            href={card.cta.href}
            className="inline-flex items-center justify-center self-start rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {card.cta.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onAction(card)}
            aria-controls={card.cta.targetId}
            disabled={card.cta.disabled}
            className="inline-flex items-center justify-center self-start rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {card.cta.label}
          </button>
        ))}
    </section>
  );
}
