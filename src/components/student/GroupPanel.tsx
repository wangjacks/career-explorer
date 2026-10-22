"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Clock,
  Crown,
  History,
  ListTodo,
  Megaphone,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Trash2,
  UsersRound,
} from "lucide-react";
import TextAvatar from "@/components/TextAvatar";
import ProfileSectionHeader from "@/components/assessment/ProfileSectionHeader";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { TAG_CHIP_COLORS } from "@/components/TagSelector";
import { taskProgress, type TaskProgress } from "@/lib/group-workspace";

/* ---------- 接口形状（与 /api/shared/group* 对应） ---------- */

interface GroupMember {
  userId: number;
  userCode: string;
  name: string;
  avatarUrl: string | null;
  storageId: number;
  isMe: boolean;
  isLeader: boolean;
  tags: string[];
}

interface GroupData {
  grouped: boolean;
  groupNo: number | null;
  memberCount: number;
  batch: { id: number; strategy: string; strategyLabel: string; createdAt: string } | null;
  workspace: { id: number; title: string; createdAt: string } | null;
  unreadCount: number;
  canManage: boolean;
  commonInterests: string[];
  interestCoverage: { covered: number; total: number; tested: number } | null;
  members: GroupMember[];
}

interface GroupPost {
  id: number;
  title: string;
  content: string;
  authorName: string | null;
  authorRole: string | null;
  pinned: boolean;
  createdAt: string;
}

interface GroupTask {
  id: number;
  title: string;
  description: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  status: "open" | "in_progress" | "done";
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
  overdue: boolean;
}

