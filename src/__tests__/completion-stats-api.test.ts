import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

vi.mock("@/lib/db", () => ({
  getEnabledAssessments: vi.fn(),
  getCompletionStats: vi.fn(),
  getTeacherClassPairs: vi.fn(),
}));

vi.mock("@/lib/db-config", () => ({
  isInstalled: vi.fn(() => true),
}));

import { GET } from "@/app/api/manage/stats/completion/route";
import {
  getCompletionStats,
  getEnabledAssessments,
  getTeacherClassPairs,
  type AssessmentRow,
  type CompletionStatsRaw,
} from "@/lib/db";
import { isInstalled } from "@/lib/db-config";

const RIASEC = {
  id: 5,
  code: "riasec",
  name: "霍兰德职业兴趣测评",
  question_count: 30,
  items_per_attempt: 30,
  dimensions_json: "[]",
  scoring_mode: "typological",
  scale_version: "RIASEC-CN 2.0",
  attribution: "O*NET",
  license_text: "",
  disclaimer: "",
  enabled: 1,
  created_at: "2026-10-19 10:00:00",
  updated_at: "2026-10-19 10:00:00",
} as AssessmentRow;

const IPIP = {
  ...RIASEC,
  id: 9,
  code: "ipip-neo-ffi",
  name: "五大人格测评",
  scoring_mode: "dimensional",
  scale_version: "IPIP NEO-FFI 1.0",
} as AssessmentRow;

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

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie ? { cookie } : {},
  });
}

async function token(role: "student" | "teacher" | "admin", uid: number): Promise<string> {
  return `auth_token=${await signToken({ role, uid, name: "测试用户" })}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isInstalled).mockReturnValue(true);
  vi.mocked(getEnabledAssessments).mockResolvedValue([RIASEC, IPIP]);
  vi.mocked(getCompletionStats).mockResolvedValue(RAW);
  vi.mocked(getTeacherClassPairs).mockResolvedValue([
    { id: 1, teacher_id: 3, class_id: 7, created_at: "" },
  ]);
});

describe("GET /api/manage/stats/completion（#310 完成矩阵）", () => {
  it("未登录 / 学生 → 403（教师与管理员才能看）", async () => {
    expect((await GET(request("/api/manage/stats/completion"))).status).toBe(403);
    const student = await token("student", 21);
    expect(
      (await GET(request("/api/manage/stats/completion", student))).status
    ).toBe(403);
  });

  it("默认 scope=all：列由启用量表驱动，行/未分班/总计齐全", async () => {
    const res = await GET(
      request("/api/manage/stats/completion", await token("teacher", 3))
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(getCompletionStats).toHaveBeenCalledWith([5, 9], null);
    expect(body.scope).toBe("all");
    expect(body.columns.map((column: { key: string }) => column.key)).toEqual([
      "profile",
      "assessment:riasec",
      "assessment:ipip-neo-ffi",
    ]);
    expect(body.rows.map((row: { classId: number }) => row.classId)).toEqual([9, 7]);
    expect(body.rows.every((row: { canDrilldown: boolean }) => row.canDrilldown === false)).toBe(true);
    expect(body.unassigned).toMatchObject({ name: "未分班", enrolled: 1 });
    expect(body.total).toEqual({
      enrolled: 6,
      cells: {
        profile: { done: 3, rate: 50 },
        "assessment:riasec": { done: 3, rate: 50 },
        "assessment:ipip-neo-ffi": { done: 1, rate: 16.7 },
      },
    });
  });

  it("教师 scope=mine 只含本人归属班级，行可下钻", async () => {
    const res = await GET(
      request("/api/manage/stats/completion?scope=mine", await token("teacher", 3))
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(getCompletionStats).toHaveBeenCalledWith([5, 9], [7]);
    expect(body.scope).toBe("mine");
    expect(body.rows.map((row: { classId: number }) => row.classId)).toEqual([7]);
    expect(body.rows[0].canDrilldown).toBe(true);
    expect(body.unassigned).toBeNull();
    expect(body.total.enrolled).toBe(3);
  });

  it("管理员 scope=mine 等同所有班级，且可下钻", async () => {
    const res = await GET(
      request("/api/manage/stats/completion?scope=mine", await token("admin", 1))
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(getTeacherClassPairs).not.toHaveBeenCalled();
    expect(getCompletionStats).toHaveBeenCalledWith([5, 9], null);
    expect(body.rows.every((row: { canDrilldown: boolean }) => row.canDrilldown === true)).toBe(true);
  });

  it("非法 scope → 400 且不查库", async () => {
    const res = await GET(
      request("/api/manage/stats/completion?scope=class", await token("teacher", 3))
    );
    expect(res.status).toBe(400);
    expect(getCompletionStats).not.toHaveBeenCalled();
  });

  it("量表读取失败时退化为只有档案列，仍返回 200", async () => {
    vi.mocked(getEnabledAssessments).mockRejectedValue(new Error("no assessments table"));
    const res = await GET(
      request("/api/manage/stats/completion", await token("teacher", 3))
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(getCompletionStats).toHaveBeenCalledWith([], null);
    expect(body.columns).toEqual([{ key: "profile", label: "档案提交" }]);
    expect(body.rows.map((row: { classId: number }) => row.classId)).toEqual([9, 7]);
  });

  it("量表停用不出列（只透传 enabled=1 的量表）", async () => {
    vi.mocked(getEnabledAssessments).mockResolvedValue([
      RIASEC,
      { ...IPIP, enabled: 0 },
    ]);
    const res = await GET(
      request("/api/manage/stats/completion", await token("teacher", 3))
    );
    const body = await res.json();

    expect(getCompletionStats).toHaveBeenCalledWith([5], null);
    expect(body.columns.map((column: { key: string }) => column.key)).toEqual([
      "profile",
      "assessment:riasec",
    ]);
  });

  it("未安装时返回只有档案列的空矩阵，不调用数据库", async () => {
    vi.mocked(isInstalled).mockReturnValue(false);
    const res = await GET(
      request("/api/manage/stats/completion", await token("teacher", 3))
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(getCompletionStats).not.toHaveBeenCalled();
    expect(body.columns).toEqual([{ key: "profile", label: "档案提交" }]);
    expect(body.rows).toEqual([]);
    expect(body.unassigned).toBeNull();
    expect(body.total).toEqual({
      enrolled: 0,
      cells: { profile: { done: 0, rate: 0 } },
    });
  });

  it("数据库读取失败 → 500", async () => {
    vi.mocked(getCompletionStats).mockRejectedValue(new Error("db down"));
    const res = await GET(
      request("/api/manage/stats/completion", await token("teacher", 3))
    );
    expect(res.status).toBe(500);
  });

  it("响应不含学生姓名/学号等个人标识", async () => {
    const res = await GET(
      request("/api/manage/stats/completion", await token("teacher", 3))
    );
    const body = await res.json();
    const serialized = JSON.stringify(body);
    for (const pii of ["userCode", "user_code", "assessedAt", "studentName", "20250505"]) {
      expect(serialized).not.toContain(pii);
    }
  });
});
