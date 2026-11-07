"use client";

interface EvaluationTextsProps {
  texts: string[];
  /** 默认折叠；详情页可传 false 直接展开 */
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

/** 三条他人评价原文（#162）：匿名顺序展示，保留换行 */
export default function EvaluationTexts({
  texts,
  collapsible = true,
  defaultOpen = false,
  className = "",
}: EvaluationTextsProps) {
  const filled = texts
    .map((text, index) => ({ text: text.trim(), index }))
    .filter((item) => item.text.length > 0);
  if (filled.length === 0) return null;

  const list = (
    <ol className="space-y-2">
      {filled.map((item) => (
        <li key={item.index} className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
          <p className="text-[11px] font-medium text-muted">评价{item.index + 1}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200">
            {item.text}
          </p>
        </li>
      ))}
    </ol>
  );

  if (!collapsible) {
    return <div className={className}>{list}</div>;
  }

  return (
    <details className={className} open={defaultOpen}>
      <summary className="cursor-pointer select-none text-xs font-medium text-muted hover:text-foreground">
        查看三条评价原文（{filled.length}）
      </summary>
      <div className="mt-2">{list}</div>
    </details>
  );
}
