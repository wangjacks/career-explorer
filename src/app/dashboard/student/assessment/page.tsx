"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Toaster } from "sonner";
import {
  ArrowRight,
  ChevronDown,
  Compass,
  ListChecks,
  Play,
  RotateCcw,
  Timer,
  type LucideIcon,
} from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import StudentSidebar from "@/components/student/StudentSidebar";
import { useSession } from "@/hooks/useSession";
import { RIASEC_CODE } from "@/lib/assessment-data";
import { deriveAssessmentCenter, type AssessmentCenterView } from "@/lib/assessment-center";

/** `GET /api/shared/assessment/results` 的返回（只声明本页用到的字段） */
interface AssessmentResultsPayload {
  assessment?: {
    code?: string;
    name?: string;
    questionCount?: number;
    enabled?: boolean;
    scaleVersion?: string;
    dimensions?: { key: string; label: string }[];
    attribution?: string;
    licenseText?: string;
    disclaimer?: string;
  };
  current?: { typeCode?: string | null; completedAt?: string | null } | null;
  history?: unknown[];
  inProgress?: { answered: number; total: number; updatedAt?: string } | null;
}

const QUIZ_HREF = "/dashboard/student/assessment/quiz";
/** 「查看报告」落在「我的档案」的测评区（#224 上线后就是那里的锚点，当前先回到学生面板） */
const REPORT_HREF = "/dashboard/student";

/** 状态徽章：三态各自一色（沿用语义 token） */
function StatusBadge({ status }: { status: AssessmentCenterView["status"] }) {
  const map = {
    "not-started": { text: "未开始", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
    "in-progress": {
      text: "进行中",
      className: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    },
    completed: {
      text: "已完成",
      className: "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400",
    },
  } as const;
  const current = map[status];
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${current.className}`}>{current.text}</span>;
}

/** 主按钮 / 次按钮的统一外观（CTA 只有一个主按钮，避免两个同级强调打架） */
const PRIMARY_BUTTON =
  "inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-xl transition-colors";
const SECONDARY_BUTTON =
  "inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-xl transition-colors";

/** 测评说明里的单条信息（图标 + 标题 + 值） */
function Fact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border-soft px-3 py-2.5">
      <Icon size={16} className="text-accent flex-shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-[11px] text-muted leading-tight">{label}</p>
        <p className="text-sm font-semibold text-foreground leading-tight mt-0.5">{value}</p>
      </div>
    </div>
  );
}

/** 进行中：进度条 + 继续作答 */
function ProgressTrack({ view }: { view: AssessmentCenterView }) {
  return (
    <div className="space-y-1.5">
      <div
        className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={view.total}
        aria-valuenow={view.answered}
        aria-label={`已答 ${view.answered} / ${view.total} 题`}
      >
        <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${view.percent}%` }} />
      </div>
      <p className="text-xs text-muted">
        已答 {view.answered} / {view.total} 题（{view.percent}%）
      </p>
    </div>
  );
}

/**
 * 职业测评中心（#222）：只承载**入口、状态与说明**——结果解读与职业推荐在「我的档案」（#224）。
 *
 * 三态来自服务端草稿 / 结果（`GET /api/shared/assessment/results`），判定在
 * `src/lib/assessment-center.ts`（纯函数，可单测）；本页不缓存作答内容，也不做任何计分。
 */
