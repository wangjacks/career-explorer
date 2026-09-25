import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// 隔离数据库与密码校验：本组用例只关注人机验证前置是否按预期拦截或放行
vi.mock("@/lib/db", () => ({
  getUserByCode: vi.fn(),
  getUserById: vi.fn(),
  insertAuditLog: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth", () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock("@/lib/token", () => ({
  signToken: vi.fn(async () => "signed-token"),
  verifyToken: vi.fn(async () => ({ valid: false })),
}));

const verifyCaptchaTicketMock = vi.fn();
vi.mock("@/lib/captcha", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/captcha")>();
  return {
    ...actual,
    verifyCaptchaTicket: (...args: unknown[]) => verifyCaptchaTicketMock(...args),
  };
});

import { POST } from "@/app/api/auth/route";
import { getUserByCode, insertAuditLog } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";

const ADMIN_USER = {
  id: 3,
  user_code: "10001",
  password_hash: "hashed",
  role: "admin",
  name: "管理员",
  class_id: null,
  tags: null,
  avatar_url: null,
  evaluation_url: null,
  submitted_at: null,
  created_at: "",
  storage_id: 1,
};

const TICKET = {
  lot_number: "lot-1",
  captcha_output: "out-1",
  pass_token: "pass-1",
  gen_time: "1700000000",
};

function loginRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/auth", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 等待 void recordAudit(...) 的异步写入落到 mock 上 */
const flushAudit = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth — 人机验证前置（#155）", () => {
  it("未携带票据 → 400 统一提示，且未触达查库与密码比对", async () => {
    verifyCaptchaTicketMock.mockResolvedValue({ outcome: "rejected", reason: "missing" });

    const res = await POST(loginRequest({ userCode: "10001", password: "pw-12345678" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("请先完成人机验证");
    expect(getUserByCode).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth:captcha-failed" })
    );
  });

  it("票据无效 → 400，提示与缺失时一致（不泄露校验细节）", async () => {
    verifyCaptchaTicketMock.mockResolvedValue({ outcome: "rejected", reason: "invalid" });

    const res = await POST(
      loginRequest({ userCode: "10001", password: "pw-12345678", captcha: TICKET })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("请先完成人机验证");
    expect(getUserByCode).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("极验降级 → 放行进入密码校验，并记录 auth:captcha-degraded", async () => {
    verifyCaptchaTicketMock.mockResolvedValue({
      outcome: "degraded",
      reason: "service-unreachable",
    });
    vi.mocked(getUserByCode).mockResolvedValue(ADMIN_USER as never);
    vi.mocked(verifyPassword).mockResolvedValue(true);

    const res = await POST(loginRequest({ userCode: "10001", password: "pw-12345678" }));

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth:captcha-degraded" })
    );
    expect(insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "auth:login" }));
  });

  it("票据校验通过 → 正常登录", async () => {
    verifyCaptchaTicketMock.mockResolvedValue({ outcome: "passed" });
    vi.mocked(getUserByCode).mockResolvedValue(ADMIN_USER as never);
    vi.mocked(verifyPassword).mockResolvedValue(true);

    const res = await POST(
      loginRequest({ userCode: "10001", password: "pw-12345678", captcha: TICKET })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.role).toBe("admin");
  });
});
