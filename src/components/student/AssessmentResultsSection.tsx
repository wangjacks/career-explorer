"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import ProfileSectionHeader from "./ProfileSectionHeader";
import AssessmentResultCard from "./AssessmentResultCard";
import { CROSS_SCALE_LINKS, type AssessmentResultsPayload, type AssessmentScaleMeta } from "@/lib/assessment-view";

/**
 * 「我的档案」里的测评结果区（#224 + #292）：按**量表清单循环渲染每套量表的结果卡**。
 *
 * 数据口径：
 * - 首次请求不带 code，拿到主测评（霍兰德）的完整结果 + `assessments` 已启用量表清单（#292，
 *   清单只随缺省请求下发，按 code 的单套查询保持既有响应形状）；
 * - 其余量表按 `?code=` 各自补拉，单套失败只影响那一张卡，不拖垮整个结果区；
 * - 全部数据由本组件持有，结果卡只负责按计分模式分流渲染（不再各自 fetch）。
 *
 * 与档案提交流程仍然完全解耦：不看 `submissionClosed`、不参与档案版本快照。
 * 两套量表都有当前结果时，在卡片下方补一张「人格与兴趣一起看」提示卡（#292）。
 */
export default function AssessmentResultsSection() {
  const [scales, setScales] = useState<AssessmentScaleMeta[]>([]);
  const [payloads, setPayloads] = useState<Record<string, AssessmentResultsPayload>>({});
  const [failedCodes, setFailedCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    setFailedCodes([]);
    try {
      const res = await fetch("/api/shared/assessment/results");
      const payload = (await res.json()) as AssessmentResultsPayload & { error?: string };
      if (!res.ok) throw new Error(payload?.error || "测评结果加载失败");
      const list =
        Array.isArray(payload.assessments) && payload.assessments.length > 0
          ? payload.assessments
          : [payload.assessment];
      setScales(list);
      setPayloads({ [payload.assessment.code]: payload });

      // 其余量表并行补拉：单套失败只记在这一张卡上
      const rest = list.filter((item) => item.code !== payload.assessment.code);
      const failures: string[] = [];
      const loaded = await Promise.all(
        rest.map(async (item) => {
          try {
            const res2 = await fetch(`/api/shared/assessment/results?code=${encodeURIComponent(item.code)}`);
            const data = await res2.json();
            if (!res2.ok) throw new Error(data?.error || "测评结果加载失败");
            return [item.code, data as AssessmentResultsPayload] as const;
          } catch (err) {
            console.error(`Failed to load assessment results (${item.code}):`, err);
            failures.push(item.code);
            return null;
          }
        })
      );
      setPayloads((prev) => {
        const next = { ...prev };
        for (const row of loaded) {
          if (row) next[row[0]] = row[1];
        }
        return next;
      });
      setFailedCodes(failures);
    } catch (err) {
      console.error("Failed to load assessment results:", err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- 结果区进入时读取本人各量表结果（与档案数据并列、互不依赖） */
  useEffect(() => {
    void load();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (loading) {
    return (
      <section className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
        <ProfileSectionHeader label="职业测评" />
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          正在读取测评结果…
        </p>
      </section>
    );
  }

  if (failed) {
    return (
      <section className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
        <ProfileSectionHeader label="职业测评" />
        <p className="text-sm text-muted">测评结果暂时读不到</p>
        <button
          type="button"
          onClick={() => void load()}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition-colors"
        >
          重试
        </button>
      </section>
    );
  }

  const completedCount = scales.filter((item) => payloads[item.code]?.current).length;

  return (
    <div className="space-y-5">
      {scales.map((item) => {
        const data = payloads[item.code];
        if (!data) {
          // 单套补拉失败：只让这张卡显示重试，不影响其他量表
          return (
            <section key={item.code} className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
              <ProfileSectionHeader label={item.name} />
              <p className="text-sm text-muted">这套测评的结果暂时读不到</p>
              {failedCodes.includes(item.code) && (
                <button
                  type="button"
                  onClick={() => void load()}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition-colors"
                >
                  重试
                </button>
              )}
            </section>
          );
        }
        return <AssessmentResultCard key={item.code} code={item.code} data={data} />;
      })}

      {completedCount >= 2 && <CrossScaleTipCard />}
    </div>
  );
}

/** 「人格与兴趣一起看」提示卡（#292）：两套结果都完成时出现，用学生语言解释三组常见对应关系 */
function CrossScaleTipCard() {
  return (
    <section className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-accent" aria-hidden />
        <h2 className="text-sm font-semibold text-foreground">人格与兴趣一起看</h2>
      </div>
      <p className="text-xs text-muted leading-relaxed">
        兴趣和性格常常互相印证。这两份结果放在一起对照，能帮你看得更清楚：
      </p>
      <ul className="space-y-2">
        {CROSS_SCALE_LINKS.map((link) => (
          <li key={`${link.riasec}-${link.bigFive}`} className="rounded-lg bg-background px-3 py-2">
            <p className="text-xs font-medium text-foreground">
              {link.riasecLabel} × {link.bigFiveLabel}
            </p>
            <p className="mt-0.5 text-xs text-muted leading-relaxed">{link.text}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted leading-relaxed">
        两边没有同时高也很正常：兴趣会被经历改变，性格相对稳定，放在一起看是互补，不是互相否定。
      </p>
    </section>
  );
}
