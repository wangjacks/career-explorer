/**
 * 雷达图懒加载占位（#324）：折叠卡展开时图表 chunk 还没下载完，用固定高度占位避免布局跳动。
 * 纯骨架、不引 recharts，读屏只读一句「图表加载中」。
 */
export default function ChartLoadingPlaceholder() {
  return (
    <div
      className="flex h-[220px] items-center justify-center rounded-lg border border-border-soft bg-background text-xs text-muted"
      role="status"
      aria-label="图表加载中"
    >
      图表加载中…
    </div>
  );
}
