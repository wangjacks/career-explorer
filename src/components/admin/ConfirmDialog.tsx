"use client";

import type { ReactNode } from "react";

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

export default function ConfirmDialog({
  open, title, message,
  confirmText = "确认", cancelText = "取消",
  variant = "default",
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  const btnClass = {
    danger: "bg-red-500 hover:bg-red-600 text-white focus-visible:ring-red-300",
    warning: "bg-amber-500 hover:bg-amber-600 text-white focus-visible:ring-amber-300",
    default: "bg-green-500 hover:bg-green-600 text-white focus-visible:ring-green-300",
  }[variant];

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4"
      onClick={onCancel}>
      <div className="bg-card rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4 animate-[scale-in_0.15s_ease-out]"
        onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-lg">{title}</h3>
        <div className="text-sm text-gray-600 dark:text-gray-300">{message}</div>
        <div className="flex gap-2 pt-2">
          <button onClick={onCancel}
            className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-300">
            {cancelText}
          </button>
          <button onClick={onConfirm}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 ${btnClass}`}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
