"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  History,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  TriangleAlert,
  Upload,
  Users,
  UsersRound,
  WandSparkles,
  X,
} from "lucide-react";
import ClassSelect from "./ClassSelect";
import GroupingPreviewPanel from "./GroupingPreviewPanel";
import ConfirmDialog from "./ConfirmDialog";
import TextAvatar from "@/components/TextAvatar";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { GROUP_SIZE_CAP } from "@/lib/grouping-utils";

const SECONDARY_BUTTON_BASE =
  "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200 " +
  "enabled:hover:bg-gray-200 dark:enabled:hover:bg-gray-700 " +
  "disabled:text-gray-500 dark:disabled:text-gray-400 disabled:cursor-not-allowed " +
  "transition-colors";

const SECONDARY_BUTTON =
  `${SECONDARY_BUTTON_BASE} px-4 py-2 text-sm font-medium rounded-lg inline-flex items-center gap-1.5`;

const SECONDARY_BUTTON_SM =
  `${SECONDARY_BUTTON_BASE} px-2.5 py-1.5 rounded-lg text-xs font-medium`;

interface MemberView {
  userId: number;
  userCode: string;
  name: string;
  avatarUrl: string | null;
  storageId: number;
  featureLabels: Record<string, string[]>;
  /** 主导兴趣型（#345；无兴趣结果时 null） */
  dominantType?: string | null;
  /** 命中角色（大五 C/E/O/A 高维映射，仅用于分组决策展示） */
  roles?: { key: string; label: string }[];
}

interface GroupView {
  groupNo: number;
  memberCount: number;
  cohesion: number | null;
  /** 组长（#345） */
  leaderUserId?: number | null;
  leaderName?: string | null;
  /** 角色覆盖数（0–4） */
  roleCoverage?: number;
  /** 主型（按成员主导兴趣汇总） */
  primaryType?: string | null;
  members: MemberView[];
}

interface StrategyItem {
  key: string;
  label: string;
  description: string;
  requiresAssessment: boolean;
  isDefault: boolean;
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
  sources: { key: string; label: string; kind: string; version?: string }[];
  /** 当前指标按哪套源/权重重算（有批次时回放最近一批，无批次为默认口径） */
  metricsBasis: { strategy: string; strategyLabel: string; fromBatchId: number | null };
  strategies: StrategyItem[];
  defaultStrategy: string;
  coverageBySource: { key: string; label: string; covered: number; total: number }[];
  untestedCount: number;
  roleCoverageAverage: number;
  roleCoverageTarget: number;
  assessmentAvailable: { riasec: boolean; bigfive: boolean };
  groups: GroupView[];
  ungrouped: MemberView[];
  latestBatch: {
    id: number;
    createdAt: string;
    strategy: string;
    strategyLabel: string;
    studentCount: number;
    /** 归档时的「有任一分组依据」人数（#345 起口径；旧批次不可比） */
    taggedCount: number;
    createdByName: string | null;
    metrics: { overall?: number } | null;
    featureSources: { key: string; kind: string; weight: number; version?: string }[] | null;
  } | null;
  diffCount: number;
}

interface BatchItem {
  id: number;
  strategy: string;
  strategyLabel?: string;
  groupSize: number;
  studentCount: number;
  /** 归档时的「有任一分组依据」人数（#345 起口径；旧批次不可比），列表文案见下方「N 人有分组依据」 */
  taggedCount: number;
  createdAt: string;
  createdByName: string | null;
  metrics: string | null;
}

interface BatchDetailGroup {
  groupNo: number;
  cohesion: number | null;
  memberCount: number;
  leaderUserId?: number | null;
  leaderName?: string | null;
  members: { userId: number; userCode: string | null; name: string | null }[];
}