interface HistoryWorkspace {
  workspaceId: number;
  batchId: number;
  batchCreatedAt: string;
  groupNo: number;
  title: string;
  isCurrent: boolean;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmText: string;
  variant: "danger" | "warning" | "default";
  onConfirm: () => void;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-border-soft bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";

const STATUS_META: Record<GroupTask["status"], { label: string; className: string }> = {
  open: {
    label: "待认领",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  in_progress: {
    label: "进行中",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  },
  done: {
    label: "已完成",
    className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
};

function when(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length >= 16 ? value.slice(0, 16) : value;
}

/**
 * 学生端「我的小组」（#346）：分组依据、共同兴趣、兴趣覆盖（聚合）、成员、公告、任务，
 * 以及按批次回看历史工作区。测评分数 / 三字码 / 人格维度一律不在这里出现。
 */
export default function GroupPanel({
  tagColorMap,
  onUnreadChange,
}: {
  tagColorMap: Map<string, string>;
  onUnreadChange?: (count: number) => void;
}) {
  const [group, setGroup] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [posts, setPosts] = useState<GroupPost[]>([]);
  const [tasks, setTasks] = useState<GroupTask[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryWorkspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  const [showPostForm, setShowPostForm] = useState(false);
  const [postTitle, setPostTitle] = useState("");
  const [postContent, setPostContent] = useState("");
  const [posting, setPosting] = useState(false);

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const loadContent = useCallback(async (workspaceId: number | null) => {
    setContentLoading(true);
    setContentError(null);
    try {
      const query = workspaceId === null ? "" : `?workspaceId=${workspaceId}`;
      const [postsRes, tasksRes] = await Promise.all([
        fetch(`/api/shared/group/posts${query}`),
        fetch(`/api/shared/group/tasks${query}`),
      ]);
      const [postsData, tasksData] = await Promise.all([postsRes.json(), tasksRes.json()]);
      if (!postsRes.ok) throw new Error(postsData.error || "公告加载失败");
      if (!tasksRes.ok) throw new Error(tasksData.error || "任务加载失败");
      setPosts(Array.isArray(postsData.posts) ? postsData.posts : []);
      setTasks(Array.isArray(tasksData.tasks) ? tasksData.tasks : []);
      setReadOnly(Boolean(postsData.readOnly || tasksData.readOnly));
    } catch (err) {
      console.error("Failed to load group content:", err);
      setContentError(err instanceof Error ? err.message : "公告与任务加载失败");
    } finally {
      setContentLoading(false);
    }
  }, []);

  const loadGroup = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shared/group");
      const data = await res.json();
      if (res.status === 401 || res.status === 403) {
        setGroup(null);
        setError("登录状态已失效，请重新登录");
        return;
      }
      if (!res.ok) throw new Error(data.error || "本组信息加载失败");
      setGroup(data as GroupData);
      onUnreadChange?.(Number(data.unreadCount) || 0);
      setSelectedWorkspaceId(null);
      if (data.workspace) {
        await loadContent(null);
        // 进入小组视图即视为读过当前公告：红点清零（水位由服务端持久化）
        await fetch("/api/shared/group/read", { method: "POST" }).catch(() => null);
        onUnreadChange?.(0);
      }
      // 历史批次只在有工作区时才有回看意义
      if (data.workspace) {
        const historyRes = await fetch("/api/shared/group/history");
        if (historyRes.ok) {
          const historyData = await historyRes.json();
          setHistory(Array.isArray(historyData.workspaces) ? historyData.workspaces : []);
        }
      } else {
        setHistory([]);
      }
    } catch (err) {
      console.error("Failed to load group:", err);
      setGroup(null);
      setError(err instanceof Error ? err.message : "本组信息加载失败");
    } finally {
      setLoading(false);
    }
  }, [loadContent, onUnreadChange]);

  /* eslint-disable react-hooks/set-state-in-effect -- 进入小组视图时按当前批次加载，加载态在 effect 内同步置位 */
  useEffect(() => {
    void loadGroup();
  }, [loadGroup]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selectWorkspace = async (value: string) => {
    const workspaceId = value === "current" ? null : Number(value);
    setSelectedWorkspaceId(workspaceId);
    await loadContent(workspaceId);
  };

  const progress = useMemo<TaskProgress>(() => taskProgress(tasks), [tasks]);

  if (loading) {
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
          onClick={() => void loadGroup()}
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
        <p className="text-xs text-muted">课堂上分组之后回到这里，就能看到本组的共同兴趣、公告与任务。</p>
      </section>
    );
  }

  const canManage = group.canManage && !readOnly;
  const memberOptions = group.members;

  const submitPost = async () => {
    setPosting(true);
    try {
      const res = await fetch("/api/shared/group/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: postTitle, content: postContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "公告发布失败");
      toast.success("公告已发布");
      setPostTitle("");
      setPostContent("");
      setShowPostForm(false);
      await loadContent(selectedWorkspaceId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "公告发布失败");
    } finally {
      setPosting(false);
    }
  };

  const submitTask = async () => {
    setCreatingTask(true);
    try {
      const res = await fetch("/api/shared/group/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: taskTitle,
          description: taskDescription,
          dueAt: taskDueAt,
          assigneeId: taskAssignee ? Number(taskAssignee) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "任务创建失败");
      toast.success("任务已创建");
      setTaskTitle("");
      setTaskDescription("");
      setTaskDueAt("");
      setTaskAssignee("");
      setShowTaskForm(false);
      await loadContent(selectedWorkspaceId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "任务创建失败");
    } finally {
      setCreatingTask(false);
    }
  };

  const runTaskAction = async (task: GroupTask, action: "claim" | "complete") => {
    setBusyId(`task-${task.id}`);
    try {
      const res = await fetch(`/api/shared/group/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "任务操作失败");
      toast.success(action === "claim" ? "已认领任务" : "任务已完成");
      await loadContent(selectedWorkspaceId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "任务操作失败");
    } finally {
      setBusyId(null);
    }
  };

  const askDeleteTask = (task: GroupTask) => {
    setConfirm({
      title: "删除任务",
      message: `确定删除「${task.title}」吗？删除后组员将不再看到该任务。`,
      confirmText: "删除",
      variant: "danger",
      onConfirm: () => void softDeleteTask(task),
    });
  };

  const softDeleteTask = async (task: GroupTask) => {
    setBusyId(`task-${task.id}`);
    try {
      const res = await fetch(`/api/shared/group/tasks/${task.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "任务删除失败");
      toast.success("任务已删除");
      await loadContent(selectedWorkspaceId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "任务删除失败");
    } finally {
      setBusyId(null);
    }
  };

  const togglePin = async (post: GroupPost) => {
    setBusyId(`post-${post.id}`);
    try {
      const res = await fetch(`/api/shared/group/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !post.pinned }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "公告操作失败");
      toast.success(post.pinned ? "已取消置顶" : "已置顶");
      await loadContent(selectedWorkspaceId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "公告操作失败");
    } finally {
      setBusyId(null);
    }
  };

  const askPin = (post: GroupPost) => {
    setConfirm({
      title: post.pinned ? "取消置顶" : "置顶公告",
      message: post.pinned
        ? `确定把「${post.title}」取消置顶吗？`
        : `确定把「${post.title}」置顶吗？置顶公告会排在最前面。`,
      confirmText: post.pinned ? "取消置顶" : "置顶",
      variant: "warning",
      onConfirm: () => void togglePin(post),
    });
  };

  const softDeletePost = async (post: GroupPost) => {
    setBusyId(`post-${post.id}`);
    try {
      const res = await fetch(`/api/shared/group/posts/${post.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "公告删除失败");
      toast.success("公告已删除");
      await loadContent(selectedWorkspaceId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "公告删除失败");
    } finally {
      setBusyId(null);
    }
  };

  const askDeletePost = (post: GroupPost) => {
    setConfirm({
      title: "删除公告",
      message: `确定删除「${post.title}」吗？删除后组员将不再看到该公告。`,
      confirmText: "删除",
      variant: "danger",
      onConfirm: () => void softDeletePost(post),
    });
  };

  return (
    <div className="space-y-5">
      {/* 概览卡：分组依据 / 生成时间 / 工作区说明 */}
      <section className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <ProfileSectionHeader label="我的小组" />
          <span className="ml-auto text-sm font-semibold text-foreground">
            {group.groupNo === null ? "本组" : `第 ${group.groupNo} 组`} · {group.memberCount} 人
          </span>
        </div>
        {group.batch ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="px-2 py-0.5 rounded-full bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300">
              {group.batch.strategyLabel}
            </span>
            <span>生成于 {when(group.batch.createdAt)}</span>
            <span>批次 #{group.batch.id}</span>
          </div>
        ) : (
          <p className="text-xs text-muted">老师手工调整的分组（未生成批次依据）。</p>
        )}
        <p className="text-xs text-muted leading-relaxed">
          分组由老师按{group.batch ? `「${group.batch.strategyLabel}」` : "课堂安排"}搭配；
          具体测评结果不会展示给同学，这里只展示组长、成员与大家自己填写的标签。
        </p>
        {group.workspace ? (
          <p className="text-xs text-muted leading-relaxed">
            公告和任务只属于本批次的工作区。重新分组后会开启新工作区，旧批次的公告与任务仍可回看。
          </p>
        ) : (
          <p className="text-xs text-muted leading-relaxed">老师应用分组后，这里会开启公告与任务。</p>
        )}
      </section>

      {/* 共同兴趣 + 兴趣覆盖（聚合，不指向个人） */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <section className="bg-card rounded-xl border border-border-soft p-5 space-y-2">
          <h2 className="text-sm font-semibold text-foreground">共同兴趣</h2>
          {group.commonInterests.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {group.commonInterests.map((tag) => (
                <span
                  key={tag}
                  className={`px-2 py-0.5 rounded-full text-xs ${tagColorMap.get(tag) ?? TAG_CHIP_COLORS[0]}`}
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">还没有至少两位同学共有的兴趣标签。</p>
          )}
        </section>
        <section className="bg-card rounded-xl border border-border-soft p-5 space-y-2">
          <h2 className="text-sm font-semibold text-foreground">组内兴趣覆盖</h2>
          {group.interestCoverage ? (
            group.interestCoverage.tested > 0 ? (
              <>
                <p className="text-sm font-semibold text-foreground">
                  {group.interestCoverage.covered}/{group.interestCoverage.total} 型
                  <span className="ml-2 text-xs font-normal text-muted">
                    已测 {group.interestCoverage.tested} 人
                  </span>
                </p>
                <div className="flex gap-1.5" aria-hidden>
                  {Array.from({ length: group.interestCoverage.total }).map((_, index) => (
                    <span
                      key={index}
                      className={`h-1.5 flex-1 rounded-full ${
                        index < group.interestCoverage!.covered
                          ? "bg-primary"
                          : "bg-gray-200 dark:bg-gray-700"
                      }`}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-muted">只统计已有兴趣测评结果的同学，不指向个人。</p>
              </>
            ) : (
              <p className="text-xs text-muted">组内还没有同学完成兴趣测评。</p>
            )
          ) : (
            <p className="text-xs text-muted">兴趣测评结果暂不可用，稍后再看。</p>
          )}
        </section>
      </div>

      {/* 成员（学号序、我、组长徽章、仅标签） */}
      <section className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">组员</h2>
        <ul className="space-y-3">
          {group.members.map((member) => (
            <li key={member.userId} className="flex items-start gap-3">
              <TextAvatar
                name={member.name}
                avatarUrl={member.avatarUrl}
                storageId={member.storageId}
                size="md"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{member.name}</span>
                  {member.isMe && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300">
                      我
                    </span>
                  )}
                  {member.isLeader && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                      <Crown className="w-3 h-3" aria-hidden />
                      组长
                    </span>
                  )}
                  <span className="ml-auto flex-shrink-0 font-mono text-xs text-muted">{member.userCode}</span>
                </div>
                {member.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {member.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`px-2 py-0.5 rounded-full text-xs ${tagColorMap.get(tag) ?? TAG_CHIP_COLORS[0]}`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {group.workspace ? (
        <>
          {/* 批次切换：历史批次只读回看 */}
          {history.length > 1 && (
            <section className="bg-card rounded-xl border border-border-soft p-4 flex items-center gap-3">
              <History className="w-4 h-4 text-muted flex-shrink-0" aria-hidden />
              <label htmlFor="group-workspace-select" className="text-xs text-muted flex-shrink-0">
                查看批次
              </label>
              <select
                id="group-workspace-select"
                value={selectedWorkspaceId === null ? "current" : String(selectedWorkspaceId)}
                onChange={(event) => void selectWorkspace(event.target.value)}
                className="flex-1 min-w-0 rounded-lg border border-border-soft bg-background px-2 py-1.5 text-sm text-foreground"
              >
                <option value="current">当前批次（第 {group.groupNo} 组）</option>
                {history
                  .filter((item) => !item.isCurrent)
                  .map((item) => (
                    <option key={item.workspaceId} value={item.workspaceId}>
                      历史批次 #{item.batchId} · {when(item.batchCreatedAt)} · 第 {item.groupNo} 组
                    </option>
                  ))}
              </select>
            </section>
          )}

          {readOnly && (
            <p className="text-xs text-muted rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
              你在查看历史批次工作区，公告与任务只能回看，不能修改。
            </p>
          )}

          {/* 公告 */}
          <section className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Megaphone className="w-4 h-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold text-foreground">公告</h2>
              {group.unreadCount > 0 && !readOnly && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-danger text-white">
                  {group.unreadCount > 99 ? "99+" : group.unreadCount} 条未读
                </span>
              )}
              {canManage && !showPostForm && (
                <button
                  type="button"
                  onClick={() => setShowPostForm(true)}
                  className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-strong text-white text-xs font-medium transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden />
                  发布公告
                </button>
              )}
            </div>

            {showPostForm && canManage && (
              <div className="rounded-lg border border-border-soft p-3 space-y-2">
                <label className="block text-xs text-muted">
                  标题
                  <input
                    value={postTitle}
                    onChange={(event) => setPostTitle(event.target.value)}
                    maxLength={40}
                    className={`mt-1 ${INPUT_CLASS}`}
                    placeholder="例如：周五第 3 节课后集合"
                  />
                </label>
                <label className="block text-xs text-muted">
                  内容
                  <textarea
                    value={postContent}
                    onChange={(event) => setPostContent(event.target.value)}
                    maxLength={1000}
                    rows={3}
                    className={`mt-1 ${INPUT_CLASS}`}
                    placeholder="写下时间、地点或需要大家提前准备的事项"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted ml-auto">
                    {postContent.length}/1000
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPostForm(false);
                      setPostTitle("");
                      setPostContent("");
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs text-muted hover:text-foreground"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitPost()}
                    disabled={posting || !postTitle.trim() || !postContent.trim()}
                    className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-xs font-medium"
                  >
                    {posting ? "发布中..." : "发布"}
                  </button>
                </div>
              </div>
            )}

            {contentLoading && posts.length === 0 ? (
              <p className="text-sm text-muted">加载中...</p>
            ) : contentError ? (
              <p className="text-sm text-danger-strong">{contentError}</p>
            ) : posts.length === 0 ? (
              <p className="text-xs text-muted">还没有公告。组长可以发布第一条小组公告。</p>
            ) : (
              <ul className="space-y-2">
                {posts.map((post) => (
                  <li key={post.id} className="rounded-lg border border-border-soft p-3 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {post.pinned && (
                        <Pin className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" aria-label="置顶" />
                      )}
                      <span className="text-sm font-medium text-foreground break-words">{post.title}</span>
                      <span className="ml-auto text-[11px] text-muted">
                        {post.authorName ?? "老师"} · {when(post.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted whitespace-pre-wrap break-words">{post.content}</p>
                    {canManage && (
                      <div className="flex items-center gap-1 pt-1">
                        <button
                          type="button"
                          onClick={() => askPin(post)}
                          disabled={busyId === `post-${post.id}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted hover:text-foreground disabled:opacity-50"
                        >
                          {post.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                          {post.pinned ? "取消置顶" : "置顶"}
                        </button>
                        <button
                          type="button"
                          onClick={() => askDeletePost(post)}
                          disabled={busyId === `post-${post.id}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-danger-strong hover:bg-danger/10 disabled:opacity-50"
                        >
                          <Trash2 className="w-3 h-3" />
                          删除
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 任务 */}
          <section className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <ListTodo className="w-4 h-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold text-foreground">任务</h2>
              {tasks.length > 0 && (
                <span className="text-[11px] text-muted">
                  {progress.done}/{progress.total} 已完成
                </span>
              )}
              {canManage && !showTaskForm && (
                <button
                  type="button"
                  onClick={() => setShowTaskForm(true)}
                  className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-strong text-white text-xs font-medium transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden />
                  新建任务
                </button>
              )}
            </div>

            {tasks.length > 0 && (
              <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden" aria-hidden>
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            )}

            {showTaskForm && canManage && (
              <div className="rounded-lg border border-border-soft p-3 space-y-2">
                <label className="block text-xs text-muted">
                  任务标题
                  <input
                    value={taskTitle}
                    onChange={(event) => setTaskTitle(event.target.value)}
                    maxLength={60}
                    className={`mt-1 ${INPUT_CLASS}`}
                    placeholder="例如：整理小组展示的 PPT"
                  />
                </label>
                <label className="block text-xs text-muted">
                  说明（选填）
                  <textarea
                    value={taskDescription}
                    onChange={(event) => setTaskDescription(event.target.value)}
                    maxLength={500}
                    rows={2}
                    className={`mt-1 ${INPUT_CLASS}`}
                    placeholder="交付物、注意事项等"
                  />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="block text-xs text-muted">
                    截止时间（选填）
                    <input
                      type="datetime-local"
                      value={taskDueAt}
                      onChange={(event) => setTaskDueAt(event.target.value)}
                      className={`mt-1 ${INPUT_CLASS}`}
                    />
                  </label>
                  <label className="block text-xs text-muted">
                    指派给（选填）
                    <select
                      value={taskAssignee}
                      onChange={(event) => setTaskAssignee(event.target.value)}
                      className={`mt-1 ${INPUT_CLASS}`}
                    >
                      <option value="">留待认领</option>
                      {memberOptions.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowTaskForm(false);
                      setTaskTitle("");
                      setTaskDescription("");
                      setTaskDueAt("");
                      setTaskAssignee("");
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs text-muted hover:text-foreground"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitTask()}
                    disabled={creatingTask || !taskTitle.trim()}
                    className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-xs font-medium"
                  >
                    {creatingTask ? "创建中..." : "创建"}
                  </button>
                </div>
              </div>
            )}

            {contentLoading && tasks.length === 0 ? (
              <p className="text-sm text-muted">加载中...</p>
            ) : contentError ? (
              <p className="text-sm text-danger-strong">{contentError}</p>
            ) : tasks.length === 0 ? (
              <p className="text-xs text-muted">还没有任务。组长可以新建一个待认领任务。</p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((task) => {
                  const meta = STATUS_META[task.status];
                  const canClaim = !readOnly && task.status === "open" && task.assigneeId === null;
                  const canComplete =
                    !readOnly &&
                    task.status === "in_progress" &&
                    (canManage || task.assigneeId === myUserId(group));
                  return (
                    <li key={task.id} className="rounded-lg border border-border-soft p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.className}`}>
                          {meta.label}
                        </span>
                        <span className="text-sm font-medium text-foreground break-words">{task.title}</span>
                        {task.overdue && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                            已逾期
                          </span>
                        )}
                      </div>
                      {task.description && (
                        <p className="text-xs text-muted whitespace-pre-wrap break-words">{task.description}</p>
                      )}
                      <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted">
                        <span className="inline-flex items-center gap-1">
                          <UsersRound className="w-3 h-3" aria-hidden />
                          {task.assigneeName ?? "待认领"}
                        </span>
                        <span className={`inline-flex items-center gap-1 ${task.overdue ? "text-danger-strong" : ""}`}>
                          <Clock className="w-3 h-3" aria-hidden />
                          截止 {when(task.dueAt)}
                        </span>
                        <span className="ml-auto flex items-center gap-1">
                          {canClaim && (
                            <button
                              type="button"
                              onClick={() => void runTaskAction(task, "claim")}
                              disabled={busyId === `task-${task.id}`}
                              className="px-2 py-1 rounded bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300 text-[11px] font-medium disabled:opacity-50"
                            >
                              认领
                            </button>
                          )}
                          {canComplete && (
                            <button
                              type="button"
                              onClick={() => void runTaskAction(task, "complete")}
                              disabled={busyId === `task-${task.id}`}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-primary text-white text-[11px] font-medium disabled:opacity-50"
                            >
                              <Check className="w-3 h-3" aria-hidden />
                              标记完成
                            </button>
                          )}
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => askDeleteTask(task)}
                              disabled={busyId === `task-${task.id}`}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-danger-strong hover:bg-danger/10 disabled:opacity-50"
                            >
                              <Trash2 className="w-3 h-3" aria-hidden />
                              删除
                            </button>
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className="bg-card rounded-xl border border-border-soft p-5">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-muted" aria-hidden />
            <p className="text-xs text-muted">老师应用分组后，公告与任务会在这里开启。</p>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmText={confirm?.confirmText}
        variant={confirm?.variant}
        onConfirm={() => {
          confirm?.onConfirm();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/** 当前用户 id（从成员列表里取 isMe） */
function myUserId(group: GroupData): number | null {
  return group.members.find((member) => member.isMe)?.userId ?? null;
}
