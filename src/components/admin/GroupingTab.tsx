"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, Layers, Lock, RefreshCw, TriangleAlert, Users } from "lucide-react";
import ClassSelect from "./ClassSelect";
import TextAvatar from "@/components/TextAvatar";
import { GROUP_SIZE_CAP } from "@/lib/grouping-utils";

interface MemberView {
  userId: number;
  userCode: string;
  name: string;
  avatarUrl: string | null;
  storageId: number;
  featureLabels: Record<string, string[]>;
}

interface GroupView {
  groupNo: number;
  memberCount: number;
  cohesion: number | null;
  members: MemberView[];
}

interface GroupingView {
  hasGrouping: boolean;
  studentCount: number;
  coveredCount: number;
  nonZeroPairs: number;
  totalPairs: number;
  overall: number;
  baselines: { sequence: number; random: number };
  activeSourceKeys: string[];
  sources: { key: string; label: string; kind: string }[];
  groups: GroupView[];
  latestBatch: {
    id: number;
    createdAt: string;
    strategy: string;
    studentCount: number;
    taggedCount: number;
    createdByName: string | null;
    metrics: { overall?: number } | null;
  } | null;
  diffCount: number;
}

interface BatchItem {
  id: number;
  strategy: string;
  groupSize: number;
  studentCount: number;
  taggedCount: number;
  createdAt: string;
  createdByName: string | null;
  metrics: string | null;
}

interface BatchDetailGroup {
  groupNo: number;
  cohesion: number | null;
  memberCount: number;
  members: { userId: number; userCode: string | null; name: string | null }[];
}

interface BatchDetail {
  batch: {
    id: number;
    studentCount: number;
    taggedCount: number;
    createdAt: string;
    createdByName: string | null;
    metrics: string | null;
  };
  groups: BatchDetailGroup[];
}

interface ClassItem {
  id: number;
  name: string;
}

interface TeacherClassPair {
  teacher_id: number;
  class_id: number;
}

type Segment = "current" | "history";

/** 批次的 metrics 是入库的 JSON 文本，界面只取整体目标值，解析失败就什么都不显示 */
function overallOf(metrics: string | null): string | null {
  if (!metrics) return null;
  try {
    const parsed = JSON.parse(metrics) as { overall?: number };
    return typeof parsed.overall === "number" ? parsed.overall.toFixed(2) : null;
  } catch {
    return null;
  }
}

/**
 * 课堂分组（#101）：管理端与教师端共用。
 * 读不限班级（教师可看全校名单），非你创建的班级标注「只读」。
 */
