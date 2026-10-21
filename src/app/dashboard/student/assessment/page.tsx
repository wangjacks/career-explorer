"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Compass, ListChecks, Play, RotateCcw, Timer, type LucideIcon } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import StudentSidebar from "@/components/student/StudentSidebar";
import AssessmentListCard from "@/components/student/assessment/AssessmentListCard";
import AssessmentLinksCard from "@/components/student/assessment/AssessmentLinksCard";
import AssessmentAttributionCard from "@/components/student/assessment/AssessmentAttributionCard";
import RiasecGuideCard from "@/components/student/assessment/RiasecGuideCard";
import BigFiveGuideCard from "@/components/student/assessment/BigFiveGuideCard";
import { useSession } from "@/hooks/useSession";
import { IPIP_NEO_FFI_CODE, RIASEC_CODE } from "@/lib/assessment-data";
import { deriveAssessmentCenter, estimateMinutes, type AssessmentCenterView } from "@/lib/assessment-center";
import {
  assessmentCenterPayloadOf,
  buildAssessmentList,
  deriveLatestActive,
  normalizeAssessmentList,
  quizHref,
  resultFormCopy,
} from "@/lib/assessment-list";

/** `GET /api/shared/assessment/list` 的返回（只声明本页用到的字段，逐项由 `normalizeAssessmentList` 归一） */
interface AssessmentListPayload {
  assessments?: unknown[];
}

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
 * 职业测评中心（#222 骨架 + #225 内容卡 + #291 多量表）：入口、状态、科普与授权说明。
 * 结果解读与职业推荐在「我的档案」（#224）。
 *
 * 状态来自 `GET /api/shared/assessment/list`：每套启用的量表各带本人在该量表上的
 * 三态 / 三字码 / 草稿进度，页面据此渲染「我的测评」（最近活跃量表）与多行清单。
 * 「最近活跃」与逐行状态是纯函数（`src/lib/assessment-list.ts`），三态口径仍复用
 * `src/lib/assessment-center.ts`，本页不缓存作答内容，也不做任何计分。
 * 内容卡（清单 / 六型科普 / 大五科普 / 权威渠道 / 授权免责）的文案与结构在
 * `src/lib/assessment-center-content.ts` + `src/components/student/assessment/`，接口不可用时也常驻。
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

  const [payload, setPayload] = useState<AssessmentListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 成功拉到列表才置 true：科普卡据此决定是否按「已启用量表」渲染（加载中不闪变） */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!checking && (!session || session.role !== "student")) {
      router.replace("/login");
    }
  }, [checking, session, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/shared/assessment/list");
      // 会话过期：留在页面上重试只会一直 401，直接回登录页
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "测评状态加载失败");
      setPayload(data as AssessmentListPayload);
      setLoaded(true);
    } catch (err) {
      console.error("Failed to load assessment center:", err);
      setLoaded(false);
      setLoadError(err instanceof Error ? err.message : "测评状态加载失败");
    } finally {
      setLoading(false);
    }
  }, [router]);

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

  const items = normalizeAssessmentList(payload?.assessments);
  const listRows = buildAssessmentList(items);
  // 「我的测评」卡展示最近活跃的那套：有草稿优先 → 最近完成 → 主测评兜底
  const latest = deriveLatestActive(items);
  const view = deriveAssessmentCenter(latest ? assessmentCenterPayloadOf(latest) : null);
  // Hero 的题量徽章取主测评（霍兰德）；主测评被停用时退回列表第一套
  const primary = items.find((item) => item.code === RIASEC_CODE) ?? items[0] ?? null;
  const canStart = view.enabled && view.questionCount > 0;
  const unavailable = !loading && !loadError && loaded && items.length === 0;
  // 科普卡跟着「启用的量表」走：停用大五时不出现大五科普，单量表页面与 #225 时一致
  const showRiasecGuide = !loaded || items.length === 0 || items.some((item) => item.code === RIASEC_CODE);
  const showBigFiveGuide = loaded && items.some((item) => item.code === IPIP_NEO_FFI_CODE);

  return (
    <div className="min-h-screen bg-background">
      <NavigationBar title="职业测评" showHome onToggleSidebar={() => setSidebarOpen((v) => !v)} />

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
                    用几组问题认识自己的职业兴趣与性格特点，结果解读会出现在「我的档案」里。
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {primary && primary.questionCount > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs bg-white/10 text-white/85 border border-white/20">
                    {primary.name} · {primary.questionCount} 题
                  </span>
                )}
                {primary && primary.questionCount > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs bg-white/10 text-white/85 border border-white/20">
                    约 {estimateMinutes(primary.questionCount)} 分钟
                  </span>
                )}
                {/* 跳到页底授权区（#225）：署名与免责全文在那里常驻，hero 里不再收一份折叠面板 */}
                <a
                  href="#assessment-attribution"
                  className="ml-auto inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs bg-white/10 text-white/85 border border-white/20 hover:bg-white/20 transition-colors"
                >
                  测评说明与署名
                  <ArrowRight size={13} aria-hidden />
                </a>
              </div>
            </section>

            {/* 加载 / 失败 / 空列表 / 「我的测评」三态 */}
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
            ) : unavailable || !latest ? (
              <section className="bg-card rounded-xl border border-border-soft p-8 text-center space-y-2">
                <p className="text-sm font-medium text-foreground">暂无可用测评</p>
                <p className="text-xs text-muted">老师还没有开放测评，稍后再来看看吧。</p>
              </section>
            ) : (
              /* 状态卡：展示最近活跃量表（草稿优先 → 最近完成 → 主测评兜底） */
              <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-semibold text-foreground">我的测评</h2>
                  <StatusBadge status={view.status} />
                  {view.status === "completed" && view.typeCode && (
                    <span className="ml-auto px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300 tracking-wide">
                      {view.typeCode}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted">最近活跃：{latest.name}</p>

                {view.status === "not-started" && (
                  <>
                    <p className="text-sm text-muted leading-relaxed">
                      {view.questionCount > 0
                        ? `还没有做过「${latest.name}」。每次 ${view.questionCount} 题，全部答完大约需要 ${view.estimatedMinutes} 分钟，作答会自动保存，可以中途退出。`
                        : `还没有做过「${latest.name}」，题库还在准备中。`}
                    </p>
                    {view.questionCount > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <Fact
                          icon={ListChecks}
                          label="题量"
                          value={
                            view.poolSize > view.questionCount
                              ? `每次 ${view.questionCount} 题 · 题库 ${view.poolSize} 题`
                              : `每次 ${view.questionCount} 题`
                          }
                        />
                        <Fact icon={Timer} label="预计耗时" value={`约 ${view.estimatedMinutes} 分钟`} />
                        <Fact icon={Compass} label="结果形式" value={resultFormCopy(latest.scoringMode)} />
                      </div>
                    )}
                    {canStart ? (
                      <Link href={quizHref(latest.code)} className={PRIMARY_BUTTON}>
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
                      {view.draftComplete
                        ? `「${latest.name}」的题目已经全部答完，只差提交了——继续作答可以直接提交并查看结果。`
                        : `你在「${latest.name}」上还有一轮没答完：上次答到第 ${view.answered} 题就离开了，进度已经保存在服务端，继续作答会从上次的题接着往下。`}
                    </p>
                    <ProgressTrack view={view} />
                    <div className="flex flex-wrap items-center gap-2.5">
                      {canStart ? (
                        <Link href={quizHref(latest.code)} className={PRIMARY_BUTTON}>
                          <Play size={16} aria-hidden />
                          {view.draftComplete ? "去提交" : "继续作答"}
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
                      你已经完成过「{latest.name}」{view.completedAt ? `（${view.completedAt}）` : ""}。
                      {latest.scoringMode === "dimensional"
                        ? "结果已保存在「我的档案」里，可以查看五个人格方面的相对位置。"
                        : "结果解读与职业推荐在「我的档案」里查看。"}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {latest.scoringMode === "dimensional" ? (
                        <Fact icon={Compass} label="结果形式" value={resultFormCopy(latest.scoringMode)} />
                      ) : (
                        <Fact icon={Compass} label="三字码" value={view.typeCode ?? "已出分"} />
                      )}
                      <Fact icon={Timer} label="完成时间" value={view.completedAt || "—"} />
                      <Fact
                        icon={ListChecks}
                        label="结果版本"
                        value={`${view.historyCount}${view.historyCapped ? "+" : ""} 次`}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Link href={REPORT_HREF} className={PRIMARY_BUTTON}>
                        查看报告
                        <ArrowRight size={16} aria-hidden />
                      </Link>
                      {canStart && (
                        <Link href={quizHref(latest.code)} className={SECONDARY_BUTTON}>
                          <RotateCcw size={16} aria-hidden />
                          再测一次
                        </Link>
                      )}
                    </div>
                  </>
                )}
              </section>
            )}

            {/* 内容卡（#225 / #291）：清单、科普、权威渠道与授权说明——接口不可用 / 加载失败时也常驻，
                学生至少能看到去哪儿做别的测评以及结果怎么读 */}
            {listRows.length > 0 && <AssessmentListCard rows={listRows} />}
            {showRiasecGuide && <RiasecGuideCard />}
            {showBigFiveGuide && <BigFiveGuideCard />}
            <AssessmentLinksCard />
            <AssessmentAttributionCard
              attribution={primary?.attribution}
              licenseText={primary?.licenseText}
              disclaimer={primary?.disclaimer}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
