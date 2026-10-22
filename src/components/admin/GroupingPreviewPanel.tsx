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
 * 合并组长选择：教师选过且仍是本组成员 → 保留；显式取消 → 保持 null；
 * 原组长已被换走 → 置 null 由教师重新指定（不自动顶替，避免把教师没选的人当组长）；
 * 该组是新生成的（previous 里没有这个组号）→ 用服务端建议。
 * 否则重新生成后会把旧组长带进他不在的组，应用时被服务端以「组长必须是本组成员」拒绝。
 */
function mergeLeaders(
  next: GroupingPreview,
  previous: Record<number, number | null>
): Record<number, number | null> {
  const merged: Record<number, number | null> = {};
  for (const group of next.groups) {
    if (!(group.groupNo in previous)) {
      merged[group.groupNo] = group.suggestedLeaderUserId;
      continue;
    }
    const prior = previous[group.groupNo];
    const stillMember = prior != null && group.members.some((member) => member.userId === prior);
    merged[group.groupNo] = stillMember ? prior : null;
  }
  return merged;
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
  // 权重初值取自预览回显的源权重（`weights[key] ?? source.weight`），前端不再写死一份默认值，
  // 避免与服务端默认权重漂移（评审第 7 条）
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<GroupingPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaders, setLeaders] = useState<Record<number, number | null>>({});
  const [swap, setSwap] = useState<SwapSelection | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applying, setApplying] = useState(false);

  const fetchPreview = useCallback(
    async (
      nextStrategy: string,
      nextVariant: number,
      nextWeights: Record<string, number>,
      groups?: unknown
    ): Promise<{ ok: true; preview: GroupingPreview } | { ok: false; error: string }> => {
      try {
        const res = await fetch("/api/manage/groups/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classId,
            strategy: nextStrategy,
            variant: nextVariant,
            weights: nextStrategy === "idf-cosine" ? undefined : nextWeights,
            groups,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          return { ok: false, error: (data as { error?: string } | null)?.error ?? "生成预览失败" };
        }
        return { ok: true, preview: (data as { preview: GroupingPreview }).preview };
      } catch (err) {
        console.error("分组预览失败:", err);
        return { ok: false, error: "生成预览失败，请重试" };
      }
    },
    [classId]
  );

  const loadPreview = useCallback(
    async (nextStrategy: string, nextVariant: number, nextWeights: Record<string, number>) => {
      setLoading(true);
      setError(null);
      const result = await fetchPreview(nextStrategy, nextVariant, nextWeights);
      if (!result.ok) {
        setPreview(null);
        setError(result.error);
      } else {
        setPreview(result.preview);
        // 建议组长只在首次生成时填入；重新生成后保留教师已做的选择（原组长已不在本组则回退为空）
        setLeaders((previous) => mergeLeaders(result.preview, previous));
      }
      setLoading(false);
    },
    [fetchPreview]
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

  /**
   * 这份预览**实际用的**权重（服务端回显）。换人与应用都必须提交它，
   * 而不是权重输入框里的草稿——否则服务端会按草稿权重重算并回显，
   * 让「权重已改、待重算」的提示消失，批次记录的权重与生成分组的权重再次不一致。
   */
  const previewWeights = useMemo(() => {
    if (!preview) return null;
    const out: Record<string, number> = {};
    for (const source of preview.sources) out[source.key] = source.weight;
    return out;
  }, [preview]);

  const swapMembers = async (a: PreviewGroup, aUserId: number, b: PreviewGroup, bUserId: number) => {
    if (!preview || !previewWeights || swapping) return;
    const memberA = a.members.find((member) => member.userId === aUserId);
    const memberB = b.members.find((member) => member.userId === bUserId);
    if (!memberA || !memberB) return;

    // 换人不落库，但指标必须由服务端按新成员重算：客户端只提交成员与组长，不持有原始测评分
    const payload = preview.groups.map((group) => {
      const userIds = group.members.map((member) => member.userId);
      if (group.groupNo === a.groupNo) {
        const index = userIds.indexOf(aUserId);
        if (index >= 0) userIds[index] = bUserId;
      } else if (group.groupNo === b.groupNo) {
        const index = userIds.indexOf(bUserId);
        if (index >= 0) userIds[index] = aUserId;
      }
      const leader = leaders[group.groupNo] ?? null;
      return {
        groupNo: group.groupNo,
        userIds,
        leaderUserId: leader === aUserId || leader === bUserId ? null : leader,
      };
    });
    const leaderCleared = leaders[a.groupNo] === aUserId || leaders[b.groupNo] === bUserId;

    setSwapping(true);
    setSwap(null);
    // 换人沿用当前预览的权重（不是输入框草稿）：草稿改了但没重算时，这次换人也不能替它重算
    const result = await fetchPreview(strategy, variant, previewWeights, payload);
    if (!result.ok) {
      toast.error(result.error);
      setSwapping(false);
      return;
    }
    setPreview(result.preview);
    setLeaders((previous) => mergeLeaders(result.preview, previous));
    setSwapping(false);
    toast.info(
      `已把 ${memberA.name} 与 ${memberB.name} 对调（仅预览，未保存）${
        leaderCleared ? "；原组长已取消" : ""
      }`
    );
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

  /** 输入框改过但还没「按新权重重算」：此刻分组并不是按输入框里的权重生成的 */
  const weightsDirty = useMemo(() => {
    if (!preview || strategy === "idf-cosine") return false;
    return preview.sources.some((source) => (weights[source.key] ?? source.weight) !== source.weight);
  }, [preview, strategy, weights]);

  const apply = async () => {
    if (!preview || !previewWeights) return;
    setApplying(true);
    try {
      const res = await fetch("/api/manage/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          strategy,
          variant,
          // 提交预览实际用的权重（C 不用权重）
          weights: strategy === "idf-cosine" ? undefined : previewWeights,
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
                disabled={loading || applying || swapping}
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
      {preview &&
        !loading &&
        strategy !== "idf-cosine" &&
        preview.groups.some((group) => group.roleCoverage < preview.roleCoverageTarget) && (
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
                disabled={swapping}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setWeights((previous) => ({ ...previous, [source.key]: Number.isFinite(value) ? value : 0 }));
                }}
                className="w-full rounded-lg border border-border-soft bg-card px-2 py-1 text-sm text-foreground"
              />
            </label>
          ))}
          <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setVariant(0);
                setSwap(null);
                void loadPreview(strategy, 0, weights);
              }}
              disabled={loading || swapping}
              className={SECONDARY_BUTTON}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden />
              按新权重重算
            </button>
            {weightsDirty && (
              <span className="text-xs text-warning-strong">
                权重已修改但还没重算：当前分组与指标仍是按上一版权重生成的，应用前请先「按新权重重算」。
              </span>
            )}
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
          {/* 指标卡：组内相似度 vs 基线 / 角色覆盖 / 组数 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <PreviewMetric
              label="组内相似度合计"
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

          {swapping && (
            <p className="text-xs text-muted" role="status">
              正在按新成员重算指标...
            </p>
          )}

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
                            disabled={applying || swapping}
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
                              disabled={swapDisabled || swapping}
                              title={swapDisabled ? "请选择另一组的成员" : `与 ${swap.name} 对调`}
                              className={SECONDARY_BUTTON}
                            >
                              对调
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setSwap({ groupNo: group.groupNo, userId: member.userId, name: member.name })}
                              disabled={applying || swapping}
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
            <button
              type="button"
              onClick={regenerate}
              disabled={loading || applying || swapping || strategy === "idf-cosine"}
              title={strategy === "idf-cosine" ? "「仅按标签」的策略没有换候选的概念（每次结果相同）" : undefined}
              className={SECONDARY_BUTTON}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden />
              换一版候选
            </button>
            <button type="button" onClick={onClose} disabled={applying} className={SECONDARY_BUTTON}>
              取消
            </button>
            <button
              type="button"
              onClick={() => setConfirmApply(true)}
              disabled={!canModify || applying || swapping || weightsDirty || groupsPayload.length === 0}
              title={weightsDirty ? "权重已修改，请先按新权重重算" : undefined}
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
