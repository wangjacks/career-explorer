import { NextRequest, NextResponse } from "next/server";
import {
  getMaxAvatarSizeMb,
  getMaxCustomTags,
  getMaxEvaluationSizeMb,
  getMaxProfileSubmissions,
  getSubmissionDeadline,
  MAX_AVATAR_SIZE_KEY,
  MAX_EVALUATION_SIZE_KEY,
  MAX_PROFILE_SUBMISSIONS_KEY,
  setProfileConfig,
  SUBMISSION_DEADLINE_KEY,
} from "@/lib/db";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

/** 档案功能设置（#94/#96/#111/#95）：管理/教师面板读写；表单端读取上限/截止状态走开放端点 /api/tags */

export async function GET() {
  try {
    const maxCustomTags = await getMaxCustomTags();
    const submissionDeadline = await getSubmissionDeadline();
    const maxAvatarSizeMb = await getMaxAvatarSizeMb();
    const maxEvaluationSizeMb = await getMaxEvaluationSizeMb();
    const maxProfileSubmissions = await getMaxProfileSubmissions();
    return NextResponse.json({ maxCustomTags, submissionDeadline, maxAvatarSizeMb, maxEvaluationSizeMb, maxProfileSubmissions });
  } catch (err) {
    console.error("Profile config GET error:", err);
    return NextResponse.json({ error: "获取配置失败" }, { status: 500 });
  }
}

/** datetime-local 原生格式（容忍可选秒） */
const DATETIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** 上传大小上限校验：整数 1–20（#111） */
function parseSizeLimitMb(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 20) return null;
  return value;
}

/** 校验并规范化截止时间：返回 `YYYY-MM-DD HH:mm`；非法返回 null（双重校验：格式 + 真实日期存在） */
function parseDeadline(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!DATETIME_LOCAL_PATTERN.test(value)) return null;
  if (Number.isNaN(new Date(value).getTime())) return null;
  return value.slice(0, 16).replace("T", " ");
}

export async function PUT(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    // 变更前快照（审计记 old/new，#110）
    const oldMaxCustomTags = await getMaxCustomTags();
    const oldDeadline = await getSubmissionDeadline();
    const oldMaxAvatarSizeMb = await getMaxAvatarSizeMb();
    const oldMaxEvaluationSizeMb = await getMaxEvaluationSizeMb();
    const oldMaxProfileSubmissions = await getMaxProfileSubmissions();

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

    // 上传大小上限（#111，可选提交）：整数 1–20，按资源类型分设
    if (body.maxAvatarSizeMb !== undefined) {
      const value = parseSizeLimitMb(body.maxAvatarSizeMb);
      if (value === null) {
        return NextResponse.json({ error: "头像大小上限须为 1-20 的整数（MB）" }, { status: 400 });
      }
      await setProfileConfig(MAX_AVATAR_SIZE_KEY, String(value));
    }
    if (body.maxEvaluationSizeMb !== undefined) {
      const value = parseSizeLimitMb(body.maxEvaluationSizeMb);
      if (value === null) {
        return NextResponse.json({ error: "词云大小上限须为 1-20 的整数（MB）" }, { status: 400 });
      }
      await setProfileConfig(MAX_EVALUATION_SIZE_KEY, String(value));
    }

    // 历史版本上限（#95，可选提交）：整数 1–100
    if (body.maxProfileSubmissions !== undefined) {
      const value = Number(body.maxProfileSubmissions);
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        return NextResponse.json({ error: "版本上限须为 1-100 的整数" }, { status: 400 });
      }
      await setProfileConfig(MAX_PROFILE_SUBMISSIONS_KEY, String(value));
    }

    const maxCustomTags = await getMaxCustomTags();
    const submissionDeadline = await getSubmissionDeadline();
    const maxAvatarSizeMb = await getMaxAvatarSizeMb();
    const maxEvaluationSizeMb = await getMaxEvaluationSizeMb();
    const maxProfileSubmissions = await getMaxProfileSubmissions();
    void recordAudit({
      ...actor, action: "profile-config:update", method: "PUT", path: "/api/manage/profile-config",
      resource_type: "profile-config", resource_id: null,
      status: "success", error_message: null, ip, user_agent,
      metadata: {
        old: {
          maxCustomTags: oldMaxCustomTags,
          submissionDeadline: oldDeadline,
          maxAvatarSizeMb: oldMaxAvatarSizeMb,
          maxEvaluationSizeMb: oldMaxEvaluationSizeMb,
          maxProfileSubmissions: oldMaxProfileSubmissions,
        },
        new: { maxCustomTags, submissionDeadline, maxAvatarSizeMb, maxEvaluationSizeMb, maxProfileSubmissions },
      },
    });
    return NextResponse.json({ ok: true, maxCustomTags, submissionDeadline, maxAvatarSizeMb, maxEvaluationSizeMb, maxProfileSubmissions });
  } catch (err) {
    console.error("Profile config PUT error:", err);
    return NextResponse.json({ error: "保存配置失败" }, { status: 500 });
  }
}
