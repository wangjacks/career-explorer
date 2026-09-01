"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Toaster } from "sonner";
import NavigationBar from "@/components/NavigationBar";
import FormSteps from "@/components/FormSteps";
import { useSession } from "@/hooks/useSession";
import { useProfileDraft } from "@/hooks/useProfileDraft";
import LoginGateStep, { type ProfileInfo } from "./steps/LoginGateStep";
import TagsStep from "./steps/TagsStep";
import WordcloudStep from "./steps/WordcloudStep";
import EvaluationStep from "./steps/EvaluationStep";
import AvatarStep from "./steps/AvatarStep";
import ConfirmStep from "./steps/ConfirmStep";
import CompleteStep from "./steps/CompleteStep";

const STEP_ORDER = ["login", "tags", "wordcloud", "evaluation", "avatar", "confirm", "complete"] as const;
type Step = (typeof STEP_ORDER)[number];

const STEP_TITLES: Record<Step, string> = {
  login: "创建档案",
  tags: "标签填写",
  wordcloud: "词云展示",
  evaluation: "评价词云",
  avatar: "虚拟形象",
  confirm: "最终确认",
  complete: "提交完成",
};

/**
 * 档案创建表单（Issue #99）：单路由容器，步骤以 ?step= 切换。
 * 流程：登录门 → 标签 → 词云 → 评价 → 形象 → 确认（延迟上传在此执行）→ 完成。
 */
function CreateProfileForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, checking } = useSession();
  const draft = useProfileDraft();

  const rawStep = searchParams.get("step") ?? "login";
  const step: Step = (STEP_ORDER as readonly string[]).includes(rawStep)
    ? (rawStep as Step)
    : "login";

  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [submittedTagCount, setSubmittedTagCount] = useState(0);
  // 草稿恢复提示上下文：gate = 登录页加载时预检发现；midflow = 中途刷新/直接访问表单步骤时
  const [draftPrompt, setDraftPrompt] = useState<"gate" | "midflow" | null>(null);
  const enteredRef = useRef(false);
  // 登录页加载即预检：已提交引导去面板 / 已截止拦截（#96）/ 存在草稿直接提示，不等用户点「下一步」
  const [precheckedSubmitted, setPrecheckedSubmitted] = useState(false);
  const [precheckedClosed, setPrecheckedClosed] = useState(false);
  const [precheckedDeadline, setPrecheckedDeadline] = useState<string | null>(null);
  const precheckedRef = useRef(false);
  // 草稿检查每次页面加载（刷新/直接访问）只执行一次；步骤间跳转（router.push）不会重复触发
  const mountCheckedRef = useRef(false);

  const goTo = (next: Step) => {
    router.push(`/form/create-profile?step=${next}`);
  };

  const storedHasDraft = draft.storedHasDraft;

  // 非登录门步骤要求已登录学生身份（含直接拼 URL 进入的防护）
   
  useEffect(() => {
    if (checking) return;
    if (step !== "login" && step !== "complete" && (!session || session.role !== "student")) {
      router.replace("/form/create-profile");
    }
  }, [checking, session, step, router]);
   

  // 完成页刷新后无提交上下文：回落登录门
   
  useEffect(() => {
    if (step === "complete" && !checking && session?.role !== "student") {
      router.replace("/form/create-profile");
    }
  }, [step, checking, session, router]);
   

  const handleEnter = (p: ProfileInfo) => {
    setProfile(p);
    if (!enteredRef.current && storedHasDraft()) {
      enteredRef.current = true;
      setDraftPrompt("gate");
      return;
    }
    goTo("tags");
  };

  // 登录页加载即预检档案状态（无需等用户交互）：已提交 → 引导面板；未提交且有草稿 → 直接提示恢复
  useEffect(() => {
    if (checking || !session || session.role !== "student") return;
    if (step !== "login" || precheckedRef.current || enteredRef.current) return;
    precheckedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/shared/profile");
        const data = await res.json();
        if (cancelled || !res.ok) return;
        // 提交时限（#96）：截止优先于其他分支，任何学生均不可进入流程
        if (data.submissionClosed) {
          setPrecheckedDeadline(typeof data.submissionDeadline === "string" ? data.submissionDeadline : null);
          setPrecheckedClosed(true);
          return;
        }
        if (data.submitted_at) {
          setPrecheckedSubmitted(true);
          return;
        }
        if (storedHasDraft()) setDraftPrompt("gate");
      } catch {
        // 预检失败不阻断：用户点「下一步」时 LoginGateStep 会再次查询并提示错误
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checking, session, step, storedHasDraft]);

  // 中途刷新/直接访问表单步骤的草稿恢复提示：
  // 每次页面加载只检查一次（mountCheckedRef），仅刷新/直接访问会触发；
  // 步骤间跳转（同一次页面加载内）绝不重复提示。
  useEffect(() => {
    if (checking || mountCheckedRef.current) return;
    if (!session || session.role !== "student") return;
    if (step === "login" || step === "complete") return; // 登录页由加载预检处理，完成页无草稿概念
    mountCheckedRef.current = true;
    if (!enteredRef.current && storedHasDraft()) {
      enteredRef.current = true;
      setDraftPrompt("midflow");
    }
  }, [checking, session, step, storedHasDraft]);

  const continueDraft = () => {
    const ctx = draftPrompt;
    enteredRef.current = true;
    setDraftPrompt(null);
    if (ctx === "gate") goTo("tags");
  };

  const restartDraft = () => {
    draft.clearDraft();
    enteredRef.current = true;
    setDraftPrompt(null);
    goTo("tags");
  };

  const handleSubmitted = () => {
    setSubmittedTagCount(draft.tags.length);
    draft.clearDraft();
    goTo("complete");
  };

  const showFormSteps = step !== "login" && step !== "complete";
  const stepIndex = STEP_ORDER.indexOf(step) + 1;
  const studentName = session?.name ?? "";

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Toaster position="top-center" />
      <NavigationBar title={STEP_TITLES[step]} showBack={step !== "login"} showHome={step === "login"} />
      {showFormSteps && (
        <div className="pt-5">
          <FormSteps current={stepIndex} />
        </div>
      )}

      {step === "login" && (
        <main className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
          <LoginGateStep
            precheckedSubmitted={precheckedSubmitted}
            precheckedClosed={precheckedClosed}
            precheckedDeadline={precheckedDeadline}
            onEnter={handleEnter}
          />
        </main>
      )}
      {step === "tags" && (
        <TagsStep
          draft={draft}
          studentName={studentName}
          onBack={() => goTo("login")}
          onNext={() => goTo("wordcloud")}
        />
      )}
      {step === "wordcloud" && (
        <WordcloudStep tags={draft.tags} onBack={() => goTo("tags")} onNext={() => goTo("evaluation")} />
      )}
      {step === "evaluation" && (
        <EvaluationStep draft={draft} onBack={() => goTo("wordcloud")} onNext={() => goTo("avatar")} />
      )}
      {step === "avatar" && (
        <AvatarStep draft={draft} onBack={() => goTo("evaluation")} onNext={() => goTo("confirm")} />
      )}
      {step === "confirm" && (
        <ConfirmStep
          draft={draft}
          studentName={studentName}
          onBack={() => goTo("avatar")}
          onSubmitted={handleSubmitted}
        />
      )}
      {step === "complete" && (
        <CompleteStep studentName={studentName} userCode={profile?.user_code ?? ""} tagCount={submittedTagCount} />
      )}

      {/* 草稿恢复提示：任意步骤中途刷新/再次进入且存在草稿时询问 */}
      {draftPrompt !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-card rounded-2xl shadow-xl max-w-sm sm:max-w-md w-full p-6 space-y-5">
            <div className="text-center space-y-2">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                已经填写了一些信息，是否继续档案创建流程？
              </h3>
              <p className="text-sm text-muted">
                选择继续将保留已填写的内容；重新开始会删除本地预存的全部数据。
              </p>
            </div>
            <div className="space-y-2">
              <button
                onClick={continueDraft}
                className="w-full py-3 bg-primary hover:bg-primary-strong text-white font-medium rounded-xl transition-colors"
              >
                继续填写
              </button>
              <button
                onClick={restartDraft}
                className="w-full py-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium rounded-xl transition-colors"
              >
                重新开始
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CreateProfilePage() {
  return (
    <Suspense fallback={null}>
      <CreateProfileForm />
    </Suspense>
  );
}
