import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// 隔离数据库与三要素核验：本组用例只关注激活第一步的人机验证前置（#155）
vi.mock("@/lib/db", () => ({
  insertAuditLog: vi.fn(async () => undefined),
  getUserById: vi.fn(),
}));

vi.mock("@/lib/token", () => ({
  verifyToken: vi.fn(async () => ({ valid: false })),
  signToken: vi.fn(async () => "signed-token"),
}));

vi.mock("@/lib/activate", () => ({
  resolveActivation: vi.fn(),
}));

const verifyCaptchaTicketMock = vi.fn();
vi.mock("@/lib/captcha", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/captcha")>();
  return {
    ...actual,
    verifyCaptchaTicket: (...args: unknown[]) => verifyCaptchaTicketMock(...args),
  };
});

import { POST } from "@/app/api/auth/activate/verify/route";
import { resolveActivation } from "@/lib/activate";
import { insertAuditLog } from "@/lib/db";

const TICKET = {
  lot_number: "lot-1",
  captcha_output: "out-1",
  pass_token: "pass-1",
  gen_time: "1700000000",
};

const BODY = { userCode: "202505050102", name: "张三", inviteCode: "ab12cd34" };

function verifyRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/auth/activate/verify", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const flushAudit = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/activate/verify — 人机验证前置（#155）", () => {
  it("未携带票据 → 400 统一提示，且未触达三要素核验", async () => {
    verifyCaptchaTicketMock.mockResolvedValue({ outcome: "rejected", reason: "missing" });

    const res = await POST(verifyRequest(BODY));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("请先完成人机验证");
    expect(resolveActivation).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth:captcha-failed",
        path: "/api/auth/activate/verify",
      })
    );
  });

  it("极验降级 → 放行进入三要素核验，并记录 auth:captcha-degraded", async () => {
    verifyCaptchaTicketMock.mockResolvedValue({ outcome: "degraded", reason: "not-configured" });
    vi.mocked(resolveActivation).mockResolvedValue({ ok: true, name: "张三" } as never);

    const res = await POST(verifyRequest(BODY));

    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("张三");
    expect(resolveActivation).toHaveBeenCalledTimes(1);
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth:captcha-degraded" })
    );
  });

  it("票据校验通过 → 正常核验", async () => {
    verifyCaptchaTicketMock.mockResolvedValue({ outcome: "passed" });
    vi.mocked(resolveActivation).mockResolvedValue({ ok: true, name: "张三" } as never);

    const res = await POST(verifyRequest({ ...BODY, captcha: TICKET }));

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
