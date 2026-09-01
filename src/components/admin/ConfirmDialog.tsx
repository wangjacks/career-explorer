"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
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
}

/** 确认弹窗：dialog 语义 + Escape 关闭 + Tab 焦点捕获/关闭后还原到触发元素 */
export default function ConfirmDialog({
  open, title, message,
  confirmText = "确认", cancelText = "取消",
  variant = "default",
  onConfirm, onCancel,
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

  const btnClass = {
    danger: "bg-red-500 hover:bg-red-600 text-white focus-visible:ring-red-300",
    warning: "bg-amber-500 hover:bg-amber-600 text-white focus-visible:ring-amber-300",
    default: "bg-green-500 hover:bg-green-600 text-white focus-visible:ring-green-300",
  }[variant];

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
        <h3 id={titleId} className="font-semibold text-gray-800 dark:text-gray-100 text-lg">{title}</h3>
        <div className="text-sm text-gray-600 dark:text-gray-300">{message}</div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onCancel}
            className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-300">
            {cancelText}
          </button>
          <button type="button" onClick={onConfirm}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 ${btnClass}`}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
