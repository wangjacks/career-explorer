"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Compass } from "lucide-react";
import CollapsibleCard from "./CollapsibleCard";
import HollandCodeBadge from "./HollandCodeBadge";
import ChartLoadingPlaceholder from "./ChartLoadingPlaceholder";
import FiveFactorResultCard from "./FiveFactorResultCard";

/** 雷达图按需加载（#324）：折叠卡展开前不下载 recharts；`ssr:false` 因为图表依赖容器宽度 */
const RiasecRadarChart = dynamic(() => import("./RiasecRadarChart"), {
  ssr: false,
  loading: () => <ChartLoadingPlaceholder />,
});
import { formatResultTime } from "@/lib/assessment-flow";
import { deriveAssessmentCenter } from "@/lib/assessment-center";
import {
  buildResultTrailing,
  buildRiasecBars,
  buildRiasecInterpretations,
  hasScoreSnapshot,
  resultCardMode,
  resultCardStatus,
  scoreSnapshotNotice,
  type AssessmentResultsPayload,
  type CareerCardView,
} from "@/lib/assessment-view";

/**
 * 答题页入口：空态 / 重测 / 继续作答都走这里，并带上本量表的 code（#289 起答题页按 `?code=` 取量表）
 */
function quizHref(code: string): string {
  return `/dashboard/student/assessment/quiz?code=${encodeURIComponent(code)}`;
}

/** 合规指针（#322）：声明全文只在页尾出现一次，结果卡里只留这一行 */
function CompliancePointer() {
  return (
    <p className="text-xs leading-relaxed text-muted">
      本测评的署名、授权与免责声明见页尾
      <a
        href="#assessment-attribution"
        className="ml-1 text-primary-strong underline underline-offset-2 hover:no-underline"
      >
        「关于这些测评」
      </a>
      。
    </p>
  );
}

/**
 * 单套量表的结果卡（#224 + #292 + #322）：**在入口按计分模式分流**。
 *
 * - `dimensional`（大五人格）→ `FiveFactorResultCard`：画像标签 + 五维雷达/排名/高低分解读，无三字码、无职业推荐；
 * - `typological`（霍兰德）→ 沿用 #224 的卡：三字码 + 六型雷达/排名/解读 + 推荐职业。
 *
 * #322 起卡片默认收起：折叠态只显示量表名 + 已测/未测 + 题量/完成时间/次数，展开态保留原有全部信息量。
 * 数据由 `AssessmentResultsSection` 统一取好再传进来；本组件不再自己 fetch 结果或推荐职业。
 */
