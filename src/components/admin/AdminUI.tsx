"use client";

import type { ReactNode } from "react";

export function Field({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
    </div>
  );
}

const colorMap = {
  emerald: {
    bg: "bg-emerald-100", text: "text-emerald-600",
    bar: "from-emerald-500 to-emerald-400",
    sub: "text-emerald-500",
  },
  blue: {
    bg: "bg-blue-100", text: "text-blue-600",
    bar: "from-blue-500 to-blue-400",
    sub: "text-blue-500",
  },
  amber: {
    bg: "bg-amber-100", text: "text-amber-600",
    bar: "from-amber-500 to-amber-400",
    sub: "text-amber-500",
  },
  purple: {
    bg: "bg-purple-100", text: "text-purple-600",
    bar: "from-purple-500 to-purple-400",
    sub: "text-purple-500",
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
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden hover:-translate-y-1 hover:shadow-lg transition-all duration-200 relative shadow-sm">
      {/* Top accent bar */}
      <div className={`h-1 bg-gradient-to-r ${c.bar}`} />
      <div className="p-5">
        <div className="flex items-start justify-between">
          <p className="text-sm font-medium text-gray-500">{label}</p>
          {icon && (
            <div className={`w-10 h-10 rounded-xl ${c.bg} ${c.text} flex items-center justify-center flex-shrink-0`}>
              {icon}
            </div>
          )}
        </div>
        <p className="text-4xl font-extrabold text-gray-900 mt-3 tracking-tight">{value}</p>
        {sub && <p className={`text-base font-medium ${c.sub} absolute bottom-3 right-4`}>{sub}</p>}
      </div>
    </div>
  );
}
