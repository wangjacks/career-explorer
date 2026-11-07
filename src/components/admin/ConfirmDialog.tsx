"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string | ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "default";
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * 强确认：要求对方**亲手输入**这串文本，输入不一致时确认按钮不可点
   * （#101 自动分组用「预期组数」当输入，把「我知道会得到几组」变成一次实际动作）。
   * 加法式扩展：不传时行为与原来完全一致，既有调用方不受影响。
   */
  expectInput?: { label: string; value: string; placeholder?: string };
}

const BTN_CLASS = {
  danger: "bg-danger hover:bg-red-600 text-white focus-visible:ring-red-300",
  warning: "bg-amber-500 hover:bg-amber-600 text-white focus-visible:ring-amber-300",
  default: "bg-primary hover:bg-primary-strong text-white focus-visible:ring-green-300",
};

/**
 * 输入框 + 按钮区单独成组件：它在弹窗关闭时随之卸载，
 * 「每次打开都从空输入开始」因此是挂载语义，不需要在 effect 里重置 state。
 */
function ConfirmFooter({
  variant,
  confirmText,
  cancelText,
  expectInput,
  onConfirm,
  onCancel,
}: {
  variant: "danger" | "warning" | "default";
  confirmText: string;
  cancelText: string;
  expectInput?: { label: string; value: string; placeholder?: string };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const ready = !expectInput || typed.trim() === expectInput.value;

  return (
    <>
      {expectInput && (
        <div>
          <label htmlFor={inputId} className="block text-xs text-muted mb-1">
            {expectInput.label}
          </label>
          <input
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expectInput.placeholder}
            inputMode="numeric"
            autoComplete="off"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring"
          />
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-300"
        >
          {cancelText}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!ready}
          aria-disabled={!ready}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 ${BTN_CLASS[variant]}`}
        >
          {confirmText}
        </button>
      </div>
    </>
  );
}

/** 确认弹窗：dialog 语义 + Escape 关闭 + Tab 焦点捕获/关闭后还原到触发元素 */
export default function ConfirmDialog({
  open, title, message,
  confirmText = "确认", cancelText = "取消",
  variant = "default",
  onConfirm, onCancel,
  expectInput,
}: ConfirmDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevActive = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      prevActive?.focus?.();
    };
  }, [open]);

  useEscapeKey(open, onCancel);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4"
      onClick={onCancel}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-card rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4 outline-none animate-[scale-in_0.15s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="font-semibold text-foreground text-lg">{title}</h3>
        <div className="text-sm text-gray-600 dark:text-gray-300">{message}</div>
        <ConfirmFooter
          variant={variant}
          confirmText={confirmText}
          cancelText={cancelText}
          expectInput={expectInput}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}