export default function GroupingTab({
  mode,
  teacherUid,
}: {
  mode: "admin" | "teacher";
  teacherUid?: number | null;
}) {
  const [classList, setClassList] = useState<ClassItem[]>([]);
  const [pairs, setPairs] = useState<TeacherClassPair[]>([]);
  const [classesFailed, setClassesFailed] = useState(false);

  const [classId, setClassId] = useState<number | undefined>(undefined);
  const [segment, setSegment] = useState<Segment>("current");

  const [view, setView] = useState<GroupingView | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [batchDetail, setBatchDetail] = useState<BatchDetail | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // 请求序号：快速切换班级时丢弃过期响应（旧班级的数据不能盖到新班级上）
  const seqRef = useRef(0);
  const detailSeqRef = useRef(0);

  const refreshClasses = useCallback(async () => {
    try {
      const res = await fetch("/api/manage/classes");
      if (!res.ok) {
        setClassesFailed(true);
        return;
      }
      const data = await res.json();
      setClassList(data.data || []);
      setPairs(data.teacher_classes || []);
      setClassesFailed(false);
    } catch (err) {
      console.error("班级列表加载失败:", err);
      setClassesFailed(true);
    }
  }, []);

  const loadView = useCallback(async (id: number) => {
    const seq = ++seqRef.current;
    // 立即清空上一个班级的数据：在途期间不能让旧名单顶着新班级名显示
    setView(null);
    setBatches([]);
    setViewLoading(true);
    setViewError(null);
    setBatchesError(null);
    try {
      const [groupsRes, batchesRes] = await Promise.all([
        fetch(`/api/manage/groups?classId=${id}`),
        fetch(`/api/manage/groups/batches?classId=${id}`),
      ]);
      const groupsData = await groupsRes.json();
      if (seq !== seqRef.current) return;
      if (!groupsRes.ok) {
        setView(null);
        setViewError(groupsData.error || "分组数据加载失败");
      } else {
        setView(groupsData as GroupingView);
      }
      const batchesData = await batchesRes.json();
      if (seq !== seqRef.current) return;
      if (!batchesRes.ok) {
        setBatches([]);
        setBatchesError(batchesData.error || "历史批次加载失败");
      } else {
        setBatches(batchesData.data || []);
        setBatchesError(null);
      }
    } catch (err) {
      if (seq !== seqRef.current) return;
      console.error("分组数据加载失败:", err);
      setView(null);
      setViewError("分组数据加载失败");
      setBatchesError("历史批次加载失败");
    } finally {
      if (seq === seqRef.current) setViewLoading(false);
    }
  }, []);

  const loadBatchDetail = useCallback(async (id: number) => {
    const seq = ++detailSeqRef.current;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(`/api/manage/groups/batches/${id}`);
      const data = await res.json();
      if (seq !== detailSeqRef.current) return;
      if (!res.ok) {
        setBatchDetail(null);
        setDetailError(data.error || "批次明细加载失败");
      } else {
        setBatchDetail(data as BatchDetail);
      }
    } catch (err) {
      if (seq !== detailSeqRef.current) return;
      console.error("批次明细加载失败:", err);
      setBatchDetail(null);
      setDetailError("批次明细加载失败");
    } finally {
      if (seq === detailSeqRef.current) setDetailLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- 挂载时拉班级列表 */
  useEffect(() => {
    void refreshClasses();
  }, [refreshClasses]);

  // 换班级：当前分组与历史批次一起重取（明细的重置在班级选择回调里做，不在 effect 中改 state）
  useEffect(() => {
    if (classId == null) return;
    void loadView(classId);
  }, [classId, loadView]);

  useEffect(() => {
    if (selectedBatchId == null) return;
    void loadBatchDetail(selectedBatchId);
  }, [selectedBatchId, loadBatchDetail]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const canModify = useMemo(() => {
    if (mode === "admin") return true;
    if (classId == null || teacherUid == null) return false;
    return pairs.some((p) => p.class_id === classId && p.teacher_id === teacherUid);
  }, [mode, classId, teacherUid, pairs]);

  // 班级归属关系没拿到（列表加载失败等）时不能断言「只读」，否则教师自建班会被误标
  const ownershipKnown =
    mode === "admin" || (!classesFailed && teacherUid != null && classList.length > 0);

  const sourceNames = useMemo(
    () => (view?.sources ?? []).map((s) => s.label).join("、"),
    [view]
  );

  const selectedClassName = classId == null ? "" : classList.find((c) => c.id === classId)?.name ?? "";

  return (
    <div className="space-y-5">
      {/* 班级选择 + 归属标注 */}
      <div className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Layers size={16} className="text-muted" aria-hidden />
          <h2 className="font-semibold text-foreground">课堂分组</h2>
          {!canModify && ownershipKnown && classId != null && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-danger-soft text-danger-strong">
              <Lock size={12} aria-hidden />
              只读（非你创建的班级）
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ClassSelect
            ariaLabel="选择班级"
            value={classId}
            onChange={(id) => {
              setClassId(id ?? undefined);
              // 换班级即换上下文：上一个班级的批次明细不能挂在当前界面下
              setSelectedBatchId(null);
              setBatchDetail(null);
            }}
            classes={classList}
            loadFailed={classesFailed}
            onRetry={refreshClasses}
            placeholder="请选择班级"
            className="min-w-[12rem]"
          />
          <button
            type="button"
            onClick={() => classId != null && void loadView(classId)}
            disabled={classId == null || viewLoading}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-700 dark:text-gray-200 dark:hover:bg-gray-800 text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-1.5"
          >
            <RefreshCw size={14} className={viewLoading ? "animate-spin" : ""} aria-hidden />
            刷新
          </button>
        </div>
      </div>

      {classId == null ? (
        <div className="bg-card rounded-xl border border-border-soft p-8 text-center space-y-2">
          <Users className="w-8 h-8 text-muted mx-auto" aria-hidden />
          <p className="text-sm text-foreground font-medium">先选择一个班级</p>
          <p className="text-xs text-muted">选定后可查看该班的分组名单与历史批次。</p>
        </div>
      ) : (
        <>
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
            <button
              type="button"
              onClick={() => setSegment("current")}
              aria-pressed={segment === "current"}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                segment === "current"
                  ? "bg-card text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              当前分组
              {view ? <span className="ml-1 text-xs">{view.groups.length} 组</span> : null}
            </button>
            <button
              type="button"
              onClick={() => setSegment("history")}
              aria-pressed={segment === "history"}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                segment === "history"
                  ? "bg-card text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              历史批次
              {batches.length > 0 ? <span className="ml-1 text-xs">{batches.length} 次</span> : null}
            </button>
          </div>

          {segment === "current" ? (
            <CurrentPanel
              classLabel={selectedClassName}
              view={view}
              loading={viewLoading}
              error={viewError}
              sourceNames={sourceNames}
              onRetry={() => void loadView(classId)}
            />
          ) : (
            <HistoryPanel
              classLabel={selectedClassName}
              sourceNames={sourceNames}
              loading={viewLoading}
              batches={batches}
              batchesError={batchesError}
              selectedBatchId={selectedBatchId}
              detail={batchDetail}
              detailLoading={detailLoading}
              detailError={detailError}
              onRetryList={() => void loadView(classId)}
              onSelect={(id) => {
                // 先清掉上一批次的明细与错误，否则新批次加载期间会挂着旧批次的内容
                setBatchDetail(null);
                setDetailError(null);
                setSelectedBatchId(id);
              }}
              onRetryDetail={() => selectedBatchId != null && void loadBatchDetail(selectedBatchId)}
            />
          )}
        </>
      )}
    </div>
  );
}

function CurrentPanel({
  classLabel,
  view,
  loading,
  error,
  sourceNames,
  onRetry,
}: {
  classLabel: string;
  view: GroupingView | null;
  loading: boolean;
  error: string | null;
  sourceNames: string;
  onRetry: () => void;
}) {
  if (loading && !view) {
    return (
      <p className="text-sm text-muted bg-card rounded-xl border border-border-soft p-5 text-center" role="status">
        加载中...
      </p>
    );
  }
  if (error) {
    return (
      <div className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
        <p className="text-sm text-danger-strong">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-1.5"
        >
          <RefreshCw size={14} aria-hidden />
          重试
        </button>
      </div>
    );
  }
  if (!view) return null;

  if (!view.hasGrouping) {
    return (
      <div className="bg-card rounded-xl border border-border-soft p-8 text-center space-y-2">
        <Layers className="w-8 h-8 text-muted mx-auto" aria-hidden />
        <p className="text-sm text-foreground font-medium">{classLabel}还没有分组名单</p>
        <p className="text-xs text-muted">
          {view.studentCount === 0
            ? "该班暂无学生，先在学生管理中导入名单。"
            : `该班有 ${view.studentCount} 名学生，生成名单后学生端即可查看本组成员。`}
        </p>
      </div>
    );
  }

  const uncovered = view.studentCount - view.coveredCount;
  const bestBaseline = Math.max(view.baselines.sequence, view.baselines.random);
  // 相似度只统计已进组的人，覆盖率与学生对数按全班算——两个分母必须分开显示（见 grouping-utils 的口径注释）
  const grouped = view.groups.reduce((sum, g) => sum + g.memberCount, 0);

  return (
    <div className="space-y-4">
      {/* 质量提示条：覆盖率、共同特征对数、目标值与基线对照 */}
      <div className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
          <MetricCell label="该班学生" value={`${view.studentCount} 人`} />
          <MetricCell
            label="已进组"
            value={`${grouped} 人`}
            hint={grouped < view.studentCount ? `还有 ${view.studentCount - grouped} 人未进组` : undefined}
          />
          <MetricCell
            label={`有${sourceNames}的学生`}
            value={`${view.coveredCount} / ${view.studentCount}`}
          />
          <MetricCell
            label={`有共同${sourceNames}的学生对`}
            value={`${view.nonZeroPairs} / ${view.totalPairs}`}
            hint="按全班人数计"
          />
          <MetricCell label="组内相似度合计" value={view.overall.toFixed(2)} hint="只含已进组的人" />
        </div>
        <p className="text-xs text-muted">
          同一名单的两条对照基线：按学号顺次 {view.baselines.sequence.toFixed(2)}、随机分配{" "}
          {view.baselines.random.toFixed(2)}。
          {view.overall > bestBaseline
            ? `本次高于两条基线。`
            : `本次未高于基线——${sourceNames}数据不足时属正常。`}
        </p>
        {view.activeSourceKeys.length === 0 && (
          <p className="text-xs text-warning-strong">
            有{sourceNames}的学生不足 2 人，相似度算不出差别，这份名单的兴趣相似度信号为零。
          </p>
        )}
        {uncovered > 0 && view.activeSourceKeys.length > 0 && (
          <p className="text-xs text-warning-strong inline-flex items-start gap-1.5">
            <TriangleAlert size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
            有 {uncovered} 名学生没有{sourceNames}，他们与同组其他人的相似度记 0，会拉低所在组的内聚度。
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted pt-1 border-t border-border-soft">
          {view.latestBatch ? (
            <span>
              最近一次自动分组：{view.latestBatch.createdAt}
              {view.latestBatch.createdByName ? ` · ${view.latestBatch.createdByName}` : ""}
            </span>
          ) : (
            <span>尚无自动分组记录（当前名单来自导入或手工维护）</span>
          )}
          {view.latestBatch && (
            <span>
              与最近一次自动分组有 <span className="font-medium text-foreground">{view.diffCount}</span> 处差异
              （含手工调整与名单变动）
            </span>
          )}
        </div>
      </div>

      {/* 分组卡片 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {view.groups.map((g) => (
          <GroupCard key={g.groupNo} group={g} sourceNames={sourceNames} />
        ))}
      </div>
    </div>
  );
}

function MetricCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm font-semibold text-foreground mt-0.5">{value}</p>
      {hint && <p className="text-[10px] text-muted">{hint}</p>}
    </div>
  );
}

function GroupCard({
  group,
  sourceNames,
}: {
  group: GroupView;
  sourceNames: string;
}) {
  const over = group.memberCount > GROUP_SIZE_CAP;
  return (
    <div className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground">第 {group.groupNo} 组</h3>
        <span className="text-xs text-muted">{group.memberCount} 人</span>
        {over && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-danger-soft text-danger-strong">
            超员
          </span>
        )}
        <span className="ml-auto text-xs text-muted" title={`组内两两${sourceNames}相似度的平均值`}>
          内聚度 {group.cohesion === null ? "—" : group.cohesion.toFixed(2)}
        </span>
      </div>
      {group.members.length === 0 ? (
        <p className="text-xs text-muted">空组</p>
      ) : (
        <ul className="space-y-1.5">
          {group.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2.5">
              <TextAvatar name={m.name} avatarUrl={m.avatarUrl} storageId={m.storageId} size="sm" />
              {/* flex 子项默认 min-width:auto，不加 min-w-0 时 truncate 不生效、长名字会挤出卡片 */}
              <span className="flex-1 min-w-0 truncate text-sm text-foreground">{m.name}</span>
              <span className="flex-shrink-0 font-mono text-xs text-muted">{m.userCode}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoryPanel({
  classLabel,
  sourceNames,
  loading,
  batches,
  batchesError,
  selectedBatchId,
  detail,
  detailLoading,
  detailError,
  onRetryList,
  onSelect,
  onRetryDetail,
}: {
  classLabel: string;
  sourceNames: string;
  loading: boolean;
  batches: BatchItem[];
  batchesError: string | null;
  selectedBatchId: number | null;
  detail: BatchDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  onRetryList: () => void;
  onSelect: (id: number) => void;
  onRetryDetail: () => void;
}) {
  if (loading && batches.length === 0) {
    return <p className="text-sm text-muted bg-card rounded-xl border border-border-soft p-5 text-center">加载中...</p>;
  }
  if (batchesError && batches.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
        <p className="text-sm text-danger-strong">{batchesError}</p>
        <button
          type="button"
          onClick={onRetryList}
          className="px-4 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-1.5"
        >
          <RefreshCw size={14} aria-hidden />
          重试
        </button>
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border-soft p-8 text-center space-y-2">
        <History className="w-8 h-8 text-muted mx-auto" aria-hidden />
        <p className="text-sm text-foreground font-medium">{classLabel}还没有自动分组记录</p>
        <p className="text-xs text-muted">每次自动分组都会在此追加一份不可修改的归档，手工调整不进历史。</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">自动分组记录（{batches.length} 次）</h3>
        <ul className="space-y-2">
          {batches.map((b) => {
            const active = b.id === selectedBatchId;
            const overall = overallOf(b.metrics);
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => onSelect(b.id)}
                  aria-pressed={active}
                  className={`w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "border-primary bg-primary-soft text-foreground"
                      : "border-border-soft hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
                  }`}
                >
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{b.createdAt}</span>
                    <span className="text-xs text-muted">
                      {b.studentCount} 人 · {b.taggedCount} 人有{sourceNames}
                    </span>
                    {overall !== null && <span className="text-xs text-muted">相似度合计 {overall}</span>}
                    {b.createdByName && <span className="ml-auto text-xs text-muted">{b.createdByName}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {selectedBatchId != null && (
        <div className="bg-card rounded-xl border border-border-soft p-5 space-y-4" aria-live="polite">
          {detailLoading && !detail ? (
            <p className="text-sm text-muted" role="status">
              加载中...
            </p>
          ) : detailError ? (
            <div className="space-y-3">
              <p className="text-sm text-danger-strong">{detailError}</p>
              <button
                type="button"
                onClick={onRetryDetail}
                className="px-4 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-1.5"
              >
                <RefreshCw size={14} aria-hidden />
                重试
              </button>
            </div>
          ) : detail ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-foreground">批次 #{detail.batch.id} 名单</h3>
                <span className="text-xs text-muted">
                  {detail.batch.studentCount} 人 · 归档于 {detail.batch.createdAt} · 只读
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {detail.groups.map((g) => (
                  <div key={g.groupNo} className="border border-border-soft rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">第 {g.groupNo} 组</span>
                      <span className="text-xs text-muted">{g.memberCount} 人</span>
                      <span className="ml-auto text-xs text-muted">
                        内聚度 {g.cohesion === null ? "—" : g.cohesion.toFixed(2)}
                      </span>
                    </div>
                    {g.members.length === 0 ? (
                      <p className="text-xs text-muted">空组</p>
                    ) : (
                      <ul className="space-y-1">
                        {g.members.map((m) => (
                          <li key={m.userId} className="flex items-center gap-2 text-sm">
                            <span className="flex-1 min-w-0 truncate text-foreground">{m.name ?? "（账号已删除）"}</span>
                            <span className="flex-shrink-0 font-mono text-xs text-muted">{m.userCode ?? "—"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
