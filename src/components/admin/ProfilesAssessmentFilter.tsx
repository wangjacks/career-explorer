"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { RIASEC_KEYS, type RiasecKey } from "@/lib/assessment-match";
import {
  ASSESSMENT_FILTER_NONE,
  ASSESSMENT_INTEREST_MAX_KEYS,
  assessmentFilterChipText,
  findDimensionalScale,
  hasAssessmentFilter,
  personalityDimensionLabel,
  selectInterestNone,
  selectPersonalityAny,
  selectPersonalityDimension,
  selectPersonalityNone,
  toggleInterestLetter,
  type AssessmentFilter,
  type PersonalityDirection,
  type ProfileAssessmentScaleView,
} from "@/lib/profile-assessment";

interface Props {
  filter: AssessmentFilter;
  /** 启用中的量表清单：维度标签与「人格量表是否可用」都来自这里（不写死 IPIP） */
  scales: readonly ProfileAssessmentScaleView[];
  onChange: (filter: AssessmentFilter) => void;
}

type Tab = "interest" | "personality";

/**
 * 数据列表的「测评筛选」按钮 + 弹层（#330）。
 *
 * **一次只按一种测评筛选**：兴趣（多选 AND / 未测）与人格（已测 / 未测 / 单维度偏高偏低）
 * 用 `AssessmentFilter` 联合类型表达，切换 tab 并应用时另一组条件由 `onChange` 整体替换，
 * 因此界面天然不会出现「兴趣 + 人格同时生效」；服务端再拦一次（同时收到两组参数 400）。
 *
 * 文案按 issue 要求用短句；弹层内不带长段落说明。
 */
