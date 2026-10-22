import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { parseCaptchaTicket, verifyCaptchaTicket } from "@/lib/captcha";

const CAPTCHA_ID = "test-captcha-id";
const PRIVATE_KEY = "test-private-key";

const VALID_TICKET = {
  lot_number: "abcdef123456",
  captcha_output: "captcha-output",
  pass_token: "pass-token",
  gen_time: "1700000000",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseCaptchaTicket（票据解析）", () => {
  it("非对象入参 → null", () => {
    expect(parseCaptchaTicket(undefined)).toBeNull();
    expect(parseCaptchaTicket("lot_number")).toBeNull();
  });

  it("字段缺失或为空串 → null", () => {
    expect(parseCaptchaTicket({ ...VALID_TICKET, pass_token: "" })).toBeNull();
    expect(parseCaptchaTicket({ lot_number: "a", captcha_output: "b", pass_token: "c" })).toBeNull();
  });

  it("四要素齐全 → 返回去除首尾空格的票据", () => {
    expect(parseCaptchaTicket({ ...VALID_TICKET, lot_number: " abc " })).toEqual({
      ...VALID_TICKET,
      lot_number: "abc",
    });
  });
});

describe("verifyCaptchaTicket（#155 极验服务端二次校验）", () => {
  it("凭证未配置 → degraded(not-configured)，不请求极验", async () => {
    const fetchImpl = vi.fn();
    const decision = await verifyCaptchaTicket(VALID_TICKET, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      captchaId: "",
      privateKey: "",
    });
    expect(decision).toEqual({ outcome: "degraded", reason: "not-configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("票据缺失 → rejected(missing)", async () => {
    const decision = await verifyCaptchaTicket(undefined, {
      fetchImpl: vi.fn() as unknown as typeof fetch,
      captchaId: CAPTCHA_ID,
      privateKey: PRIVATE_KEY,
    });
    expect(decision).toEqual({ outcome: "rejected", reason: "missing" });
  });

  it("校验通过 → passed，并按官方口径携带 sign_token", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse({ result: "success", reason: "" });
    });
    const decision = await verifyCaptchaTicket(VALID_TICKET, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      captchaId: CAPTCHA_ID,
      privateKey: PRIVATE_KEY,
    });

    expect(decision).toEqual({ outcome: "passed" });
    expect(capturedUrl).toBe(`https://gcaptcha4.geetest.com/validate?captcha_id=${CAPTCHA_ID}`);
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    const form = new URLSearchParams(String(capturedInit?.body));
    expect(form.get("lot_number")).toBe(VALID_TICKET.lot_number);
    expect(form.get("captcha_output")).toBe(VALID_TICKET.captcha_output);
    expect(form.get("pass_token")).toBe(VALID_TICKET.pass_token);
    expect(form.get("gen_time")).toBe(VALID_TICKET.gen_time);
    expect(form.get("sign_token")).toBe(
      createHmac("sha256", PRIVATE_KEY).update(VALID_TICKET.lot_number, "utf8").digest("hex")
    );
  });

  it("极验判定失败 → rejected(invalid) 并带上官方 reason", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: "fail", reason: "forbidden" }));
    const decision = await verifyCaptchaTicket(VALID_TICKET, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      captchaId: CAPTCHA_ID,
      privateKey: PRIVATE_KEY,
    });
    expect(decision).toEqual({ outcome: "rejected", reason: "invalid", detail: "forbidden" });
  });

  it("极验不可达（抛错）→ degraded(service-unreachable)（fail-open）", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network unreachable");
    });
    const decision = await verifyCaptchaTicket(VALID_TICKET, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      captchaId: CAPTCHA_ID,
      privateKey: PRIVATE_KEY,
    });
    expect(decision).toEqual({ outcome: "degraded", reason: "service-unreachable" });
  });

  it("极验返回非 200 → degraded(service-unreachable)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: "success" }, 500));
    const decision = await verifyCaptchaTicket(VALID_TICKET, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      captchaId: CAPTCHA_ID,
      privateKey: PRIVATE_KEY,
    });
    expect(decision).toEqual({
      outcome: "degraded",
      reason: "service-unreachable",
      detail: "http-500",
    });
  });

  it("响应体不可解析 → degraded(service-unreachable)", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("not-json", { status: 200, headers: { "Content-Type": "text/plain" } })
    );
    const decision = await verifyCaptchaTicket(VALID_TICKET, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      captchaId: CAPTCHA_ID,
      privateKey: PRIVATE_KEY,
    });
    expect(decision).toEqual({ outcome: "degraded", reason: "service-unreachable" });
  });
});