interface BatchDetail {
  batch: {
    id: number;
    strategy?: string;
    strategyLabel?: string;
    studentCount: number;
    /** 归档时的「有任一分组依据」人数（#345 起口径；旧批次不可比） */
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

/** 写操作共用信息：按钮禁用态与权限一起传，避免每个子面板各判一次 */
interface Writes {
  canModify: boolean;
  busy: boolean;
  onMove: (member: MemberView, fromGroupNo: number | null) => void;
  onCreateGroup: () => void;
  onDeleteGroup: (groupNo: number) => void;
  /** 设置 / 取消组长（#345；写操作，权限由服务端再校验） */
  onSetLeader: (groupNo: number, userId: number | null) => void;
}

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

/** 一个组的标签概览（换人抽屉用）：按出现次数降序，让教师一眼看到「移过去会和谁像」 */
function groupLabelSummary(group: GroupView): string[] {
  const counts = new Map<string, number>();
  for (const m of group.members) {
    for (const values of Object.values(m.featureLabels)) {
      for (const label of values) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map((e) => e[0]);
}

/**
 * 课堂分组（#101）：管理端与教师端共用。
 * 读不限班级（教师可看全校名单），写限自己创建的班级；非自建班标注「只读」。
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

  // 写操作：智能分组预览、换人抽屉、进行中的动作（用于禁用重复提交）
  const [pending, setPending] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<{ member: MemberView; fromGroupNo: number | null } | null>(
    null
  );

  // 导入导出：导出直接下文件；导入在客户端解析成行，先预览再整份覆盖
  const [exporting, setExporting] = useState(false);
  const [importRows, setImportRows] = useState<{ groupNo: string | null; userCode: string }[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const loadView = useCallback(async (id: number, opts?: { clear?: boolean }) => {
    const seq = ++seqRef.current;
    // clear=true（切班级）：立即清空上一个班级的数据，在途期间不能让旧名单顶着新班级名显示
    // clear=false（写操作后的静默刷新）：保留旧数据，避免整屏闪回加载态
    if (opts?.clear === false) {
      setViewLoading(true);
    } else {
      setView(null);
      setBatches([]);
      setViewLoading(true);
      setViewError(null);
      setBatchesError(null);
    }
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
        setViewError(null);
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
  // 自动分组的预期组数：与算法同一口径（前端只算组数，不复制分配逻辑）

  /** 统一的写请求：成功则静默刷新，失败把服务端原因如实 toast 出来（不吞异常） */
  const write = useCallback(
    async (
      key: string,
      run: () => Promise<{ ok: boolean; error?: string; view?: GroupingView }>
    ): Promise<boolean> => {
      if (classId == null) return false;
      setPending(key);
      try {
        const result = await run();
        if (!result.ok) {
          toast.error(result.error || "操作失败");
          return false;
        }
        // 端点会顺带回最新的视图（自动分组 / 导入）；否则重新拉一次
        if (result.view) setView(result.view);
        else await loadView(classId, { clear: false });
        return true;
      } catch (err) {
        console.error(`分组操作 ${key} 失败:`, err);
        toast.error("操作失败，请刷新后重试");
        return false;
      } finally {
        setPending(null);
      }
    },
    [classId, loadView]
  );

  const requestJson = useCallback(
    async (res: Response): Promise<{
      ok: boolean;
      error?: string;
      view?: GroupingView;
      /** #345：换人时原组长被自动取消 */
      leaderCleared?: boolean;
    }> => {
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // 导入的拒绝矩阵把差异清单放在 errors[] 里，只报 error 会让教师看不出到底差在哪
      const details = Array.isArray(data?.errors) ? (data.errors as string[]).slice(0, 3).join("；") : "";
      const base = data?.error || "操作失败";
      return { ok: false, error: details ? `${base}：${details}` : base };
    }
    return {
      ok: true,
      view: (data?.view as GroupingView) ?? undefined,
      leaderCleared: data?.leaderCleared === true,
    };
  }, []);

  /** 设置 / 取消组长（#345）：设完直接刷新视图，组长徽章即时变化 */
  const handleSetLeader = useCallback(
    async (groupNo: number, userId: number | null) => {
      if (classId == null) return;
      const done = await write("leader", async () => {
        const res = await fetch("/api/manage/groups/leader", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ classId, groupNo, leaderUserId: userId }),
        });
        return requestJson(res);
      });
      if (done) toast.success(userId == null ? `已取消第 ${groupNo} 组组长` : `已设置第 ${groupNo} 组组长`);
    },
    [classId, requestJson, write]
  );

  const handleMove = useCallback(
    async (member: MemberView, toGroupNo: number) => {
      if (classId == null) return false;
      let leaderCleared = false;
      const done = await write("move", async () => {
        const res = await fetch("/api/manage/groups/members", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ classId, userId: member.userId, userCode: member.userCode, toGroupNo }),
        });
        const result = await requestJson(res);
        leaderCleared = result.leaderCleared === true;
        return result;
      });
      if (done) {
        toast.success(
          leaderCleared
            ? `已将 ${member.name} 移到第 ${toGroupNo} 组；他原是组长，组长位已自动取消，请重新指定`
            : `已将 ${member.name} 移到第 ${toGroupNo} 组`
        );
      }
      return done;
    },
    [classId, requestJson, write]
  );

  const handleCreateGroup = useCallback(async () => {
    if (classId == null) return;
    const done = await write("create", async () => {
      const res = await fetch("/api/manage/groups/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId }),
      });
      return requestJson(res);
    });
    if (done) toast.success("已新建空组");
  }, [classId, requestJson, write]);

  const handleDeleteGroup = useCallback(
    async (groupNo: number) => {
      if (classId == null) return;
      const done = await write("delete", async () => {
        const res = await fetch(
          `/api/manage/groups/entries?classId=${classId}&groupNo=${groupNo}`,
          { method: "DELETE" }
        );
        return requestJson(res);
      });
      if (done) toast.success(`已删除第 ${groupNo} 组`);
    },
    [classId, requestJson, write]
  );

  const handleExport = useCallback(async () => {
    if (classId == null) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/manage/groups/export?classId=${classId}`, { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "导出失败");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      // 与 service 端 Content-Disposition 保持一致，使用 Asia/Shanghai 日期，避免晚上导出显示前一天
      const dateStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
      a.download = `分组_${selectedClassName}_${dateStr}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success("已导出分组名单");
    } catch (err) {
      console.error("分组导出失败:", err);
      toast.error("导出失败");
    } finally {
      setExporting(false);
    }
  }, [classId, selectedClassName]);

  /**
   * 解析导出的那份表：按**表头名**取列（列序可变、多余列忽略），只交 JSON 行给服务端。
   * 表头不齐就直接拒——「全量覆盖」下少一列学号就会把整班人清掉。
   */
  const parseImportFile = useCallback(
    async (file: File): Promise<{ groupNo: string | null; userCode: string }[]> => {
      const mod = await import("exceljs");
      const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("文件没有工作表");

      const columnOf = new Map<string, number>();
      sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, index) => {
        const name = cell.value == null ? "" : String(cell.value).trim();
        if (name) columnOf.set(name, index);
      });
      const missing = ["组号", "学号", "姓名"].filter((h) => !columnOf.has(h));
      if (missing.length > 0) throw new Error(`表头缺少「${missing.join("」「")}」，请用导出的那张表填写`);

      const rows: { groupNo: string | null; userCode: string }[] = [];
      sheet.eachRow((row, index) => {
        if (index === 1) return;
        const userCode = String(row.getCell(columnOf.get("学号") as number).value ?? "").trim();
        if (!userCode) return; // Excel 残留的空行不算数据
        const cell = row.getCell(columnOf.get("组号") as number).value;
        const groupText = cell === null || cell === undefined ? "" : String(cell).trim();
        // 组号原样交出去：客户端一旦 Number()，「1组」这类笔误就变成 NaN，
        // JSON 里又退化成 null，服务端只能当成「没填组号」——那学生会静默掉出原组
        rows.push({ groupNo: groupText === "" ? null : groupText, userCode });
      });
      if (rows.length === 0) throw new Error("文件没有数据行");
      return rows;
    },
    []
  );

  const handleImportFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = ""; // 同一份文件选第二次也要能触发
      if (!file) return;
      try {
        setImportRows(await parseImportFile(file));
      } catch (err) {
        console.error("分组导入解析失败:", err);
        toast.error(err instanceof Error ? err.message : "文件解析失败");
      }
    },
    [parseImportFile]
  );

  const confirmImport = useCallback(async () => {
    if (classId == null || !importRows) return;
    const rows = importRows;
    setImportRows(null);
    const done = await write("import", async () => {
      const res = await fetch("/api/manage/groups/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, rows }),
      });
      return requestJson(res);
    });
    if (done) toast.success(`已按文件重建分组（${rows.length} 人）`);
  }, [classId, importRows, requestJson, write]);

  const importGroupCount = useMemo(
    () => new Set((importRows ?? []).map((r) => r.groupNo).filter((n): n is string => !!n)).size,
    [importRows]
  );

  const writes: Writes = {
    // 权限决定按钮是否出现，pending 只决定按钮是否可点：
    // 两者混在一个开关里会让提交途中的按钮整批消失，教师会以为权限变了
    canModify,
    busy: !!pending,
    onMove: (member, fromGroupNo) => setMoveTarget({ member, fromGroupNo }),
    onCreateGroup: handleCreateGroup,
    onDeleteGroup: handleDeleteGroup,
    onSetLeader: (groupNo, userId) => void handleSetLeader(groupNo, userId),
  };

  return (
    <div className="space-y-5">
      {/* 班级选择 + 归属标注 + 动作区 */}
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
              setMoveTarget(null);
            }}
            classes={classList}
            loadFailed={classesFailed}
            onRetry={refreshClasses}
            disabled={!!pending}
            placeholder="请选择班级"
            className="min-w-[12rem]"
          />
          <button
            type="button"
            onClick={() => classId != null && void loadView(classId)}
            disabled={classId == null || viewLoading}
            className={SECONDARY_BUTTON}
          >
            <RefreshCw size={14} className={viewLoading ? "animate-spin" : ""} aria-hidden />
            刷新
          </button>
          {classId != null && (
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {/* 导出是读操作：教师能看就能导（与「读不限班级」同口径） */}
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                className={SECONDARY_BUTTON}
              >
                <Download size={14} aria-hidden />
                {exporting ? "导出中..." : "导出"}
              </button>
              {canModify && (
                <>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={!!pending}
                    className={SECONDARY_BUTTON}
                  >
                    <Upload size={14} aria-hidden />
                    导入
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(true)}
                    disabled={!!pending || view === null || view.studentCount === 0}
                    className="px-4 py-2 bg-primary hover:bg-primary-strong disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-1.5"
                  >
                    <WandSparkles size={14} aria-hidden />
                    智能分组
                  </button>
                </>
              )}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => void handleImportFile(e)}
          />
        </div>
        {canModify && classId != null && (
          <p className="text-xs text-muted">
            「智能分组」会先生成预览（不写库）：可看指标、换人、设组长；确认应用后
            <strong>完全覆盖</strong>当前名单（手工调整不可恢复），并把这一次结果归档进历史批次。
          </p>
        )}
      </div>

      {/* 智能分组预览（#345）：替代原来的「自动分组」直接覆盖，先预览再应用 */}
      {classId != null && previewOpen && view && (
        <GroupingPreviewPanel
          classId={classId}
          classLabel={selectedClassName}
          canModify={canModify}
          strategies={view.strategies}
          defaultStrategy={view.defaultStrategy}
          onClose={() => setPreviewOpen(false)}
          onApplied={() => {
            setPreviewOpen(false);
            setSegment("current");
            void loadView(classId, { clear: false });
          }}
        />
      )}

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
              writes={writes}
              onRetry={() => void loadView(classId)}
            />
          ) : (
            <HistoryPanel
              classLabel={selectedClassName}
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

      {importRows && (
        <ConfirmDialog
          open
          title="导入并覆盖当前分组"
          variant="warning"
          confirmText="覆盖导入"
          message={
            <div className="space-y-2">
              <p>
                文件共 <span className="font-medium text-foreground">{importRows.length} 行</span>、
                <span className="font-medium text-foreground">{importGroupCount} 个组号</span>
                ，将<strong>完全覆盖</strong> {selectedClassName} 的当前分组。
              </p>
              {importGroupCount === 0 ? (
                <p className="text-xs text-warning-strong">
                  文件里没有任何组号：导入后 {selectedClassName} 将全班未进组，学生端「我的小组」会变空。
                </p>
              ) : (
                <p className="text-xs text-muted">导入不写入历史批次；组号留空的学生视为未进组。</p>
              )}
              <p className="text-xs text-muted">
                服务端会核对文件学号与本班名单是否完全一致，不一致会整份拒绝并列出差异。
              </p>
            </div>
          }
          onConfirm={confirmImport}
          onCancel={() => setImportRows(null)}
        />
      )}

      {view && moveTarget && (
        <MoveMemberSheet
          member={moveTarget.member}
          fromGroupNo={moveTarget.fromGroupNo}
          groups={view.groups}
          sourceNames={sourceNames}
          busy={!!pending}
          onClose={() => setMoveTarget(null)}
          onMove={handleMove}
        />
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
  writes,
  onRetry,
}: {
  classLabel: string;
  view: GroupingView | null;
  loading: boolean;
  error: string | null;
  sourceNames: string;
  writes: Writes;
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
      <div className="space-y-4">
        <div className="bg-card rounded-xl border border-border-soft p-8 text-center space-y-2">
          <Layers className="w-8 h-8 text-muted mx-auto" aria-hidden />
          <p className="text-sm text-foreground font-medium">{classLabel}还没有分组名单</p>
          <p className="text-xs text-muted">
            {view.studentCount === 0
              ? "该班暂无学生，先在学生管理中导入名单。"
              : `该班有 ${view.studentCount} 名学生，生成名单后学生端即可查看本组成员。`}
          </p>
        </div>
        {writes.canModify && view.studentCount > 0 && (
          <button
            type="button"
            onClick={writes.onCreateGroup}
            disabled={writes.busy}
            className={SECONDARY_BUTTON}
          >
            <Plus size={14} aria-hidden />
            新建空组（手工分组）
          </button>
        )}
      </div>
    );
  }

  const uncovered = view.studentCount - view.coveredCount;
  const bestBaseline = Math.max(view.baselines.sequence, view.baselines.random);
  const assessmentCoverage = view.coverageBySource.filter((source) => source.key !== "tags");
  const roleAverage = view.roleCoverageAverage ?? 0;
  const roleTarget = view.roleCoverageTarget || 3;
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
            label="角色覆盖均值"
            value={`${roleAverage.toFixed(1)} / 4`}
            hint={`目标每组 ≥ ${roleTarget}`}
          />
          <MetricCell
            label="测评覆盖"
            value={assessmentCoverage
              .map((source) => `${source.label} ${source.covered}/${source.total}`)
              .join(" · ")}
            hint={view.untestedCount > 0 ? `两套都没做 ${view.untestedCount} 人` : "全班都有测评数据"}
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
          <span>
            当前指标口径：{view.metricsBasis.strategyLabel} ·{" "}
            {view.metricsBasis.fromBatchId == null
              ? "无批次可依，按默认源与权重"
              : `回放批次 #${view.metricsBasis.fromBatchId} 记录的源与权重`}
          </span>
          {view.latestBatch ? (
            <span>
              最近一次自动分组：{view.latestBatch.createdAt} · {view.latestBatch.strategyLabel}
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
          <GroupCard key={g.groupNo} group={g} sourceNames={sourceNames} writes={writes} />
        ))}
        {writes.canModify && (
          <button
            type="button"
            onClick={writes.onCreateGroup}
            disabled={writes.busy}
            className="rounded-xl border border-dashed border-border-soft p-5 text-sm text-muted hover:text-foreground hover:border-foreground transition-colors inline-flex items-center justify-center gap-1.5 min-h-24 disabled:opacity-40"
          >
            <Plus size={14} aria-hidden />
            新建空组
          </button>
        )}
      </div>

      {/* 未进组的学生：自动分组之后转入、或导入时漏填组号都会停在这里 */}
      {view.ungrouped.length > 0 && (
        <div className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">未进组（{view.ungrouped.length} 人）</h3>
            <span className="text-xs text-muted">用「移动」把他们并进现有组，或先自动分组一次</span>
          </div>
          <ul className="space-y-1.5">
            {view.ungrouped.map((m) => (
              <li key={m.userId} className="flex items-center gap-2.5">
                <TextAvatar name={m.name} avatarUrl={m.avatarUrl} storageId={m.storageId} size="sm" />
                <span className="flex-1 min-w-0 truncate text-sm text-foreground">{m.name}</span>
                <span className="flex-shrink-0 font-mono text-xs text-muted">{m.userCode}</span>
                {writes.canModify && (
                  <button
                    type="button"
                    onClick={() => writes.onMove(m, null)}
                    disabled={writes.busy}
                    className={SECONDARY_BUTTON_SM}
                  >
                    移动
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MetricCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm font-semibold text-foreground mt-0.5">{value}</p>
      {hint && <p className="text-[10px] text-muted mt-0.5">{hint}</p>}
    </div>
  );
}

function GroupCard({
  group,
  sourceNames,
  writes,
}: {
  group: GroupView;
  sourceNames: string;
  writes: Writes;
}) {
  const over = group.memberCount > GROUP_SIZE_CAP;
  return (
    <div className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground">第 {group.groupNo} 组</h3>
        <span className="text-xs text-muted">{group.memberCount} 人</span>
        {group.primaryType && (
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300">
            主型 {group.primaryType}
          </span>
        )}
        {typeof group.roleCoverage === "number" && (
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            title="组内命中的角色数（组织者/推进者/点子王/协调者）">
            角色 {group.roleCoverage}/4
          </span>
        )}
        {over && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-danger-soft text-danger-strong">
            超员
          </span>
        )}
        <span className="ml-auto text-xs text-muted" title={`组内两两${sourceNames}相似度的平均值`}>
          内聚度 {group.cohesion === null ? "—" : group.cohesion.toFixed(2)}
        </span>
        {writes.canModify && group.memberCount === 0 && (
          <button
            type="button"
            onClick={() => writes.onDeleteGroup(group.groupNo)}
            disabled={writes.busy}
            aria-label={`删除空的第 ${group.groupNo} 组`}
            className="px-2 py-1 rounded-lg text-xs font-medium text-danger-strong hover:bg-danger-soft disabled:opacity-40 transition-colors inline-flex items-center gap-1"
          >
            <Trash2 size={12} aria-hidden />
            删除
          </button>
        )}
      </div>
      {group.members.length === 0 ? (
        <p className="text-xs text-muted">空组</p>
      ) : (
        <ul className="space-y-1.5">
          {group.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2.5">
              <TextAvatar name={m.name} avatarUrl={m.avatarUrl} storageId={m.storageId} size="sm" />
              {/* flex 子项默认 min-width:auto，不加 min-w-0 时 truncate 不生效、长名字会挤出卡片 */}
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {m.name}
                {group.leaderUserId === m.userId && (
                  <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                    <Star size={9} aria-hidden />
                    组长
                  </span>
                )}
              </span>
              <span className="flex flex-shrink-0 flex-wrap justify-end gap-1">
                {m.dominantType && (
                  <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    {m.dominantType}
                  </span>
                )}
                {(m.roles ?? []).map((role) => (
                  <span key={role.key} className="rounded bg-blue-50 px-1 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    {role.label}
                  </span>
                ))}
              </span>
              <span className="flex-shrink-0 font-mono text-xs text-muted">{m.userCode}</span>
              {writes.canModify && (
                <button
                  type="button"
                  onClick={() => writes.onSetLeader(group.groupNo, group.leaderUserId === m.userId ? null : m.userId)}
                  disabled={writes.busy}
                  aria-label={group.leaderUserId === m.userId ? `取消 ${m.name} 的组长` : `设 ${m.name} 为第 ${group.groupNo} 组组长`}
                  aria-pressed={group.leaderUserId === m.userId}
                  title={group.leaderUserId === m.userId ? "取消组长" : "设为组长"}
                  className={`rounded px-1.5 py-1 text-[10px] font-medium transition-colors disabled:opacity-40 ${
                    group.leaderUserId === m.userId
                      ? "text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/30"
                      : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  <Star size={11} aria-hidden />
                </button>
              )}
              {writes.canModify && (
                <button
                  type="button"
                  onClick={() => writes.onMove(m, group.groupNo)}
                  disabled={writes.busy}
                  aria-label={`移动 ${m.name} 到其他组`}
                  className={SECONDARY_BUTTON_SM}
                >
                  移动
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 换人抽屉（#101）：移动端从底部升起、桌面端居中弹窗，同一套语义。
 * 不用拖拽——窄屏跨长列表拖拽不可用，键盘与读屏也无法操作。
 */
function MoveMemberSheet({
  member,
  fromGroupNo,
  groups,
  sourceNames,
  busy,
  onClose,
  onMove,
}: {
  member: MemberView;
  fromGroupNo: number | null;
  groups: GroupView[];
  sourceNames: string;
  busy: boolean;
  onClose: () => void;
  onMove: (member: MemberView, toGroupNo: number) => Promise<boolean>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEscapeKey(true, onClose);

  // 打开时把焦点移进抽屉，关闭时交还给触发按钮（键盘操作不能掉进背景页面）
  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      prevActive?.focus?.();
    };
  }, []);

  const labels = Object.values(member.featureLabels).flat();

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end md:items-center justify-center"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`把 ${member.name} 移到其他组`}
        className="bg-card w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-xl max-h-[80dvh] overflow-y-auto p-5 space-y-4 animate-[fade-in_0.15s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <TextAvatar name={member.name} avatarUrl={member.avatarUrl} storageId={member.storageId} size="md" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{member.name}</p>
            <p className="font-mono text-xs text-muted">{member.userCode}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="p-2 rounded-lg text-muted hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {labels.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {labels.map((tag) => (
              <span key={tag} className="px-2 py-0.5 rounded-full text-xs bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300">
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-warning-strong">
            该学生没有{sourceNames}，移动只会影响人数分布，不会改变相似度。
          </p>
        )}

        {failed && <p className="text-xs text-danger-strong">移动失败，请刷新后重试</p>}

        <ul className="space-y-2">
          {groups.map((g) => {
            const isCurrent = g.groupNo === fromGroupNo;
            const full = g.memberCount >= GROUP_SIZE_CAP;
            const summary = groupLabelSummary(g).slice(0, 6);
            return (
              <li key={g.groupNo}>
                <button
                  type="button"
                  disabled={isCurrent || busy}
                  onClick={async () => {
                    setFailed(false);
                    const done = await onMove(member, g.groupNo);
                    if (done) onClose();
                    else setFailed(true);
                  }}
                  aria-label={`移到第 ${g.groupNo} 组（${g.memberCount} 人）`}
                  className={`w-full text-left rounded-lg border px-3 py-3 transition-colors min-h-11 ${
                    isCurrent
                      ? "border-border-soft bg-gray-50 dark:bg-gray-800 text-muted cursor-not-allowed"
                      : "border-border-soft hover:bg-gray-50 dark:hover:bg-gray-800 text-foreground disabled:opacity-40"
                  }`}
                >
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">第 {g.groupNo} 组</span>
                    <span className="text-xs text-muted">{g.memberCount} 人</span>
                    {full && !isCurrent && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-warning/10 text-warning-strong">已满</span>
                    )}
                    {isCurrent && <span className="text-xs text-muted">当前组</span>}
                    <span className="ml-auto text-xs text-muted">
                      内聚度 {g.cohesion === null ? "—" : g.cohesion.toFixed(2)}
                    </span>
                  </span>
                  {summary.length > 0 && (
                    <span className="flex flex-wrap gap-1 mt-1.5">
                      {summary.map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] bg-background text-muted">
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {groups.length === 0 && (
          <p className="text-sm text-muted">还没有可移入的组，先新建一个空组。</p>
        )}
      </div>
    </div>
  );
}

function HistoryPanel({
  classLabel,
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
    return (
      <p className="text-sm text-muted bg-card rounded-xl border border-border-soft p-5 text-center" role="status">
        加载中...
      </p>
    );
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
                      ? "border-primary bg-primary-soft text-foreground dark:bg-green-900/30"
                      : "border-border-soft hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
                  }`}
                >
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{b.createdAt}</span>
                    {b.strategyLabel && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {b.strategyLabel}
                      </span>
                    )}
                    <span className="text-xs text-muted">
                      {b.studentCount} 人 · {b.taggedCount} 人有分组依据
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
                <h3 className="text-sm font-semibold text-foreground">
                  <UsersRound size={14} className="inline mr-1.5 -mt-0.5" aria-hidden />
                  批次 #{detail.batch.id} 名单
                </h3>
                <span className="text-xs text-muted">
                  {detail.batch.strategyLabel ? `${detail.batch.strategyLabel} · ` : ""}
                  {detail.batch.studentCount} 人 · 归档于 {detail.batch.createdAt} · 只读
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {detail.groups.map((g) => (
                  <div key={g.groupNo} className="border border-border-soft rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">第 {g.groupNo} 组</span>
                      <span className="text-xs text-muted">{g.memberCount} 人</span>
                      {g.leaderName && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                          <Star size={9} aria-hidden />
                          组长 {g.leaderName}
                        </span>
                      )}
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