export default function ProfilesAssessmentFilter({ filter, scales, onChange }: Props) {
  const [open, setOpen] = useState(false);
  // 打开弹层时落在当前条件所在的 tab；没有条件时默认「兴趣」
  const [tab, setTab] = useState<Tab>(filter.kind === "personality" ? "personality" : "interest");
  const rootRef = useRef<HTMLDivElement>(null);
  const dimensionalScale = findDimensionalScale(scales);

  useEscapeKey(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const chipText = assessmentFilterChipText(filter, scales);
  const active = hasAssessmentFilter(filter);
  const interestKeys = filter.kind === "interest" && filter.mode === "letters" ? filter.keys : [];
  const personalityMode =
    filter.kind === "personality"
      ? filter.mode
      : ("all" as const);
  const personalityDimension =
    filter.kind === "personality" && filter.mode === "dimension" ? filter.key : null;
  const personalityDir =
    filter.kind === "personality" && filter.mode === "dimension" ? filter.dir : ("high" as PersonalityDirection);

  const toggleOpen = () => {
    if (!open) setTab(filter.kind === "personality" ? "personality" : "interest");
    setOpen((value) => !value);
  };

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
            active
              ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800"
              : "bg-card text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-300"
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          测评筛选
          {active && (
            <span className="ml-0.5 rounded-full bg-green-500 px-1.5 py-0.5 text-xs leading-none text-white">
              {interestKeys.length > 0 ? interestKeys.length : 1}
            </span>
          )}
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {/* 已应用 chip：一眼看出当前按什么筛的，点 × 直接清掉 */}
        {chipText && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
            {chipText}
            <button
              type="button"
              onClick={() => onChange(ASSESSMENT_FILTER_NONE)}
              aria-label={`清除筛选：${chipText}`}
              className="leading-none hover:text-green-900 dark:hover:text-green-100"
            >
              ×
            </button>
          </span>
        )}
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="测评筛选"
          className="absolute left-0 top-full z-30 mt-1 w-[22rem] rounded-xl border border-gray-200 bg-card shadow-lg dark:border-gray-700"
        >
          <div className="flex border-b border-border-soft" role="tablist" aria-label="按哪种测评筛选">
            {(
              [
                { value: "interest" as Tab, label: "兴趣测评" },
                { value: "personality" as Tab, label: "人格测评" },
              ] as const
            ).map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={tab === item.value}
                onClick={() => setTab(item.value)}
                className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                  tab === item.value
                    ? "border-b-2 border-green-500 text-green-700 dark:text-green-300"
                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "interest" ? (
            <div className="space-y-3 p-3">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted">状态</p>
                <div className="flex flex-wrap gap-1.5">
                  <FilterChip active={filter.kind !== "interest"} onClick={() => onChange(ASSESSMENT_FILTER_NONE)}>
                    全部
                  </FilterChip>
                  <FilterChip
                    active={filter.kind === "interest" && filter.mode === "none"}
                    onClick={() => onChange(selectInterestNone())}
                  >
                    未测
                  </FilterChip>
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted">包含字母（可多选）</p>
                <div className="flex flex-wrap gap-1.5">
                  {RIASEC_KEYS.map((key) => {
                    const selected = interestKeys.includes(key);
                    const disabled = !selected && interestKeys.length >= ASSESSMENT_INTEREST_MAX_KEYS;
                    return (
                      <FilterChip
                        key={key}
                        active={selected}
                        disabled={disabled}
                        title={disabled ? `最多选 ${ASSESSMENT_INTEREST_MAX_KEYS} 个字母` : undefined}
                        onClick={() => onChange(toggleInterestLetter(filter, key as RiasecKey))}
                      >
                        {key}
                      </FilterChip>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] leading-5 text-gray-400">
                  多选 = 三字码同时包含所选字母（最多 {ASSESSMENT_INTEREST_MAX_KEYS} 个），如 S+A+I 找到含 SAI 的同学
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 p-3">
              {!dimensionalScale ? (
                <p className="text-xs leading-5 text-gray-400">人格量表还没启用，暂时不能按人格筛选。</p>
              ) : (
                <>
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted">状态</p>
                    <div className="flex flex-wrap gap-1.5">
                      <FilterChip active={filter.kind !== "personality"} onClick={() => onChange(ASSESSMENT_FILTER_NONE)}>
                        全部
                      </FilterChip>
                      <FilterChip
                        active={filter.kind === "personality" && personalityMode === "any"}
                        onClick={() => onChange(selectPersonalityAny())}
                      >
                        已测
                      </FilterChip>
                      <FilterChip
                        active={filter.kind === "personality" && personalityMode === "none"}
                        onClick={() => onChange(selectPersonalityNone())}
                      >
                        未测
                      </FilterChip>
                    </div>
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted">维度（一次只看一维）</p>
                    <div className="flex flex-wrap gap-1.5">
                      {dimensionalScale.dimensions.map((dimension) => (
                        <FilterChip
                          key={dimension.key}
                          active={personalityDimension === dimension.key}
                          onClick={() =>
                            onChange(
                              personalityDimension === dimension.key
                                ? selectPersonalityAny()
                                : selectPersonalityDimension(filter, dimension.key, personalityDir)
                            )
                          }
                        >
                          {dimension.label}
                        </FilterChip>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted">方向</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(["high", "low"] as const).map((dir) => (
                        <FilterChip
                          key={dir}
                          active={personalityDimension !== null && personalityDir === dir}
                          disabled={personalityDimension === null}
                          title={personalityDimension === null ? "先选一个维度" : undefined}
                          onClick={() =>
                            personalityDimension !== null &&
                            onChange(selectPersonalityDimension(filter, personalityDimension, dir))
                          }
                        >
                          {dir === "high" ? "偏高" : "偏低"}
                        </FilterChip>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] leading-5 text-gray-400">
                      偏高 = 标准分 ≥ 50（与结果页一致）
                    </p>
                  </div>
                  {personalityDimension && (
                    <p className="text-[11px] leading-5 text-gray-400">
                      当前：{personalityDimensionLabel(personalityDimension, scales)}
                      {personalityDir === "high" ? "偏高" : "偏低"}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-border-soft px-3 py-2">
            <p className="text-[11px] text-gray-400">同一时间只按一种测评筛选</p>
            <button
              type="button"
              onClick={() => onChange(ASSESSMENT_FILTER_NONE)}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <X className="h-3 w-3" aria-hidden />
              清除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 弹层里的小胶囊按钮（选中 / 禁用两态；与列表筛选胶囊同视觉语言） */
function FilterChip({
  active,
  disabled = false,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800"
          : "bg-card text-gray-600 border-gray-200 hover:border-gray-300 dark:text-gray-300 dark:border-gray-700"
      }`}
    >
      {children}
    </button>
  );
}
