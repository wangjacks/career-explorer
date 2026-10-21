"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Toaster, toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Compass, Loader2, RotateCcw } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useSession } from "@/hooks/useSession";
import { RIASEC_CODE } from "@/lib/assessment-data";
import { LIKERT_ANCHORS, formatResultTime, type AssessmentAnswers } from "@/lib/assessment-flow";
import type { DimensionScore } from "@/lib/assessment-scoring";

interface AssessmentMeta {
  code: string;
  name: string;
  /** 本轮题量（#282：启用抽题时是抽题数，不是题库总量） */
  questionCount: number;
  /** 题库总量（#283 的抽题说明用） */
  poolSize: number;
  scaleVersion: string;
  dimensions: { key: string; label: string }[];
  attribution: string;
  licenseText: string;
  disclaimer: string;
}

interface QuestionItem {
  index: number;
  prompt: string;
}

interface StartPayload {
  assessment: AssessmentMeta;
  questions: QuestionItem[];
  draft: { answers: Record<string, number>; updatedAt: string } | null;
  progress: { answered: number; total: number; percent: number };
  resumeIndex: number;
}

interface SubmitResult {
  id: number;
  typeCode: string | null;
  scores: DimensionScore[];
  completedAt: string | null;
  questionCount: number;
  scaleVersion: string;
  disclaimer: string;
}

