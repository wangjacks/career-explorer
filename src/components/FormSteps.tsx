"use client";

import { Check } from "lucide-react";

const STEPS = ["登录", "标签", "词云", "评价", "形象", "确认", "完成"];

/**
 * 表单流程步骤进度条（7 步）。
 * 当前步高亮 + 已完成步打勾 + 数字伴随（不依赖颜色单独传达）；aria-current 标注当前步。
 */
export default function FormSteps({ current }: { current: number }) {
  return (
    <ol className="flex items-start justify-center px-4" aria-label="表单进度">
      {STEPS.map((label, idx) => {
        const step = idx + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li
            key={label}
            className="flex items-start"
            aria-current={active ? "step" : undefined}
          >
            {idx > 0 && (
              <span
                className={`mt-[9px] w-4 sm:w-8 h-1.5 rounded-full flex-shrink-0 ${
                  step <= current ? "progress-sweep" : "bg-gray-200 dark:bg-gray-700"
                }`}
                aria-hidden
              />
            )}
            <span className="flex flex-col items-center gap-1 px-0.5">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 transition-colors duration-300 ${
                  done
                    ? "bg-primary text-white"
                    : active
                      ? "bg-brand text-white ring-2 ring-accent/60 ring-offset-1"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500"
                }`}
              >
                <span className="sr-only">第 {step} 步，共 {STEPS.length} 步</span>
                {done ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : step}
              </span>
              <span
                className={`text-[10px] sm:text-xs leading-none hidden sm:block ${
                  active
                    ? "text-primary-strong dark:text-green-400 font-medium"
                    : "text-gray-400 dark:text-gray-500"
                }`}
              >
                {label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
