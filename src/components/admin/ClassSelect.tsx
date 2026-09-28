"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import {
  firstEnabledIndex,
  lastEnabledIndex,
  nextEnabledIndex,
  selectedIndexFor,
  type SelectableOption,
} from "@/lib/class-select";

/** 「未分班 / 不设置」哨兵 id：与真实班级 id（自增正整数）不冲突 */
export const CLASS_SELECT_EMPTY_ID = -1;

interface ClassSelectProps {
  /**
   * 当前选中的 class_id：
   * - `null` → 选中空值项（未分班 / 不设置）
   * - `undefined` → 尚未选择，显示占位文案且不选中任何项
   */
  value: number | null | undefined;
  onChange: (classId: number | null) => void;
  /** 班级列表（受控传入，避免各入口各拉一份） */
  classes: { id: number; name: string }[];
  /** 是否提供空值项，默认 false */
  allowEmpty?: boolean;
  /** 空值项文案，默认「未分班」 */
  emptyLabel?: string;
  /** 班级列表加载失败且无缓存：面板内展示失败态与重试 */
  loadFailed?: boolean;
  onRetry?: () => void;
  disabled?: boolean;
  /** md：表单 / 弹窗；sm：表格内联编辑 */
  size?: "sm" | "md";
  ariaLabel: string;
  placeholder?: string;
  /** 挂载后聚焦触发按钮（表格内联编辑等场景保持原有「点开即聚焦」体验） */
  autoFocusTrigger?: boolean;
  className?: string;
}

/**
 * 共享班级选择控件（#192）：受控单选，语义为标准 combobox + listbox（#194 方案 A）。
 *
 * 键盘模型（对齐 WAI-ARIA APG 单选 listbox）：
 * - 焦点始终停留在触发按钮（role="combobox"）；选项不是 tab stop（tabIndex=-1），
 *   按下鼠标时 preventDefault 避免夺焦 —— 因此不存在「Tab 逐个走进选项」，
 *   也顺带消除了 ConfirmDialog 焦点陷阱里 N 个选项各占一次 Tab 的循环（#194）。
 * - ↓ / ↑ 移动活动项（跳过 disabled、两端循环），Home / End 跳首末项，
 *   Enter / Space 选中并关闭，Escape 关闭；活动项经 aria-activedescendant 声明。
 * - Tab 关闭面板且不阻止默认行为：一次 Tab 即离开整个下拉区域。
 * - 关闭时焦点保持/还原到触发按钮（关闭即还原）。
 */
export default function ClassSelect({
  value,
  onChange,
  classes,
  allowEmpty = false,
  emptyLabel = "未分班",
  loadFailed = false,
  onRetry,
  disabled = false,
  size = "md",
  ariaLabel,
  placeholder = "请选择班级",
  autoFocusTrigger = false,
  className = "",
}: ClassSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const options = useMemo<SelectableOption[]>(() => {
    const list: SelectableOption[] = [];
    if (allowEmpty) list.push({ id: CLASS_SELECT_EMPTY_ID, name: emptyLabel });
    for (const item of classes) list.push({ id: item.id, name: item.name });
    return list;
  }, [allowEmpty, emptyLabel, classes]);

  const listUnavailable = loadFailed && classes.length === 0;
  const selectedIndex = selectedIndexFor(options, value, CLASS_SELECT_EMPTY_ID);
  const label = selectedIndex >= 0 ? options[selectedIndex].name : placeholder;

  useEffect(() => {
    if (autoFocusTrigger) triggerRef.current?.focus();
  }, [autoFocusTrigger]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const openPanel = () => {
    const initial =
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : firstEnabledIndex(options);
    setActiveIndex(initial);
    setOpen(true);
  };

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.id === CLASS_SELECT_EMPTY_ID ? null : option.id);
    close(true);
  };

  // 点击外部关闭（展开期间才挂监听）
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openPanel();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((current) => nextEnabledIndex(options, current, e.key as "ArrowDown" | "ArrowUp"));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(firstEnabledIndex(options));
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(lastEnabledIndex(options));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        selectOption(activeIndex);
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "Tab":
        // 关闭但不阻止默认行为：一次 Tab 即可离开整个下拉区域
        close();
        break;
      default:
        break;
    }
  };

  const sizeClass = size === "sm" ? "px-2 py-1 rounded text-sm" : "px-3 py-2 rounded-lg text-sm";

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        disabled={disabled}
        onClick={() => (open ? close(true) : openPanel())}
        onKeyDown={handleKeyDown}
        className={`w-full border border-gray-200 dark:border-gray-700 bg-card text-foreground flex items-center justify-between gap-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${sizeClass}`}
      >
        <span className={`truncate ${selectedIndex >= 0 ? "" : "text-muted"}`}>{label}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 flex-shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className="absolute top-full left-0 mt-1 w-full min-w-[10rem] bg-card rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg z-30"
        hidden={!open}
      >
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          className="max-h-44 overflow-y-auto py-1"
        >
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            const isActive = index === activeIndex;
            return (
              <div
                key={option.id}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => {
                  if (!option.disabled) setActiveIndex(index);
                }}
                onClick={() => selectOption(index)}
                className={`px-3 py-1.5 text-sm flex items-center gap-2 select-none ${
                  option.disabled
                    ? "opacity-40 cursor-not-allowed"
                    : isActive
                      ? "bg-primary-soft cursor-pointer"
                      : "cursor-pointer"
                } ${isSelected ? "text-primary" : "text-foreground"}`}
              >
                <span
                  className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 text-xs ${
                    isSelected ? "bg-primary border-primary text-white" : "border-gray-300"
                  }`}
                >
                  {isSelected && "✓"}
                </span>
                <span className="truncate">{option.name}</span>
              </div>
            );
          })}
        </div>
        {listUnavailable && (
          <div className="px-3 py-3 text-center space-y-2 border-t border-border-soft">
            <p className="text-sm text-red-500">班级列表加载失败</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
              >
                重试
              </button>
            )}
          </div>
        )}
        {!listUnavailable && options.length === 0 && (
          <div className="px-3 py-3 text-center text-sm text-muted border-t border-border-soft">暂无班级可选</div>
        )}
      </div>
    </div>
  );
}
