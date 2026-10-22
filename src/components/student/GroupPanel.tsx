"use client";

import { UsersRound } from "lucide-react";
import TextAvatar from "@/components/TextAvatar";
import ProfileSectionHeader from "@/components/assessment/ProfileSectionHeader";
import { TAG_CHIP_COLORS } from "@/components/TagSelector";
import type { GroupRoster } from "@/types/student-profile";

/** 我的小组（#101）：本组成员名单，学生只读 */
export default function GroupPanel({
  group,
  loading,
  error,
  tagColorMap,
  onRetry,
}: {
  group: GroupRoster | null;
  loading: boolean;
  error: string | null;
  tagColorMap: Map<string, string>;
  onRetry: () => void;
}) {
  if (loading && !group) {
    return (
      <section className="bg-card rounded-xl border border-border-soft p-5">
        <p className="text-sm text-muted" role="status">
          加载中...
        </p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
        <ProfileSectionHeader label="我的小组" done={false} />
        <p className="text-sm text-danger-strong">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors"
        >
          重试
        </button>
      </section>
    );
  }
  if (!group || !group.grouped) {
    return (
      <section className="bg-card rounded-xl border border-border-soft p-8 text-center space-y-2">
        <UsersRound className="w-8 h-8 text-muted mx-auto" aria-hidden />
        <p className="text-sm text-foreground font-medium">老师还没分组</p>
        <p className="text-xs text-muted">课堂上分组之后回到这里，就能看到本组成员的姓名、学号与标签。</p>
      </section>
    );
  }

  const sourceNames = (group.sources ?? []).map((s) => s.label).join("、");
  return (
    <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <ProfileSectionHeader label="我的小组" />
        <span className="ml-auto text-sm font-semibold text-foreground">
          {group.groupNo === null ? "本组" : `第 ${group.groupNo} 组`} · {group.memberCount} 人
        </span>
      </div>
      {sourceNames && <p className="text-xs text-muted">按{sourceNames}相似度分组，标签由每位同学自己填写</p>}
      <ul className="space-y-3">
        {group.members.map((m) => {
          // 带上源 key：将来注册第二个特征源后，两个源里的同名标签不会撞 React key
          const labels = Object.entries(m.featureLabels).flatMap(([source, values]) =>
            values.map((tag) => ({ key: `${source}:${tag}`, tag }))
          );
          return (
            <li key={m.userId} className="flex items-start gap-3">
              <TextAvatar name={m.name} avatarUrl={m.avatarUrl} storageId={m.storageId} size="md" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{m.name}</span>
                  {m.isMe && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300">
                      我
                    </span>
                  )}
                  <span className="ml-auto flex-shrink-0 font-mono text-xs text-muted">{m.userCode}</span>
                </div>
                {labels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {labels.map(({ key, tag }) => (
                      <span
                        key={key}
                        className={`px-2 py-0.5 rounded-full text-xs ${tagColorMap.get(tag) ?? TAG_CHIP_COLORS[0]}`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
