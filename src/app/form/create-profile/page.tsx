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
  const [draftPromptOpen, setDraftPromptOpen] = useState(false);
  const enteredRef = useRef(false);

  const goTo = (next: Step) => {
    router.push(`/form/create-profile?step=${next}`);
  };

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
    if (!enteredRef.current && draft.storedHasDraft()) {
      enteredRef.current = true;
      setDraftPromptOpen(true);
      return;
    }
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
          <LoginGateStep onEnter={handleEnter} />
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
      {step === "confirm" && profile && (
        <ConfirmStep
          draft={draft}
          studentName={studentName}
          profile={profile}
          onBack={() => goTo("avatar")}
          onSubmitted={handleSubmitted}
        />
      )}
      {step === "confirm" && !profile && (
        <main className="flex-1 flex items-center justify-center px-6">
          <p className="text-sm text-gray-400 dark:text-gray-500">缺少档案信息，请从第一步开始</p>
        </main>
      )}
      {step === "complete" && (
        <CompleteStep studentName={studentName} userCode={profile?.user_code ?? ""} tagCount={submittedTagCount} />
      )}

      {/* 草稿恢复提示：中途刷新/再次进入且存在草稿时询问 */}
      {draftPromptOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-card rounded-2xl shadow-xl max-w-sm sm:max-w-md w-full p-6 space-y-5">
            <div className="text-center space-y-2">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                已经填写了一些信息，是否继续档案创建流程？
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                选择继续将保留已填写的内容；重新开始会删除本地预存的全部数据。
              </p>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => {
                  setDraftPromptOpen(false);
                  goTo("tags");
                }}
                className="w-full py-3 bg-primary hover:bg-primary-strong text-white font-medium rounded-xl transition-colors"
              >
                继续填写
              </button>
              <button
                onClick={() => {
                  draft.clearDraft();
                  setDraftPromptOpen(false);
                  goTo("tags");
                }}
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
