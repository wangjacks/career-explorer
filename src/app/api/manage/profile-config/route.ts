import { NextRequest, NextResponse } from "next/server";
import { getMaxCustomTags, getSubmissionDeadline, setProfileConfig, SUBMISSION_DEADLINE_KEY } from "@/lib/db";

/** 档案功能设置（#94/#96）：管理/教师面板读写；表单端读取上限/截止状态走开放端点 /api/tags */

export async function GET() {
  try {
    const maxCustomTags = await getMaxCustomTags();
    const submissionDeadline = await getSubmissionDeadline();
    return NextResponse.json({ maxCustomTags, submissionDeadline });
  } catch (err) {
    console.error("Profile config GET error:", err);
    return NextResponse.json({ error: "获取配置失败" }, { status: 500 });
  }
}

/** datetime-local 原生格式（容忍可选秒） */
const DATETIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** 校验并规范化截止时间：返回 `YYYY-MM-DD HH:mm`；非法返回 null（双重校验：格式 + 真实日期存在） */
function parseDeadline(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!DATETIME_LOCAL_PATTERN.test(value)) return null;
  if (Number.isNaN(new Date(value).getTime())) return null;
  return value.slice(0, 16).replace("T", " ");
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    // 自定义标签上限（可选提交，提交时校验）
    if (body.maxCustomTags !== undefined) {
      const value = Number(body.maxCustomTags);
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        return NextResponse.json({ error: "自定义标签上限须为 1-20 的整数" }, { status: 400 });
      }
      await setProfileConfig("max_custom_tags", String(value));
    }

    // 提交截止时间（#96，可选提交）：null/空串 = 清除限制；字符串须通过双重校验
    if (body.submissionDeadline !== undefined) {
      const raw = body.submissionDeadline;
      if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
        await setProfileConfig(SUBMISSION_DEADLINE_KEY, "");
      } else {
        const parsed = parseDeadline(raw);
        if (!parsed) {
          return NextResponse.json({ error: "截止时间格式无效" }, { status: 400 });
        }
        await setProfileConfig(SUBMISSION_DEADLINE_KEY, parsed);
      }
    }

    const maxCustomTags = await getMaxCustomTags();
    const submissionDeadline = await getSubmissionDeadline();
    return NextResponse.json({ ok: true, maxCustomTags, submissionDeadline });
  } catch (err) {
    console.error("Profile config PUT error:", err);
    return NextResponse.json({ error: "保存配置失败" }, { status: 500 });
  }
}
