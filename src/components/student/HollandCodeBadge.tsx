"use client";

import { parseTypeCodeParts, describeTypeCode } from "@/lib/assessment-view";

/**
 * 霍兰德三字码徽章（#224）：大字母 + 每枚字母的中文型名。
 * 无码时显示「—」并保留占位高度，避免结果区在数据不完整时塌陷。
 */
export default function HollandCodeBadge({ typeCode }: { typeCode: string | null | undefined }) {
  const parts = parseTypeCodeParts(typeCode);
  const description = describeTypeCode(typeCode);

  return (
    <div className="flex items-center gap-4">
      <div
        className="bg-brand rounded-xl px-4 py-3 text-center flex-shrink-0"
        aria-label={description ? `你的三字码是 ${parts.map((p) => p.key).join(" ")}，对应${description}` : "暂无三字码"}
      >
        <p className="text-2xl sm:text-3xl font-extrabold tracking-[0.2em] text-white leading-none">
          {parts.length > 0 ? parts.map((part) => part.key).join("") : "—"}
        </p>
        <p className="mt-1 text-[11px] text-white/70">你的三字码</p>
      </div>
      <div className="min-w-0">
        {parts.length > 0 ? (
          <ul className="space-y-1">
            {parts.map((part) => (
              <li key={part.key} className="text-sm text-foreground">
                <span className="font-mono font-semibold text-foreground">{part.key}</span>
                <span className="text-muted"> · </span>
                {part.label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">这次结果没有生成三字码</p>
        )}
      </div>
    </div>
  );
}
