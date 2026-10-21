"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Star, WandSparkles, X } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import TextAvatar from "@/components/TextAvatar";

const SECONDARY_BUTTON =
  "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200 enabled:hover:bg-gray-200 " +
  "dark:enabled:hover:bg-gray-700 disabled:text-gray-500 dark:disabled:text-gray-400 " +
  "disabled:cursor-not-allowed transition-colors px-4 py-2 text-sm font-medium rounded-lg inline-flex items-center gap-1.5";

const PRIMARY_BUTTON =
  "px-4 py-2 bg-primary hover:bg-primary-strong disabled:opacity-40 text-white text-sm font-medium " +
  "rounded-lg transition-colors inline-flex items-center gap-1.5";

interface MemberRole {
  key: string;
  label: string;
}

interface PreviewMember {
  userId: number;
  userCode: string;
  name: string;
  avatarUrl: string | null;
  storageId: number;
  dominantType: string | null;
  roles: MemberRole[];
  featureLabels: Record<string, string[]>;
}

interface PreviewGroup {
  groupNo: number;
  memberCount: number;
  cohesion: number | null;
  primaryType: string | null;
  roleCoverage: number;
  suggestedLeaderUserId: number | null;
  members: PreviewMember[];
}

interface PreviewMetrics {
  overall: number;
  baselines: { sequence: number; random: number };
  roleCoverageAverage?: number;
  roleCoverageTarget?: number;
  roleCoverage?: number[];
  untestedCount?: number;
}

interface GroupingPreview {
  strategy: string;
  strategyLabel: string;
  variant: number;
  sources: { key: string; label: string; kind: string; weight: number }[];
  coverageBySource: { key: string; label: string; covered: number; total: number }[];
  untestedCount: number;
  assessmentAvailable: { riasec: boolean; bigfive: boolean };
  degraded: string[];
  studentCount: number;
  groupSize: number;
  expectedGroupCount: number;
  roleCoverageTarget: number;
  metrics: PreviewMetrics;
  groups: PreviewGroup[];
}

interface StrategyItem {
  key: string;
  label: string;
  description: string;
  requiresAssessment: boolean;
  isDefault: boolean;
}

interface Props {
  classId: number;
  classLabel: string;
  canModify: boolean;
  /** 三种策略（由当前分组视图下发，避免前端再写死一份） */
  strategies: StrategyItem[];
  defaultStrategy: string;
  onClose: () => void;
  /** 应用成功：父组件负责刷新视图并提示 */
  onApplied: () => void;
}

interface SwapSelection {
  groupNo: number;
  userId: number;
  name: string;
}

/**
 * 「智能分组」预览面板（#345）。
 *
 * 流程：选策略（可调权重）→ 生成预览（**不写库**）→ 预览里换人 / 设组长 / 重新生成 →
 * 确认应用（把这一份分组提交给服务端再校验一次）。确定性：同参数 + 同 variant 必得同一版。
 */
