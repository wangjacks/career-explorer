import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

vi.mock("@/lib/db", () => ({
  getAssessmentByCode: vi.fn(),
  getCurrentAssessmentResult: vi.fn(),
  getOnetOccupations: vi.fn(),
}));

import { GET as careersGet } from "@/app/api/shared/assessment/careers/route";
import { getAssessmentByCode, getCurrentAssessmentResult, getOnetOccupations } from "@/lib/db";
import type { AssessmentResultRow, AssessmentRow, OnetOccupationRow } from "@/lib/db";

const ASSESSMENT = {
  id: 1,
  code: "riasec",
  name: "霍兰德职业兴趣测评（Mini-IP 精简版）",
  question_count: 30,
  dimensions_json: "[]",
  scoring_mode: "typological",
  scale_version: "Mini-IP-CN 1.0",
  attribution: "O*NET",
  license_text: "",
  disclaimer: "",
  enabled: 1,
  created_at: "2026-10-19 10:00:00",
  updated_at: "2026-10-19 10:00:00",
} as AssessmentRow;

function result(overrides: Partial<AssessmentResultRow> = {}): AssessmentResultRow {
  return {
    id: 10,
    user_id: 1,
    assessment_id: 1,
    status: "completed",
    answers_json: "{}",
    scores_json: JSON.stringify([
      { key: "R", label: "现实型", standard: 10 },
      { key: "I", label: "研究型", standard: 100 },
      { key: "A", label: "艺术型", standard: 80 },
      { key: "S", label: "社会型", standard: 10 },
      { key: "E", label: "企业型", standard: 10 },
      { key: "C", label: "常规型", standard: 10 },
    ]),
    type_code: "IA",
    is_current: 1,
    draft_slot: null,
    started_at: "2026-10-19 09:00:00",
    updated_at: "2026-10-19 10:00:00",
    completed_at: "2026-10-19 10:00:00",
    ...overrides,
  };
}

function occupation(code: string, scores: Record<string, number>): OnetOccupationRow {
  return {
    id: Number(code.replace(/\D/g, "")),
    code,
    name: `Occupation ${code}`,
    name_zh: `职业 ${code}`,
    interest_code: "RIC",
    interests_json: JSON.stringify(scores),
    job_zone: 4,
    education_level: "本科",
    cluster: "计算机与数学",
    dataset_version: "30.2",
    created_at: "2026-10-19 10:00:00",
  };
}

const OCCUPATIONS: OnetOccupationRow[] = [
  occupation("99-0001.00", { R: 7, I: 1, A: 1, S: 1, E: 1, C: 1 }),
  occupation("99-0002.00", { R: 1, I: 7, A: 1, S: 1, E: 1, C: 1 }),
  occupation("99-0003.00", { R: 1, I: 1, A: 7, S: 1, E: 1, C: 1 }),
  occupation("99-0004.00", { R: 1, I: 1, A: 1, S: 7, E: 1, C: 1 }),
  occupation("99-0005.00", { R: 1, I: 1, A: 1, S: 1, E: 7, C: 1 }),
  occupation("99-0006.00", { R: 1, I: 1, A: 1, S: 1, E: 1, C: 7 }),
  occupation("99-0007.00", { R: 1, I: 6, A: 6, S: 1, E: 1, C: 1 }),
  occupation("99-0008.00", { R: 4, I: 4, A: 4, S: 4, E: 4, C: 4 }),
];

function request(query = "", cookie?: string): NextRequest {
  return new NextRequest(new URL(`/api/shared/assessment/careers${query}`, "http://localhost:3000"), {
    headers: cookie ? { cookie } : {},
  });
}

async function studentCookie(uid = 1): Promise<string> {
  return `auth_token=${await signToken({ role: "student", uid, name: "学生甲" })}`;
}

beforeEach(() => {
  vi.mocked(getAssessmentByCode).mockResolvedValue(ASSESSMENT);
  vi.mocked(getCurrentAssessmentResult).mockResolvedValue(result());
  vi.mocked(getOnetOccupations).mockResolvedValue(OCCUPATIONS);
});

