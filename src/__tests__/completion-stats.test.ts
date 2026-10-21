import { describe, expect, it } from "vitest";
import type { CompletionStatsRaw } from "@/lib/db";
import {
  finalizeCompletionStats,
  type CompletionScale,
} from "@/lib/completion-stats";

const RIASEC: CompletionScale = {
  id: 5,
  code: "riasec",
  name: "霍兰德职业兴趣测评",
  scoringMode: "typological",
};

const IPIP: CompletionScale = {
  id: 9,
  code: "ipip-neo-ffi",
  name: "五大人格测评",
  scoringMode: "dimensional",
};

const RAW: CompletionStatsRaw = {
  profile: [
    { class_id: 7, name: "2025级1班", enrolled: 3, submitted: 2 },
    { class_id: 9, name: "2025级2班", enrolled: 2, submitted: 0 },
    { class_id: null, name: null, enrolled: 1, submitted: 1 },
  ],
  assessments: [
    { assessment_id: 5, class_id: 7, assessed: 2 },
    { assessment_id: 9, class_id: 7, assessed: 1 },
    { assessment_id: 5, class_id: null, assessed: 1 },
  ],
};

describe("finalizeCompletionStats（#310 完成矩阵）", () => {
  it("列由启用量表驱动：档案恒第一列，其后按传入顺序追加", () => {
    const result = finalizeCompletionStats(RAW, [RIASEC, IPIP]);
    expect(result.columns).toEqual([
      { key: "profile", label: "档案提交" },
      {
        key: "assessment:riasec",
        label: "兴趣测评",
        scaleName: "霍兰德职业兴趣测评",
        scoringMode: "typological",
      },
      {
        key: "assessment:ipip-neo-ffi",
        label: "人格测评",
        scaleName: "五大人格测评",
        scoringMode: "dimensional",
      },
    ]);
  });

  it("行按档案提交率升序；未分班单独汇总且不混入班级行", () => {
    const result = finalizeCompletionStats(RAW, [RIASEC, IPIP]);
    expect(result.rows.map((row) => row.classId)).toEqual([9, 7]);
    expect(result.rows[0]).toMatchObject({
      classId: 9,
      name: "2025级2班",
      enrolled: 2,
      canDrilldown: true,
      cells: {
        profile: { done: 0, rate: 0 },
        "assessment:riasec": { done: 0, rate: 0 },
        "assessment:ipip-neo-ffi": { done: 0, rate: 0 },
      },
    });
    expect(result.rows[1]).toMatchObject({
      classId: 7,
      name: "2025级1班",
      enrolled: 3,
      cells: {
        profile: { done: 2, rate: 66.7 },
        "assessment:riasec": { done: 2, rate: 66.7 },
        "assessment:ipip-neo-ffi": { done: 1, rate: 33.3 },
      },
    });
    expect(result.unassigned).toEqual({
      name: "未分班",
      enrolled: 1,
      cells: {
        profile: { done: 1, rate: 100 },
        "assessment:riasec": { done: 1, rate: 100 },
        "assessment:ipip-neo-ffi": { done: 0, rate: 0 },
      },
    });
  });

  it("总计含未分班学生，按同一分母重算而不是平均行完成率", () => {
    const result = finalizeCompletionStats(RAW, [RIASEC, IPIP]);
    expect(result.total).toEqual({
      enrolled: 6,
      cells: {
        profile: { done: 3, rate: 50 },
        "assessment:riasec": { done: 3, rate: 50 },
        "assessment:ipip-neo-ffi": { done: 1, rate: 16.7 },
      },
    });
  });

  it("classIds 收窄时只保留这些班，未分班学生不在范围内", () => {
    const result = finalizeCompletionStats(RAW, [RIASEC, IPIP], { classIds: [7] });
    expect(result.rows.map((row) => row.classId)).toEqual([7]);
    expect(result.unassigned).toBeNull();
    expect(result.total).toEqual({
      enrolled: 3,
      cells: {
        profile: { done: 2, rate: 66.7 },
        "assessment:riasec": { done: 2, rate: 66.7 },
        "assessment:ipip-neo-ffi": { done: 1, rate: 33.3 },
      },
    });
  });

  it("空 classIds 返回空矩阵（教师没有归属班级）", () => {
    const result = finalizeCompletionStats(RAW, [RIASEC], { classIds: [] });
    expect(result.rows).toEqual([]);
    expect(result.unassigned).toBeNull();
    expect(result.total).toEqual({
      enrolled: 0,
      cells: {
        profile: { done: 0, rate: 0 },
        "assessment:riasec": { done: 0, rate: 0 },
      },
    });
  });

  it("enrolled = 0 的空班不出行也不进总计", () => {
    const result = finalizeCompletionStats(
      {
        profile: [{ class_id: 11, name: "空班", enrolled: 0, submitted: 0 }],
        assessments: [{ assessment_id: 5, class_id: 11, assessed: 0 }],
      },
      [RIASEC]
    );
    expect(result.rows).toEqual([]);
    expect(result.unassigned).toBeNull();
    expect(result.total.enrolled).toBe(0);
  });

  it("脏数据不产生 NaN / 超 100%：done 钳到 enrolled、rate 钳到 100", () => {
    const result = finalizeCompletionStats(
      {
        profile: [{ class_id: 12, name: "脏数据班", enrolled: 2, submitted: 9 }],
        assessments: [{ assessment_id: 5, class_id: 12, assessed: 9 }],
      },
      [RIASEC]
    );
    expect(result.rows[0].cells.profile).toEqual({ done: 2, rate: 100 });
    expect(result.rows[0].cells["assessment:riasec"]).toEqual({ done: 2, rate: 100 });
    expect(JSON.stringify(result)).not.toContain("NaN");
  });

  it("canDrilldown=false 时所有班级行都不可下钻（教师看所有班级）", () => {
    const result = finalizeCompletionStats(RAW, [RIASEC], { canDrilldown: false });
    expect(result.rows.every((row) => row.canDrilldown === false)).toBe(true);
  });

  it("重复量表 code 只出一列，非法量表被忽略", () => {
    const result = finalizeCompletionStats(RAW, [
      RIASEC,
      { ...RIASEC, id: 6 },
      { ...IPIP, id: 0 },
      { ...IPIP, code: "  " },
    ]);
    expect(result.columns.map((column) => column.key)).toEqual([
      "profile",
      "assessment:riasec",
    ]);
  });

  it("响应不含学生姓名/学号等个人标识", () => {
    const serialized = JSON.stringify(finalizeCompletionStats(RAW, [RIASEC, IPIP]));
    for (const pii of ["userCode", "user_code", "studentName", "20250505"]) {
      expect(serialized).not.toContain(pii);
    }
  });
});
