"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { typeColorOf } from "@/lib/assessment-colors";
import { BIG_FIVE_INTRO, RIASEC_INTRO } from "@/lib/assessment-center-content";
import { TEACHER_BOARD_COPY } from "@/lib/dashboard-copy";
import { TEACHER_BOARD_CONTENT, bigFiveTeacherLabel } from "@/lib/teacher-board-content";

export type BoardHelpTab = "riasec" | "bigFive" | "how";

const TAB_ORDER: readonly BoardHelpTab[] = ["riasec", "bigFive", "how"];

/**
 * 说明抽屉「怎么看这份数据」（#315）：三 Tab（兴趣六型 / 人格五项 / 怎么用）。
 *
 * - 正文复用学生端科普（`RIASEC_INTRO` / `BIG_FIVE_INTRO`），教师版只补「第一线怎么用」
 *   与「别怎么用」（`TEACHER_BOARD_CONTENT`），不复制第二份科普；
 * - `role="dialog"` + `aria-modal`、Tab 焦点陷阱、Esc 关闭、关闭后焦点还原；
 *   tablist 支持左右方向键 / Home / End 切换；
 * - 打开与关闭不改变看板的数据范围（纯展示层，不发请求）。
 */
export default function BoardHelpDrawer({
  open,
  initialTab,
  onClose,
}: {
  open: boolean;
  initialTab: BoardHelpTab;
  onClose: () => void;
}) {
  const copy = TEACHER_BOARD_COPY;
  const content = TEACHER_BOARD_CONTENT;
  const titleId = useId();
  const hintId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Partial<Record<BoardHelpTab, HTMLButtonElement | null>>>({});
  const [activeTab, setActiveTab] = useState<BoardHelpTab>(initialTab);

  // WAI-ARIA tabs：键盘切换后焦点跟随选中项
  const selectTab = (next: BoardHelpTab) => {
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  };

  // 打开时回到触发它的那个 Tab（兴趣卡的「六型怎么看？」/ 人格卡的「五项怎么看？」）
  /* eslint-disable react-hooks/set-state-in-effect -- 打开时按入口重置 Tab */
  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 焦点捕获、背景滚动锁与关闭后的焦点还原（与名册弹窗同一套范式）
  useEffect(() => {
    if (!open) return;
    const prevActive = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // 落在真实可聚焦元素上（关闭按钮），避免焦点停在 tabIndex=-1 的 panel 上时 Shift+Tab 逃出弹层
    closeButtonRef.current?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === panelRef.current)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      prevActive?.focus?.();
    };
  }, [open]);

  useEscapeKey(open, onClose);

  if (!open) return null;

  const tabLabels: Record<BoardHelpTab, string> = {
    riasec: copy.helpTabRiasec,
    bigFive: copy.helpTabBigFive,
    how: copy.helpTabHow,
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TAB_ORDER.indexOf(activeTab);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectTab(TAB_ORDER[(index + 1) % TAB_ORDER.length]);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectTab(TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length]);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectTab(TAB_ORDER[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      selectTab(TAB_ORDER[TAB_ORDER.length - 1]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:px-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        tabIndex={-1}
        className="flex h-full w-full flex-col overflow-hidden bg-card shadow-xl outline-none sm:h-auto sm:max-h-[88vh] sm:max-w-3xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border-soft px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">{copy.helpEyebrow}</p>
            <h2 id={titleId} className="mt-1 text-base font-semibold text-foreground">
              {copy.helpTitle}
            </h2>
            <p id={hintId} className="mt-0.5 text-xs text-muted">
              {copy.helpSubtitle}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={copy.helpCloseAria}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring dark:hover:bg-gray-800"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div
          role="tablist"
          aria-label={copy.helpTabsAria}
          className="flex shrink-0 gap-1 border-b border-border-soft px-5"
          onKeyDown={onTabKeyDown}
        >
          {TAB_ORDER.map((tab) => {
            const selected = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`help-tab-${tab}`}
                ref={(node) => {
                  tabRefs.current[tab] = node;
                }}
                aria-selected={selected}
                aria-controls={`help-panel-${tab}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(tab)}
                className={`relative px-3 py-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                  selected ? "text-primary" : "text-muted hover:text-foreground"
                }`}
              >
                {tabLabels[tab]}
                {selected && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" aria-hidden />}
              </button>
            );
          })}
        </div>

        {TAB_ORDER.map((tab) => (
          <div
            key={tab}
            role="tabpanel"
            id={`help-panel-${tab}`}
            aria-labelledby={`help-tab-${tab}`}
            hidden={tab !== activeTab}
            className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          >
            {tab === "riasec" && <RiasecHelpPanel />}
            {tab === "bigFive" && <BigFiveHelpPanel />}
            {tab === "how" && <HowToHelpPanel />}
          </div>
        ))}

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border-soft px-5 py-3">
          <p className="text-[11px] text-muted">{content.footerDisclaimer}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {copy.helpClose}
          </button>
        </footer>
      </div>
    </div>
  );
}

function RiasecHelpPanel() {
  const copy = TEACHER_BOARD_COPY;
  const content = TEACHER_BOARD_CONTENT;
  const example = copy.helpExampleCode;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">{copy.helpRiasecLead}</p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {RIASEC_INTRO.map((item) => {
          const color = typeColorOf(item.key);
          return (
            <li key={item.key} className="rounded-xl border border-border-soft p-3">
              <div className="flex items-center gap-2">
                <span
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
                  style={{ backgroundColor: color.bar, color: color.chipFg }}
                  aria-hidden
                >
                  {item.key}
                </span>
                <p className="text-sm font-semibold text-foreground">{item.label}</p>
                <p className="truncate text-[11px] text-muted">{item.english}</p>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{item.summary}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {item.keywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                <span className="font-medium text-foreground">{copy.helpClassroomLabel}：</span>
                {content.riasecClassroom[item.key]}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="rounded-xl border border-border-soft bg-background p-3">
        <p className="text-xs font-semibold text-foreground">{content.codeHowTo.title}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          {[...example].map((letter, index) => {
            const intro = RIASEC_INTRO.find((item) => item.key === letter);
            const color = typeColorOf(letter);
            return (
              <span key={`${letter}-${index}`} className="flex items-center gap-1">
                {index > 0 && <span className="text-muted" aria-hidden>›</span>}
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
                  style={{ backgroundColor: color.bar, color: color.chipFg }}
                >
                  {letter} {intro?.label ?? ""}
                </span>
              </span>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{content.codeHowTo.body}</p>
      </div>
    </div>
  );
}

function BigFiveHelpPanel() {
  const copy = TEACHER_BOARD_COPY;
  const content = TEACHER_BOARD_CONTENT;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{copy.helpBigFiveLead}</p>
      <ul className="space-y-2">
        {BIG_FIVE_INTRO.map((item) => (
          <li key={item.key} className="rounded-xl border border-border-soft p-3">
            <p className="text-sm font-semibold text-foreground">
              {bigFiveTeacherLabel(item.key, item.label)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{item.summary}</p>
            <div className="mt-1.5 grid grid-cols-1 gap-1 text-[11px] text-muted sm:grid-cols-2">
              <p>
                <span className="font-medium text-foreground">{copy.helpHighLabel}：</span>
                {item.high.join(" · ")}
              </p>
              <p>
                <span className="font-medium text-foreground">{copy.helpLowLabel}：</span>
                {item.low.join(" · ")}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="rounded-xl border border-border-soft bg-background p-3 text-[11px] leading-relaxed text-muted">
        {content.bigFiveBandNote}
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
        {content.crossScaleWarning}
      </div>
    </div>
  );
}

function HowToHelpPanel() {
  const copy = TEACHER_BOARD_COPY;
  const content = TEACHER_BOARD_CONTENT;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">{copy.helpHowLead}</p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {content.howTo.map((item, index) => (
          <li key={item.title} className="rounded-xl border border-border-soft p-3">
            <p className="font-mono text-[11px] text-muted">0{index + 1}</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{item.title}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">{item.body}</p>
          </li>
        ))}
      </ul>
      <div className="rounded-xl border border-border-soft bg-background p-3">
        <p className="text-xs font-semibold text-foreground">{copy.helpConversationTitle}</p>
        <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-muted">
          {content.conversationStarters.map((question) => (
            <li key={question}>「{question}」</li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
        {content.misuseWarning}
      </div>
    </div>
  );
}