describe("GET /api/shared/assessment/careers（#226）", () => {
  it("未登录 → 401", async () => {
    const res = await careersGet(request());
    expect(res.status).toBe(401);
  });

  it("非学生（教师）→ 403", async () => {
    const token = `auth_token=${await signToken({ role: "teacher", uid: 7, name: "张老师" })}`;
    const res = await careersGet(request("", token));
    expect(res.status).toBe(403);
  });

  it("显式传别人的 user_id → 403（越权被拒绝，不静默忽略）", async () => {
    const res = await careersGet(request("?user_id=999", await studentCookie(1)));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("他人");
  });

  it("传自己的 user_id 允许（与不传等价）", async () => {
    const res = await careersGet(request("?user_id=1", await studentCookie(1)));
    expect(res.status).toBe(200);
  });

  it("还没完成测评 → 404", async () => {
    vi.mocked(getCurrentAssessmentResult).mockResolvedValue(undefined);
    const res = await careersGet(request("", await studentCookie()));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("还没有完成");
  });

  it("成功：返回按相似度降序的 Top-6，带署名与数据快照信息", async () => {
    const res = await careersGet(request("", await studentCookie()));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.careers).toHaveLength(6);
    expect(body.careers[0].code).toBe("99-0007.00"); // I+A 都高的职业最贴合画像
    expect(body.careers[0].rank).toBe(1);
    expect(body.careers[1].code).toBe("99-0002.00");
    expect(body.careers.map((c: { rank: number }) => c.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    const similarities = body.careers.map((c: { similarity: number }) => c.similarity);
    expect([...similarities].sort((a: number, b: number) => b - a)).toEqual(similarities);

    expect(body.profileSource).toBe("scores");
    expect(body.profile).toMatchObject({ R: 10, I: 100, A: 80, S: 10, E: 10, C: 10 });
    expect(body.assessment).toMatchObject({ code: "riasec", typeCode: "IA", completedAt: "2026-10-19 10:00:00" });
    expect(body.dataset).toMatchObject({ version: "30.2", occupationCount: 923 });
    expect(body.attribution).toContain("CC BY 4.0");
    // 中文译名随结果下发，前端无需二次查表
    expect(body.careers[0].nameZh).toBe("职业 99-0007.00");
    expect(body.careers[0].educationLevel).toBe("本科");
  });

  it("limit 生效且非法值被拒", async () => {
    const ok = await careersGet(request("?limit=3", await studentCookie()));
    expect(ok.status).toBe(200);
    expect((await ok.json()).careers).toHaveLength(3);

    for (const bad of ["0", "21", "abc", "1.5"]) {
      const res = await careersGet(request(`?limit=${bad}`, await studentCookie()));
      expect(res.status, `limit=${bad} 应被拒`).toBe(400);
    }
  });

  it("只有三字码时退回权重向量（profileSource=typeCode）并换算成 0–100 返回", async () => {
    vi.mocked(getCurrentAssessmentResult).mockResolvedValue(result({ scores_json: null, type_code: "SIR" }));
    const res = await careersGet(request("", await studentCookie()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profileSource).toBe("typeCode");
    expect(body.careers[0].code).toBe("99-0004.00"); // S 最重 → S 型职业排第一
    expect(body.profile.S).toBe(100); // 首位权重 3/3
  });

  it("结果里既没有六维分也没有三字码 → 409", async () => {
    vi.mocked(getCurrentAssessmentResult).mockResolvedValue(
      result({ scores_json: null, type_code: null })
    );
    const res = await careersGet(request("", await studentCookie()));
    expect(res.status).toBe(409);
  });

  it("职业库为空 → 503（提示先导入数据）", async () => {
    vi.mocked(getOnetOccupations).mockResolvedValue([]);
    const res = await careersGet(request("", await studentCookie()));
    expect(res.status).toBe(503);
  });

  it("量表未配置 → 404", async () => {
    vi.mocked(getAssessmentByCode).mockResolvedValue(undefined);
    const res = await careersGet(request("", await studentCookie()));
    expect(res.status).toBe(404);
  });
});
