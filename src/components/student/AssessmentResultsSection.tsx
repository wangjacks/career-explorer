"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import ProfileSectionHeader from "./ProfileSectionHeader";
import AssessmentResultCard from "./AssessmentResultCard";
import {
  CROSS_SCALE_LINKS,
  resultCardMode,
  type AssessmentResultsPayload,
} from "@/lib/assessment-view";
import { normalizeAssessmentList, type AssessmentListItem } from "@/lib/assessment-list";

/**
 * 「我的档案」里的测评结果区（#224 + #292）：按**量表清单循环渲染每套量表的结果卡**。
 *
 * 数据口径（启用量表清单只有一个家，与 #291 对齐）：
 * - 先取 `GET /api/shared/assessment/list`（#291，只列启用中的量表）拿到有哪些量表；
 * - 再逐套按 `?code=` 取本人结果，单套失败只影响那一张卡，不拖垮整个结果区；
 * - 全部数据由本组件持有，结果卡只负责按计分模式分流渲染（不再各自 fetch）。
 *
 * 与档案提交流程仍然完全解耦：不看 `submissionClosed`、不参与档案版本快照。
 * 霍兰德与大五各有一份当前结果时，在卡片下方补一张「人格与兴趣一起看」提示卡（#292）。
 */
export default function AssessmentResultsSection() {
  const [scales, setScales] = useState<AssessmentListItem[]>([]);
  const [payloads, setPayloads] = useState<Record<string, AssessmentResultsPayload>>({});
  const [failedCodes, setFailedCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    setFailedCodes([]);
    try {
      const listRes = await fetch("/api/shared/assessment/list");
      const listPayload = (await listRes.json()) as { assessments?: unknown; error?: string };
      if (!listRes.ok) throw new Error(listPayload?.error || "测评量表清单加载失败");
      const items = normalizeAssessmentList(listPayload?.assessments);
      setScales(items);

      // 逐套并行补拉：单套失败只记在这一张卡上
      const failures: string[] = [];
      const loaded = await Promise.all(
        items.map(async (item) => {
          try {
            const res = await fetch(`/api/shared/assessment/results?code=${encodeURIComponent(item.code)}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "测评结果加载失败");
            return [item.code, data as AssessmentResultsPayload] as const;
          } catch (err) {
            console.error(`Failed to load assessment results (${item.code}):`, err);
            failures.push(item.code);
            return null;
          }
        })
      );
      const next: Record<string, AssessmentResultsPayload> = {};
      for (const row of loaded) {
        if (row) next[row[0]] = row[1];
      }
      setPayloads(next);
      setFailedCodes(failures);
    } catch (err) {
      console.error("Failed to load assessment results:", err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- 结果区进入时读取本人各量表清单与结果（与档案数据并列、互不依赖） */
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

  // 清单为空 = 没有启用中的量表（停用后不出现在档案页），整个结果区不占位
  if (scales.length === 0) return null;

  // 提示卡讲的是霍兰德 × 大五的对应关系：两类各有一份当前结果才出现。
  // 不写「完成数 ≥ 2」——将来第三套量表（如再一套 dimensional）都完成时不该弹这张卡。
  const hasHollandResult = scales.some((item) => resultCardMode(item) === "holland" && payloads[item.code]?.current);
  const hasBigFiveResult = scales.some((item) => resultCardMode(item) === "big-five" && payloads[item.code]?.current);

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

      {hasHollandResult && hasBigFiveResult && <CrossScaleTipCard />}
    </div>
  );
}

/** 「人格与兴趣一起看」提示卡（#292）：霍兰德与大五都有当前结果时出现，用学生语言解释三组常见对应关系 */
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
