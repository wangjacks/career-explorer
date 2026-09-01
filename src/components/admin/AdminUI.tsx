"use client";

import { useId, type ReactNode } from "react";

export function Field({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  const inputId = useId();
  return (
    <div>
      <label htmlFor={inputId} className="block text-xs text-muted mb-1">{label}</label>
      <input id={inputId} type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring" />
    </div>
  );
}

const colorMap = {
  emerald: {
    bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-600 dark:text-emerald-400",
    bar: "from-emerald-500 to-emerald-400",
    sub: "text-emerald-500 dark:text-emerald-400",
  },
  blue: {
    bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-600 dark:text-blue-400",
    bar: "from-blue-500 to-blue-400",
    sub: "text-blue-500 dark:text-blue-400",
  },
  amber: {
    bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-600 dark:text-amber-400",
    bar: "from-amber-500 to-amber-400",
    sub: "text-amber-500 dark:text-amber-400",
  },
  purple: {
    bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-600 dark:text-purple-400",
    bar: "from-purple-500 to-purple-400",
    sub: "text-purple-500 dark:text-purple-400",
  },
};

export function StatCard({
  label, value, icon, color = "emerald", sub,
}: {
  label: string;
  value: number;
  icon?: ReactNode;
  color?: "emerald" | "blue" | "amber" | "purple";
  sub?: string;
}) {
  const c = colorMap[color];
  return (
    <div className="bg-card rounded-xl border border-border-soft overflow-hidden hover:-translate-y-1 hover:shadow-lg transition-all duration-200 relative shadow-sm">
      {/* Top accent bar */}
      <div className={`h-1 bg-gradient-to-r ${c.bar}`} />
      <div className="p-5">
        <div className="flex items-start justify-between">
          <p className="text-sm font-medium text-muted">{label}</p>
          {icon && (
            <div className={`w-10 h-10 rounded-xl ${c.bg} ${c.text} flex items-center justify-center flex-shrink-0`}>
              {icon}
            </div>
          )}
        </div>
        <p className="text-4xl font-extrabold text-gray-900 dark:text-gray-100 mt-3 tracking-tight">{value}</p>
        {sub && <p className={`text-base font-medium ${c.sub} absolute bottom-3 right-4`}>{sub}</p>}
      </div>
    </div>
  );
}