/** 进度条：已答题数 / 总题数（琥珀为纯装饰，不承载小字） */
function ProgressBar({ answered, total }: { answered: number; total: number }) {
  const percent = total === 0 ? 0 : Math.round((answered / total) * 100);
  return (
    <div
      className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={answered}
      aria-label={`已答 ${answered} / ${total} 题`}
    >
      <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** 提交后的结果摘要：三字码 + 六维标准分（完整解读与职业推荐在「我的档案」测评区） */
function ResultSummary({
  result,
  attribution,
  licenseText,
  onRetry,
}: {
  result: SubmitResult;
  attribution: string;
  licenseText: string;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-5">
      <section className="bg-brand rounded-2xl p-5 sm:p-6 shadow-sm text-white">
        <p className="text-xs text-white/80">你的职业兴趣三字码</p>
        <p className="mt-1 text-4xl font-extrabold tracking-[0.2em]">{result.typeCode ?? "—"}</p>
        <p className="mt-3 text-sm text-white/90">
          已完成 {result.questionCount} 题，结果已保存
          {result.completedAt ? `（${formatResultTime(result.completedAt)}）` : ""}。
        </p>
      </section>

      <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">六型兴趣得分</h2>
        <ul className="space-y-3">
          {result.scores.map((score) => (
            <li key={score.key} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground">{score.label}</span>
                <span className="text-muted font-mono">{score.standard.toFixed(1)}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.max(0, Math.min(100, score.standard))}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 署名 / 授权 / 免责：O*NET 授权要求随结果展示；「未经官方审核」的声明也不能在结果页折掉 */}
      <footer className="pt-2 border-t border-border-soft space-y-1.5">
        <p className="text-xs text-muted leading-relaxed">{attribution}</p>
        <p className="text-xs text-muted leading-relaxed">{licenseText}</p>
        <p className="text-xs text-muted leading-relaxed">{result.disclaimer}</p>
      </footer>

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/dashboard/student"
          className="flex-1 text-center py-3 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-xl transition-colors"
        >
          返回学生面板
        </Link>
        <button
          type="button"
          onClick={onRetry}
          className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-xl transition-colors"
        >
          再测一次
        </button>
      </div>
    </div>
  );
}

/**
 * 职业兴趣测评答题页（#223）：单题单屏 + 进度条 + Likert 1-5。
 *
 * - **进度以服务端草稿为唯一真相**：每答一题即 `POST /answer` 落库，退出再进从上次题号继续（不用 localStorage）；
 * - 上一步可回头修改（再答一次覆盖同一题）；提交前二次确认，提交后由服务端计分并写结果快照；
 * - 认证走 `useSession`（/dashboard/student/* 不进 proxy），真正的权限判定仍在 API 路由内。
 */
export default function AssessmentQuizPage() {
  const router = useRouter();
  const { session, checking } = useSession();

  const [start, setStart] = useState<StartPayload | null>(null);
  const [answers, setAnswers] = useState<AssessmentAnswers>({});
  // 当前题在 questions 数组里的下标（题号 → 下标的换算只在加载 / 服务端回执处做一次）
  const [position, setPosition] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    if (!checking && (!session || session.role !== "student")) {
      router.replace("/login");
    }
  }, [checking, session, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/shared/assessment/start?code=${encodeURIComponent(RIASEC_CODE)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "测评加载失败");
      const payload = data as StartPayload;
      // 草稿的键在 JSON 里是字符串，统一成数字题号；续答落点由服务端算好（题号 → 下标）
      const restored: AssessmentAnswers = {};
      for (const [key, value] of Object.entries(payload.draft?.answers ?? {})) {
        restored[Number(key)] = Number(value);
      }
      const resumePosition = payload.questions.findIndex((q) => q.index === payload.resumeIndex);
      setStart(payload);
      setAnswers(restored);
      setPosition(resumePosition >= 0 ? resumePosition : 0);
    } catch (err) {
      console.error("Failed to load assessment:", err);
      setLoadError(err instanceof Error ? err.message : "测评加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- 会话确认后加载题面，与 useSession 同步 */
  useEffect(() => {
    if (session?.role === "student") void load();
  }, [session, load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const retry = () => {
    setResult(null);
    setAnswers({});
    setPosition(0);
    void load();
  };

  if (checking || !session || session.role !== "student") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-sm text-muted">加载中...</p>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-background">
        <Toaster position="top-center" />
        <NavigationBar title="职业兴趣测评" showHome />
        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 pb-16">
          <ResultSummary
            result={result}
            attribution={start?.assessment.attribution ?? ""}
            licenseText={start?.assessment.licenseText ?? ""}
            onRetry={retry}
          />
        </main>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <NavigationBar title="职业兴趣测评" showHome />
        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
          <div className="bg-card rounded-xl border border-border-soft p-10 text-center">
            <Loader2 className="w-6 h-6 mx-auto text-muted animate-spin" aria-hidden />
            <p className="text-sm text-muted mt-3">题目加载中...</p>
          </div>
        </main>
      </div>
    );
  }

  if (loadError || !start || start.questions.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <NavigationBar title="职业兴趣测评" showHome />
        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
          <div className="bg-card rounded-xl border border-border-soft p-10 text-center space-y-4">
            <p className="text-sm text-red-500">{loadError ?? "测评暂无题目"}</p>
            <button
              onClick={() => void load()}
              className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors"
            >
              重试
            </button>
          </div>
        </main>
      </div>
    );
  }

  const questions = start.questions;
  const total = questions.length;
  const current = questions[Math.min(position, total - 1)];
  const answeredCount = questions.filter((q) => answers[q.index] !== undefined).length;
  const allAnswered = answeredCount >= total;
  const selected = answers[current.index];
  const isFirst = position === 0;
  const isLast = position === total - 1;

  const selectAnswer = async (value: number) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/shared/assessment/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: start.assessment.code, questionIndex: current.index, value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setAnswers((prev) => ({ ...prev, [current.index]: value }));
      // 服务端回的是「下一个未答题」：连续作答时等同于自动翻到下一题
      if (typeof data.nextIndex === "number") {
        const nextPosition = questions.findIndex((q) => q.index === data.nextIndex);
        if (nextPosition >= 0) setPosition(nextPosition);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setConfirming(false);
    setSubmitting(true);
    try {
      const res = await fetch("/api/shared/assessment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: start.assessment.code }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 缺答（例如另一个标签页改了进度）时跳回第一个漏题，而不是把学生晾在原地
        const missing: number[] = Array.isArray(data.missingIndexes) ? data.missingIndexes : [];
        if (missing.length > 0) {
          const missingPosition = questions.findIndex((q) => q.index === missing[0]);
          if (missingPosition >= 0) setPosition(missingPosition);
        }
        throw new Error(data.error || "提交失败");
      }
      setResult(data.result as SubmitResult);
      toast.success("提交成功");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" />
      <NavigationBar title="职业兴趣测评" showHome />

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 pb-16 space-y-5 animate-[fade-in_0.2s_ease-out]">
        {/* 退出：进度在服务端草稿里，随时可以回来续答 */}
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/dashboard/student"
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft size={16} aria-hidden />
            返回学生面板
          </Link>
          <span className="text-xs text-muted">进度已自动保存</span>
        </div>

        {/* 进度 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-foreground">
              第 {position + 1} / {total} 题
            </span>
            <span className="text-muted">已答 {answeredCount} 题</span>
          </div>
          <ProgressBar answered={answeredCount} total={total} />
          {start.assessment.poolSize > total && (
            <p className="text-xs text-muted">
              本次题目从 {start.assessment.poolSize} 题题库中随机抽取 {total} 题，重测会换题。
            </p>
          )}
          <p className="text-xs text-muted">每次作答都会自动保存，中途离开可以从上次的题继续。</p>
        </section>

        {/* 题干 + Likert */}
        <section className="bg-card rounded-xl border border-border-soft p-5 sm:p-6 space-y-5">
          <p className="text-xs text-muted">{start.assessment.name}</p>
          <h1 className="text-lg sm:text-xl font-semibold text-foreground leading-relaxed">{current.prompt}</h1>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2" role="group" aria-label="选择你对这个活动的意愿">
            {LIKERT_ANCHORS.map((anchor) => {
              const active = selected === anchor.value;
              return (
                <button
                  key={anchor.value}
                  type="button"
                  onClick={() => void selectAnswer(anchor.value)}
                  disabled={saving}
                  aria-pressed={active}
                  className={`relative px-3 py-3 rounded-xl border text-sm font-medium transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                    active
                      ? "bg-primary border-primary text-white"
                      : "bg-card border-border-soft text-gray-700 dark:text-gray-200 hover:border-primary hover:bg-primary-soft dark:hover:bg-green-900/20"
                  }`}
                >
                  {anchor.label}
                  {active && <Check size={14} className="absolute top-1.5 right-1.5" aria-hidden />}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setPosition((p) => Math.max(0, p - 1))}
              disabled={isFirst}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 disabled:opacity-40 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors"
            >
              <ArrowLeft size={16} aria-hidden />
              上一步
            </button>
            {!isLast && selected !== undefined && (
              <button
                type="button"
                onClick={() => setPosition((p) => Math.min(total - 1, p + 1))}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors"
              >
                下一题
                <ArrowRight size={16} aria-hidden />
              </button>
            )}
            {saving && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <Loader2 size={14} className="animate-spin" aria-hidden />
                保存中...
              </span>
            )}
          </div>
        </section>

        {/* 提交区：答完才可提交 */}
        {allAnswered ? (
          <section className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Compass size={18} className="text-accent" aria-hidden />
              <p className="text-sm font-semibold text-foreground">全部答完啦</p>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              提交后会立刻算出你的职业兴趣三字码并保存这一份结果；之后想重测可以再来一次（会生成新的一次结果）。
            </p>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={submitting}
              className="w-full py-3 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {submitting ? "提交中..." : "提交并查看结果"}
            </button>
          </section>
        ) : (
          <p className="inline-flex items-center gap-2 text-xs text-muted">
            <RotateCcw size={14} aria-hidden />
            还有 {total - answeredCount} 题未作答，答完后即可提交。
          </p>
        )}

        {/* 署名 / 授权 / 免责（O*NET 授权要求随作答页展示） */}
        <footer className="pt-2 border-t border-border-soft space-y-1.5">
          <p className="text-xs text-muted leading-relaxed">{start.assessment.attribution}</p>
          <p className="text-xs text-muted leading-relaxed">{start.assessment.licenseText}</p>
          <p className="text-xs text-muted leading-relaxed">{start.assessment.disclaimer}</p>
        </footer>
      </main>

      <ConfirmDialog
        open={confirming}
        title="确认提交测评"
        message={`你已完成全部 ${total} 题。提交后立即算出结果并保存，本次结果记为当前版本；之后可以重新测评（历史结果保留）。`}
        confirmText="确认提交"
        onConfirm={() => void submit()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
