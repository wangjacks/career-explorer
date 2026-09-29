import { describe, it, expect, vi, afterEach } from "vitest";
import { submitProfile } from "@/lib/profile-submit";
import { UPLOAD_NETWORK_ERROR_MESSAGE } from "@/lib/upload-utils";

const STUDENT_ID = "202505050101";
const FILE = new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 反向代理/网关的响应形态：HTML 正文，没有 error 字段 */
function htmlResponse(status: number): Response {
  return new Response(`<html><head><title>${status}</title></head></html>`, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

function stubFetch(...responses: (Response | Error)[]): ReturnType<typeof vi.fn> {
  const mock = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) mock.mockRejectedValueOnce(r);
    else mock.mockResolvedValueOnce(r);
  }
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("submitProfile — 上传失败原因透传（#206）", () => {
  it("代理 413（HTML 正文）给出可行动文案，不再是笼统的「图片上传失败」", async () => {
    stubFetch(htmlResponse(413));
    await expect(
      submitProfile({ studentId: STUDENT_ID, tags: [], avatarFile: FILE })
    ).rejects.toThrow("图片过大，服务器拒绝接收，请压缩后重试");
  });

  it("服务端 JSON 的 error 原文透传", async () => {
    stubFetch(jsonResponse({ error: "图片大小不能超过 5MB" }, 400));
    await expect(
      submitProfile({ studentId: STUDENT_ID, tags: [], avatarFile: FILE })
    ).rejects.toThrow("图片大小不能超过 5MB");
  });

  it("网关 504 提示稍后重试", async () => {
    stubFetch(htmlResponse(504));
    await expect(
      submitProfile({ studentId: STUDENT_ID, tags: [], avatarFile: FILE })
    ).rejects.toThrow("上传服务暂时不可用，请稍后重试");
  });

  it("网络层失败（fetch 抛错）给出网络文案，而非 TypeError 原文", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    await expect(
      submitProfile({ studentId: STUDENT_ID, tags: [], avatarFile: FILE })
    ).rejects.toThrow(UPLOAD_NETWORK_ERROR_MESSAGE);
  });

  it("200 但响应体不是 JSON（代理拦截页）时给出兜底文案", async () => {
    stubFetch(htmlResponse(200));
    await expect(
      submitProfile({ studentId: STUDENT_ID, tags: [], avatarFile: FILE })
    ).rejects.toThrow("上传返回异常，请稍后重试");
  });
});

describe("submitProfile — 上传与保存的拼装", () => {
  it("上传携带 prefix/studentId，保存体带上传返回的 url（追加缓存串）与后端 id", async () => {
    const mock = stubFetch(
      jsonResponse({ url: "avatar_202505050101_x.jpg", storageId: 2 }),
      jsonResponse({ message: "保存成功", version: 1 })
    );

    await submitProfile({ studentId: STUDENT_ID, tags: ["阅读"], avatarFile: FILE });

    const [uploadUrl, uploadInit] = mock.mock.calls[0] as [string, RequestInit];
    expect(uploadUrl).toBe("/api/upload");
    const fd = uploadInit.body as FormData;
    expect(fd.get("prefix")).toBe("avatar");
    expect(fd.get("studentId")).toBe(STUDENT_ID);
    expect(fd.get("file")).toBeInstanceOf(File);

    const [saveUrl, saveInit] = mock.mock.calls[1] as [string, RequestInit];
    expect(saveUrl).toBe("/api/shared/profile");
    const body = JSON.parse(String(saveInit.body));
    expect(body.tags).toEqual(["阅读"]);
    expect(body.avatarUrl).toMatch(/^avatar_202505050101_x\.jpg\?t=\d+$/);
    expect(body.evaluationUrl).toBe("");
    expect(body.storageId).toBe(2);
    expect(body.studentId).toBeUndefined();
  });

  it("未重选图片时沿用既有 URL，且不发起上传请求", async () => {
    const mock = stubFetch(jsonResponse({ message: "保存成功", version: 2 }));

    await submitProfile({
      studentId: STUDENT_ID,
      tags: [],
      existingAvatarUrl: "avatar_old.jpg?t=1",
      existingEvaluationUrl: "evaluation_old.jpg?t=2",
    });

    expect(mock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((mock.mock.calls[0][1] as RequestInit).body));
    expect(body.avatarUrl).toBe("avatar_old.jpg?t=1");
    expect(body.evaluationUrl).toBe("evaluation_old.jpg?t=2");
    // 未重选不传 storageId：服务端保留记录中的原值
    expect(body.storageId).toBeNull();
  });

  it("档案保存失败时透传服务端文案", async () => {
    stubFetch(
      jsonResponse({ url: "avatar_x.jpg", storageId: 1 }),
      jsonResponse({ error: "档案提交已截止，无法保存" }, 403)
    );
    await expect(
      submitProfile({ studentId: STUDENT_ID, tags: [], avatarFile: FILE })
    ).rejects.toThrow("档案提交已截止，无法保存");
  });
});