export default function GroupingPreviewPanel({
  classId,
  classLabel,
  canModify,
  strategies,
  defaultStrategy,
  onClose,
  onApplied,
}: Props) {
  const [strategy, setStrategy] = useState(defaultStrategy);
  const [variant, setVariant] = useState(0);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [weights, setWeights] = useState<Record<string, number>>({ tags: 0.2, riasec: 0.5, bigfive: 0.3 });
  const [preview, setPreview] = useState<GroupingPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaders, setLeaders] = useState<Record<number, number | null>>({});
  const [swap, setSwap] = useState<SwapSelection | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadPreview = useCallback(
    async (nextStrategy: string, nextVariant: number, nextWeights: Record<string, number>) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/manage/groups/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classId,
            strategy: nextStrategy,
            variant: nextVariant,
            weights: nextStrategy === "idf-cosine" ? undefined : nextWeights,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setPreview(null);
          setError((data as { error?: string } | null)?.error ?? "生成预览失败");
          return;
        }
        const next = (data as { preview: GroupingPreview }).preview;
        setPreview(next);
        // 建议组长只在首次生成时填入；重新生成 / 换人后保留教师已做的选择
        setLeaders((previous) => {
          const merged: Record<number, number | null> = {};
          for (const group of next.groups) {
            merged[group.groupNo] =
              group.groupNo in previous ? previous[group.groupNo] : group.suggestedLeaderUserId;
          }
          return merged;
        });
      } catch (err) {
        console.error("分组预览失败:", err);
        setPreview(null);
        setError("生成预览失败，请重试");
      } finally {
        setLoading(false);
      }
    },
    [classId]
  );

  /* eslint-disable react-hooks/set-state-in-effect -- 打开面板即生成一版默认预览 */
  useEffect(() => {
    void loadPreview(defaultStrategy, 0, weights);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在打开时取一次默认策略
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const regenerate = () => {
    const nextVariant = variant + 1;
    setVariant(nextVariant);
    setSwap(null);
    void loadPreview(strategy, nextVariant, weights);
  };

  const changeStrategy = (next: string) => {
    setStrategy(next);
    setVariant(0);
    setSwap(null);
    setLeaders({});
    void loadPreview(next, 0, weights);
  };

  const swapMembers = (a: PreviewGroup, aUserId: number, b: PreviewGroup, bUserId: number) => {
    if (!preview) return;
    // 只在前端候选上对调（预览不落库）；人数不变，指标展示沿用服务端口径，应用后由服务端重算
    const nextGroups = preview.groups.map((group) => ({ ...group, members: [...group.members] }));
    const groupA = nextGroups.find((group) => group.groupNo === a.groupNo);
    const groupB = nextGroups.find((group) => group.groupNo === b.groupNo);
    if (!groupA || !groupB) return;
    const indexA = groupA.members.findIndex((member) => member.userId === aUserId);
    const indexB = groupB.members.findIndex((member) => member.userId === bUserId);
    if (indexA < 0 || indexB < 0) return;
    const memberA = groupA.members[indexA];
    const memberB = groupB.members[indexB];
    groupA.members[indexA] = memberB;
    groupB.members[indexB] = memberA;
    setLeaders((previous) => {
      // 换人后组长失效则自动回退并提示（组长必须在本组）
      const next = { ...previous };
      if (next[groupA.groupNo] === aUserId) next[groupA.groupNo] = null;
      if (next[groupB.groupNo] === bUserId) next[groupB.groupNo] = null;
      return next;
    });
    setPreview({ ...preview, groups: nextGroups });
    setSwap(null);
    toast.info(`已把 ${memberA.name} 与 ${memberB.name} 对调（仅预览，未保存）`);
  };

  const setLeader = (group: PreviewGroup, userId: number) => {
    setLeaders((previous) => ({
      ...previous,
      [group.groupNo]: previous[group.groupNo] === userId ? null : userId,
    }));
    setSwap(null);
  };

  /** 预览中每组的实际成员顺序（含换人后的结果），提交给应用接口 */
  const groupsPayload = useMemo(
    () =>
      (preview?.groups ?? []).map((group) => ({
        groupNo: group.groupNo,
        userIds: group.members.map((member) => member.userId),
        leaderUserId: leaders[group.groupNo] ?? null,
      })),
    [preview, leaders]
  );

  const apply = async () => {
    if (!preview) return;
    setApplying(true);
    try {
      const res = await fetch("/api/manage/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          strategy,
          variant,
          weights: strategy === "idf-cosine" ? undefined : weights,
          groups: groupsPayload,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error((data as { error?: string } | null)?.error ?? "应用分组失败");
        return;
      }
      toast.success(`已应用分组（批次 #${(data as { batchId?: number }).batchId ?? "-"}）`);
      onApplied();
    } catch (err) {
      console.error("应用分组失败:", err);
      toast.error("应用分组失败，请重试");
    } finally {
      setApplying(false);
      setConfirmApply(false);
    }
  };

  const bestBaseline = preview ? Math.max(preview.metrics.baselines.sequence, preview.metrics.baselines.random) : 0;
  const swapTargets = useMemo(() => {
    if (!preview || !swap) return [];
    return preview.groups
      .filter((group) => group.groupNo !== swap.groupNo)
      .flatMap((group) => group.members.map((member) => ({ group, member })));
  }, [preview, swap]);

  return (
    <div className="bg-card rounded-xl border border-border-soft p-5 space-y-4" role="region" aria-label="智能分组预览">
      <div className="flex items-center gap-2 flex-wrap">
        <WandSparkles size={16} className="text-primary" aria-hidden />
        <h3 className="font-semibold text-foreground">智能分组预览</h3>
        <span className="text-xs text-muted">{classLabel}</span>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
          预览不写库
        </span>
        <button type="button" onClick={onClose} aria-label="关闭预览" className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X size={18} aria-hidden />
        </button>
      </div>

      {/* 策略选择 */}
      <div className="space-y-2" role="radiogroup" aria-label="分组策略">
        <p className="text-xs font-medium text-muted">分组策略</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {strategies.map((item) => {
            const active = strategy === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => changeStrategy(item.key)}
                disabled={loading || applying}
                className={`text-left rounded-lg border p-3 transition-colors disabled:opacity-50 ${
                  active
                    ? "border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/30"
                    : "border-border-soft hover:border-gray-300"
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  {item.label}
                  {item.isDefault && (
                    <span className="rounded bg-green-100 px-1 py-0.5 text-[10px] text-green-700 dark:bg-green-900/40 dark:text-green-300">
                      默认
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{item.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 覆盖率 + 权重 */}
      {preview && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {preview.coverageBySource.map((source) => (
            <span key={source.key}>
              {source.label} {source.covered}/{source.total}
            </span>
          ))}
          <span>未测 {preview.untestedCount} 人</span>
          {(!preview.assessmentAvailable.riasec || !preview.assessmentAvailable.bigfive) && (
            <span className="text-warning-strong">测评数据不完整，已按可用源归一</span>
          )}
          {strategy !== "idf-cosine" && (
            <button
              type="button"
              onClick={() => setWeightsOpen((open) => !open)}
              className="text-xs text-gray-500 underline-offset-2 hover:underline"
            >
              {weightsOpen ? "收起权重" : "调整权重"}
            </button>
          )}
        </div>
      )}
      {preview && !loading && preview.groups.some((group) => group.roleCoverage < preview.roleCoverageTarget) && (
        <p className="text-xs text-warning-strong">
          有组的角色覆盖不足 {preview.roleCoverageTarget}：可「换一版候选」、调整策略，或直接接受（角色只用于组合参考）。
        </p>
      )}
      {preview && !loading && preview.untestedCount > 0 && (
        <p className="text-xs text-muted">
          有 {preview.untestedCount} 名学生两套测评都没做，只按标签参与分组并被均分到各组；可在数据列表筛选「未测」提醒学生补做。
        </p>
      )}
      {preview && weightsOpen && strategy !== "idf-cosine" && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border border-border-soft p-3">
          {preview.sources.map((source) => (
            <label key={source.key} className="space-y-1 text-xs text-muted">
              <span>
                {source.label}权重（0–1）
              </span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={weights[source.key] ?? source.weight}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setWeights((previous) => ({ ...previous, [source.key]: Number.isFinite(value) ? value : 0 }));
                }}
                className="w-full rounded-lg border border-border-soft bg-card px-2 py-1 text-sm text-foreground"
              />
            </label>
          ))}
          <div className="sm:col-span-3">
            <button
              type="button"
              onClick={() => {
                setVariant(0);
                setSwap(null);
                void loadPreview(strategy, 0, weights);
              }}
              disabled={loading}
              className={SECONDARY_BUTTON}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden />
              按新权重重算
            </button>
          </div>
        </div>
      )}

      {loading && (
        <p className="text-sm text-muted text-center py-6" role="status">
          正在生成预览...
        </p>
      )}
      {error && !loading && (
        <div className="space-y-2 text-center py-6">
          <p className="text-sm text-danger-strong">{error}</p>
          <button type="button" onClick={() => void loadPreview(strategy, variant, weights)} className={SECONDARY_BUTTON}>
            <RefreshCw size={14} aria-hidden />
            重试
          </button>
        </div>
      )}

      {preview && !loading && (
        <>
          {/* 指标卡：兴趣相似度 vs 基线 / 角色覆盖 / 组数 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <PreviewMetric
              label="兴趣相似度合计"
              value={preview.metrics.overall.toFixed(2)}
              hint={`学号基线 ${preview.metrics.baselines.sequence.toFixed(2)} / 随机 ${preview.metrics.baselines.random.toFixed(2)}${
                preview.metrics.overall > bestBaseline ? " · 高于基线" : ""
              }`}
            />
            <PreviewMetric
              label="角色覆盖均值"
              value={`${(preview.metrics.roleCoverageAverage ?? 0).toFixed(1)} / 4`}
              hint={`目标每组 ≥ ${preview.roleCoverageTarget}`}
            />
            <PreviewMetric label="分组" value={`${preview.groups.length} 组`} hint={`${preview.studentCount} 人 · 每组上限 ${preview.groupSize}`} />
            <PreviewMetric
              label="测评覆盖"
              value={`${preview.coverageBySource.find((s) => s.key === "riasec")?.covered ?? 0} / ${preview.studentCount}`}
              hint={`未做任何测评 ${preview.untestedCount} 人`}
            />
          </div>

          {swap && (
            <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20 px-3 py-2 text-xs text-green-800 dark:text-green-200">
              已选 <strong>{swap.name}</strong>：点击其他组的一名成员与他对调，或
              <button type="button" onClick={() => setSwap(null)} className="ml-1 underline">
                取消
              </button>
            </div>
          )}

          {/* 组卡片 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {preview.groups.map((group) => {
              const leaderId = leaders[group.groupNo] ?? null;
              return (
                <div key={group.groupNo} className="rounded-xl border border-border-soft p-4 space-y-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold text-foreground">第 {group.groupNo} 组</h4>
                    <span className="text-xs text-muted">{group.memberCount} 人</span>
                    {group.primaryType && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                        title="按主导兴趣分配的组主型"
                      >
                        主型 {group.primaryType}
                      </span>
                    )}
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        group.roleCoverage >= preview.roleCoverageTarget
                          ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                          : "bg-warning-soft text-warning-strong"
                      }`}
                      title="组内命中的角色数（组织者/推进者/点子王/协调者）"
                    >
                      角色 {group.roleCoverage}/4
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {group.members.map((member) => {
                      const isLeader = leaderId === member.userId;
                      const swapDisabled = !swap || swap.userId === member.userId || swap.groupNo === group.groupNo;
                      return (
                        <li key={member.userId} className="flex items-center gap-2 flex-wrap">
                          <TextAvatar name={member.name} avatarUrl={member.avatarUrl} storageId={member.storageId} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                            {member.name}
                            {isLeader && (
                              <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                                <Star size={9} aria-hidden />
                                组长
                              </span>
                            )}
                          </span>
                          <span className="flex-shrink-0 font-mono text-xs text-muted">{member.userCode}</span>
                          <span className="flex flex-wrap gap-1">
                            {member.dominantType && (
                              <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                                {member.dominantType}
                              </span>
                            )}
                            {member.roles.map((role) => (
                              <span
                                key={role.key}
                                className="rounded bg-blue-50 px-1 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                              >
                                {role.label}
                              </span>
                            ))}
                          </span>
                          <button
                            type="button"
                            onClick={() => setLeader(group, member.userId)}
                            disabled={applying}
                            aria-label={isLeader ? `取消 ${member.name} 的组长` : `设 ${member.name} 为第 ${group.groupNo} 组组长`}
                            aria-pressed={isLeader}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-40 ${
                              isLeader
                                ? "text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/30"
                                : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                            }`}
                          >
                            <Star size={11} aria-hidden />
                          </button>
                          {swap ? (
                            <button
                              type="button"
                              onClick={() => swapMembers(
                                preview.groups.find((g) => g.groupNo === swap.groupNo)!,
                                swap.userId,
                                group,
                                member.userId
                              )}
                              disabled={swapDisabled}
                              title={swapDisabled ? "请选择另一组的成员" : `与 ${swap.name} 对调`}
                              className={SECONDARY_BUTTON}
                            >
                              对调
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setSwap({ groupNo: group.groupNo, userId: member.userId, name: member.name })}
                              disabled={applying}
                              className="rounded px-2 py-1 text-[10px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                            >
                              换人
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {swap && swapTargets.length === 0 && <p className="text-xs text-muted">没有可对调的成员。</p>}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border-soft pt-3">
            <button type="button" onClick={regenerate} disabled={loading || applying} className={SECONDARY_BUTTON}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden />
              换一版候选
            </button>
            <button type="button" onClick={onClose} disabled={applying} className={SECONDARY_BUTTON}>
              取消
            </button>
            <button
              type="button"
              onClick={() => setConfirmApply(true)}
              disabled={!canModify || applying || groupsPayload.length === 0}
              className={`${PRIMARY_BUTTON} ml-auto`}
            >
              {applying ? "应用中..." : "应用分组"}
            </button>
          </div>
        </>
      )}

      {preview && (
        <ConfirmDialog
          open={confirmApply}
          title="应用这份分组"
          variant="danger"
          confirmText="覆盖并应用"
          message={
            <div className="space-y-2">
              <p>
                将把 <span className="font-medium text-foreground">{classLabel}</span> 的当前分组
                <strong>完全覆盖</strong>为预览里的 {preview.groups.length} 组（{preview.studentCount} 人），
                并归档进历史批次（策略：{preview.strategyLabel}）。
              </p>
              <p className="text-xs text-muted">
                预览阶段没有写库；应用后学生端「我的小组」立即跟着变，手工调整不可恢复。
                {Object.values(leaders).some((value) => value != null) && " 已设置的组长会一起保存。"}
              </p>
            </div>
          }
          onConfirm={() => void apply()}
          onCancel={() => setConfirmApply(false)}
        />
      )}
    </div>
  );
}

function PreviewMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border-soft p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted">{hint}</p>}
    </div>
  );
}