export default function AssessmentCenterPage() {
  const router = useRouter();
  const { session, checking } = useSession();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- 桌面默认展开需挂载后按视口判断 */
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) setSidebarOpen(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const [payload, setPayload] = useState<AssessmentResultsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 404 = 后端没有这套量表（未安装 / 被清空），与「加载失败」区分成空态 */
  const [unavailable, setUnavailable] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  useEffect(() => {
    if (!checking && (!session || session.role !== "student")) {
      router.replace("/login");
    }
  }, [checking, session, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setUnavailable(false);
    try {
      const res = await fetch(`/api/shared/assessment/results?code=${encodeURIComponent(RIASEC_CODE)}`);
      const data = await res.json();
      if (res.status === 404) {
        setUnavailable(true);
        setPayload(null);
        return;
      }
      if (!res.ok) throw new Error(data.error || "测评状态加载失败");
      setPayload(data as AssessmentResultsPayload);
    } catch (err) {
      console.error("Failed to load assessment center:", err);
      setLoadError(err instanceof Error ? err.message : "测评状态加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- 会话确认后拉取状态 */
  useEffect(() => {
    if (session?.role === "student") void load();
  }, [session, load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (checking || !session || session.role !== "student") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-sm text-muted">加载中...</p>
      </div>
    );
  }

  const view = deriveAssessmentCenter(payload);
  const canStart = view.enabled && view.questionCount > 0;
  const meta = payload?.assessment;
  /** 没有署名/授权/免责文本时（接口未返回或量表现场配置为空）不渲染空白的说明面板 */
  const hasTerms = Boolean(meta?.attribution || meta?.licenseText || meta?.disclaimer);

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" />
      <NavigationBar title="学生面板" showHome onToggleSidebar={() => setSidebarOpen((v) => !v)} />

      {/* 注意：此 flex 容器不设任何 overflow，避免破坏侧边栏 sticky */}
      <div className="flex">
        <StudentSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <main className="flex-1 min-w-0 px-4 sm:px-6 py-6 animate-[fade-in_0.2s_ease-out]">
          <div className="max-w-3xl mx-auto space-y-5">
            {/* Hero：深绿品牌区（与学生面板同款），承载标题、简介与免责声明入口 */}
            <section className="bg-brand rounded-2xl p-5 sm:p-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center flex-shrink-0">
                  <Compass size={26} className="text-accent" aria-hidden />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-2xl font-extrabold text-white leading-tight">职业测评</h1>
                  <p className="text-sm text-white/75 mt-1 leading-relaxed">
                    用一组兴趣问题认识自己的职业倾向：答完会得到一个三字码，对应六种职业兴趣类型。
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {view.questionCount > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs bg-white/10 text-white/85 border border-white/20">
                    霍兰德六型 · {view.questionCount} 题
                  </span>
                )}
                {view.estimatedMinutes > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs bg-white/10 text-white/85 border border-white/20">
                    约 {view.estimatedMinutes} 分钟
                  </span>
                )}
                {hasTerms && (
                  <button
                    type="button"
                    onClick={() => setShowTerms((v) => !v)}
                    aria-expanded={showTerms}
                    className="ml-auto inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs bg-white/10 text-white/85 border border-white/20 hover:bg-white/20 transition-colors"
                  >
                    测评说明与署名
                    <ChevronDown
                      size={13}
                      aria-hidden
                      className={`transition-transform ${showTerms ? "rotate-180" : ""}`}
                    />
                  </button>
                )}
              </div>
              {showTerms && hasTerms && (
                <div className="mt-3 rounded-xl bg-white/10 border border-white/15 p-3 space-y-1.5">
                  <p className="text-xs text-white/80 leading-relaxed">{meta?.attribution}</p>
                  <p className="text-xs text-white/70 leading-relaxed">{meta?.licenseText}</p>
                  <p className="text-xs text-white/70 leading-relaxed">{meta?.disclaimer}</p>
                </div>
              )}
            </section>

            {/* 加载 / 失败 / 未开放 / 三态 */}
            {loading ? (
              <section className="bg-card rounded-xl border border-border-soft p-10 text-center">
                <p className="text-sm text-muted">测评状态加载中...</p>
              </section>
            ) : loadError ? (
              <section className="bg-card rounded-xl border border-border-soft p-8 text-center space-y-4">
                <p className="text-sm text-red-500">{loadError}</p>
                <button type="button" onClick={() => void load()} className={SECONDARY_BUTTON}>
                  重试
                </button>
              </section>
            ) : unavailable ? (
              <section className="bg-card rounded-xl border border-border-soft p-8 text-center space-y-2">
                <p className="text-sm font-medium text-foreground">暂无可用测评</p>
                <p className="text-xs text-muted">老师还没有开放职业测评，稍后再来看看吧。</p>
              </section>
            ) : (
              <>
                {/* 状态卡：未开始 / 进行中 / 已完成 */}
                <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-semibold text-foreground">我的测评</h2>
                    <StatusBadge status={view.status} />
                    {!view.enabled && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        当前未开放
                      </span>
                    )}
                    {view.enabled && view.status === "completed" && view.typeCode && (
                      <span className="ml-auto px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300 tracking-wide">
                        {view.typeCode}
                      </span>
                    )}
                  </div>

                  {view.status === "not-started" && (
                    <>
                      <p className="text-sm text-muted leading-relaxed">
                        还没有做过职业兴趣测评。全部答完大约需要 {view.estimatedMinutes || "几"} 分钟，作答会自动保存，可以中途退出。
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <Fact icon={ListChecks} label="题量" value={`${view.questionCount} 题`} />
                        <Fact icon={Timer} label="预计耗时" value={`约 ${view.estimatedMinutes || "—"} 分钟`} />
                        <Fact icon={Compass} label="结果形式" value="三字码 + 六型分布" />
                      </div>
                      {canStart ? (
                        <Link href={QUIZ_HREF} className={PRIMARY_BUTTON}>
                          <Play size={16} aria-hidden />
                          开始测评
                        </Link>
                      ) : (
                        <p className="text-xs text-muted">
                          {view.enabled ? "题库准备中，稍后再来。" : "测评当前未开放，开放后即可开始。"}
                        </p>
                      )}
                    </>
                  )}

                  {view.status === "in-progress" && (
                    <>
                      <p className="text-sm text-muted leading-relaxed">
                        上次答到第 {view.answered} 题就离开了，进度已经保存在服务端，继续作答会从上次的题接着往下。
                      </p>
                      <ProgressTrack view={view} />
                      <div className="flex flex-wrap items-center gap-2.5">
                        {canStart ? (
                          <Link href={QUIZ_HREF} className={PRIMARY_BUTTON}>
                            <Play size={16} aria-hidden />
                            继续作答
                          </Link>
                        ) : (
                          <p className="text-xs text-muted">测评当前未开放，已答进度会保留。</p>
                        )}
                        {view.typeCode && (
                          <p className="text-xs text-muted">
                            上一次结果：<span className="font-semibold text-foreground">{view.typeCode}</span>
                          </p>
                        )}
                      </div>
                    </>
                  )}

                  {view.status === "completed" && (
                    <>
                      <p className="text-sm text-muted leading-relaxed">
                        你已经完成过这个测评{view.completedAt ? `（${view.completedAt}）` : ""}。
                        {view.typeCode
                          ? "结果解读与职业推荐在「我的档案」里查看。"
                          : "结果已保存，可在「我的档案」里查看。"}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <Fact
                          icon={Compass}
                          label="三字码"
                          value={view.typeCode ?? "已出分"}
                        />
                        <Fact icon={Timer} label="完成时间" value={view.completedAt || "—"} />
                        <Fact
                          icon={ListChecks}
                          label="历史版本"
                          value={view.historyCount > 1 ? `${view.historyCount} 次` : "1 次"}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Link href={REPORT_HREF} className={PRIMARY_BUTTON}>
                          查看报告
                          <ArrowRight size={16} aria-hidden />
                        </Link>
                        {canStart && (
                          <Link href={QUIZ_HREF} className={SECONDARY_BUTTON}>
                            <RotateCcw size={16} aria-hidden />
                            再测一次
                          </Link>
                        )}
                      </div>
                    </>
                  )}
                </section>

                {/* 科普说明（内容卡细节由 B3 扩展，这里先给最小可用版本） */}
                <section className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-1 h-4 rounded-full bg-accent" aria-hidden />
                    <h2 className="text-sm font-semibold text-foreground">关于这个测评</h2>
                  </div>
                  <ul className="space-y-2 text-sm text-muted leading-relaxed">
                    <li>· 题目问的是「你愿不愿意做这类事」，没有对错，按第一感觉选就好。</li>
                    <li>· 每题作答后立即保存；中途关掉页面，下次进来会从上次的题继续。</li>
                    <li>· 提交后立刻生成三字码与六型兴趣得分，结果只用于职业兴趣探索参考。</li>
                  </ul>
                  {meta?.dimensions && meta.dimensions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {meta.dimensions.map((d) => (
                        <span
                          key={d.key}
                          className="px-2.5 py-1 rounded-full text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                        >
                          {d.label}
                          <span className="ml-1 text-[10px] text-muted">{d.key}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
