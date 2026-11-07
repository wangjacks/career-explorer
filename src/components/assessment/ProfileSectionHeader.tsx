"use client";

/**
 * 档案内分区小标（eyebrow）：琥珀竖条为纯装饰（琥珀不承载小字）；done 省略则不显示角标。
 * 从学生面板页内提取出来（#224），供「职业兴趣测评」等新分区复用同一视觉语言。
 */
export default function ProfileSectionHeader({
  label,
  done,
  marker,
  trailing,
}: {
  label: string;
  done?: boolean;
  /** 填写要求标识：编辑态的两组输入各标一种，两者都要可见（#208） */
  marker?: "required" | "optional";
  /** 右侧自定义内容（如测评完成时间），与 done 二选一 */
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-1 h-4 rounded-full bg-accent" aria-hidden />
      <h2 className="text-sm font-semibold text-foreground">{label}</h2>
      {/* 「必填 / 选填」做成胶囊与右侧的完成度角标同形：文字直读，不用只表意的星号（#208） */}
      {marker && (
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            marker === "required"
              ? "bg-danger-soft text-danger-strong"
              : "bg-gray-100 text-muted dark:bg-gray-800"
          }`}
        >
          {marker === "required" ? "必填" : "选填"}
        </span>
      )}
      {trailing !== undefined && <span className="ml-auto">{trailing}</span>}
      {done !== undefined && (
        <span
          className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${
            done
              ? "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400"
              : "bg-gray-100 text-muted dark:bg-gray-800"
          }`}
        >
          {done ? "✓ 已完成" : "待完成"}
        </span>
      )}
    </div>
  );
}