export default function AssessmentResultCard({
  code,
  data,
  careers,
  viewer = "student",
  id,
  open,
  onOpenChange,
  highlight = false,
}: {
  code: string;
  data: AssessmentResultsPayload;
  /** 展示受众（#332）：teacher 时不出现答题入口与「见页尾」合规指针（教师不能替学生作答） */
  viewer?: "student" | "teacher";
  careers: readonly CareerCardView[];
  /** 页面锚点（#323：速览卡定位到这里） */
  id?: string;
  /** 受控展开（#323）；不传则由折叠卡自管 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 被摘要卡定位时短暂高亮（#323） */
  highlight?: boolean;
}) {
  const current = data.current;
  const mode = resultCardMode(data.assessment);
  const status = resultCardStatus(data);

  // 无结果：折叠卡 + 标题右侧直达该量表的答题页；展开后才是说明与进度
  if (!current) {
    const assessmentView = deriveAssessmentCenter(data);
    const meta =
      data.inProgress
        ? `上次答到 ${assessmentView.answered}/${assessmentView.total} 题`
        : [
            assessmentView.questionCount > 0 ? `${assessmentView.questionCount} 道题` : "",
            assessmentView.estimatedMinutes > 0 ? `约 ${assessmentView.estimatedMinutes} 分钟` : "",
          ]
            .filter(Boolean)
            .join(" · ") || "题目准备中";
    return (
      <CollapsibleCard
        id={id}
        title={data.assessment.name}
        status={status}
        subtitle={meta}
        open={open}
        onOpenChange={onOpenChange}
        highlight={highlight}
        action={
          viewer === "teacher" ? undefined : (
            <Link
              href={quizHref(code)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-strong"
            >
              <Compass className="h-3.5 w-3.5" aria-hidden />
              {data.inProgress ? "继续作答" : "去测评"}
            </Link>
          )
        }
      >
        <p className="text-sm text-muted leading-relaxed">
          {viewer === "teacher"
            ? "该生还没有完成这套测评。需要补测时，请该生登录后进入「职业测评」重新作答；每次提交都会生成新版本，旧版本保留可查。"
            : mode === "big-five"
              ? "做完可以看到你的五大人格画像，了解自己在哪些方面更有优势。"
              : "做完可以看到你的兴趣类型，以及可能适合你的职业方向。"}
        </p>
        {data.inProgress && (
          <p className="text-xs text-muted">上次答到 {assessmentView.answered}/{assessmentView.total} 题，可以接着做。</p>
        )}
      </CollapsibleCard>
    );
  }

  if (mode === "big-five") {
    return (
      <FiveFactorResultCard
        data={data}
        code={code}
        viewer={viewer}
        id={id}
        open={open}
        onOpenChange={onOpenChange}
        highlight={highlight}
      />
    );
  }

  // 霍兰德卡（#224 原有内容）：按行排列的六型视图 + 推荐职业
  // 快照缺失 / 损坏时不画六条与雷达：空数组进 builder 会得到六条 0 分和全零多边形（#234/#332）
  const hasSnapshot = hasScoreSnapshot(current.scores);
  const bars = hasSnapshot ? buildRiasecBars(current.scores, current.typeCode) : [];
  const interpretations = hasSnapshot ? buildRiasecInterpretations(current.scores, current.typeCode) : [];
  const completedAt = formatResultTime(current.completedAt);
  const trailing = buildResultTrailing({
    questionCount: current.questionCount,
    completedAt,
    historyCount: data.history.length,
  });

  return (
    <CollapsibleCard
      id={id}
      title={data.assessment.name}
      status={status}
      subtitle={trailing}
      open={open}
      onOpenChange={onOpenChange}
      highlight={highlight}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <HollandCodeBadge typeCode={current.typeCode} viewer={viewer} />
        {viewer === "student" && (
          <Link
            href={quizHref(code)}
            className="inline-flex items-center justify-center px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition-colors flex-shrink-0"
          >
            {data.inProgress ? "继续作答" : "重新测评"}
          </Link>
        )}
      </div>

      {hasSnapshot ? (
        <>
          {/* 两种视图并列：雷达看整体形状，条状排名看具体高低；窄屏上下堆叠 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="min-w-0">
              <RiasecRadarChart scores={current.scores} />
            </div>
            <ul className="min-w-0 space-y-2.5" aria-label="六型兴趣得分排名">
              {bars.map((bar) => (
                <li key={bar.key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-foreground">
                      {bar.label}
                      {bar.isTop && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400">
                          主要兴趣
                        </span>
                      )}
                    </span>
                    <span className="text-muted font-mono text-xs">{bar.standard.toFixed(1)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${bar.percent}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">六型逐条解读</h3>
            <ul className="space-y-2">
              {interpretations.map((item) => (
                <li key={item.key} className="rounded-lg bg-background px-3 py-2">
                  <p className="text-sm font-medium text-foreground">
                    {item.label}
                    {item.isTop && <span className="ml-1.5 text-xs text-muted">主要兴趣</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-muted leading-relaxed">{item.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <p className="rounded-lg bg-background px-3 py-2 text-xs leading-relaxed text-muted">
          {scoreSnapshotNotice(viewer)}
        </p>
      )}

      {/* 推荐职业（#226）：无数据/接口失败时整块不渲染；CC BY 署名收编到页尾授权卡 */}
      {careers.length > 0 && (
        <div className="space-y-3 border-t border-border-soft pt-4">
          <h3 className="text-sm font-medium text-foreground">可能适合你的职业</h3>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {careers.map((career) => (
              <li key={career.code} className="rounded-lg border border-border-soft bg-background px-3 py-2">
                <p className="text-sm text-foreground">{career.displayName}</p>
                <p className="mt-0.5 text-[11px] text-muted/80">{career.englishName}</p>
                {career.meta && <p className="mt-1 text-xs text-muted">{career.meta}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {viewer === "student" && <CompliancePointer />}
    </CollapsibleCard>
  );
}