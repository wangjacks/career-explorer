import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { getDefaultStorageBackend, getMaxAvatarSizeMb, getMaxEvaluationSizeMb } from "@/lib/db";
import { generateObjectKey, getStorage } from "@/lib/storage";
import { createThumbnail } from "@/lib/thumbnail";
import { getThumbnailKey } from "@/lib/thumbnail-utils";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";
import {
  UPLOAD_FAILED_MESSAGE,
  UPLOAD_UNSUPPORTED_FORMAT_MESSAGE,
  isUnsupportedFormatError,
} from "@/lib/upload-utils";

/** 压缩尺寸上限（#111，保持宽高比，只缩小不放大）：头像 512×512、词云长边 1024 */
const RESIZE_LIMITS: Record<string, { width: number; height: number }> = {
  avatar: { width: 512, height: 512 },
  evaluation: { width: 1024, height: 1024 },
};

/** 表单里的 studentId 来自未鉴权请求，仅作线索：形态合法才入库，绝不作身份 */
function normalizeClaimedStudentId(value: string | null | undefined): string | null {
  return typeof value === "string" && /^\d{4,20}$/.test(value) ? value : null;
}

interface UploadFailureContext {
  action: "upload:rejected" | "upload:failed";
  /** 面向用户的失败原因 */
  message: string;
  prefix?: string | null;
  file?: File | null;
  limitMb?: number;
  claimedStudentId?: string | null;
  /** 500 分支的底层异常原文：供运维定位（如 sharp 的格式/损坏文案），进 metadata */
  cause?: unknown;
}

/**
 * 上传失败审计（#206）：本端点在校验或解码失败时原先只写服务器 stdout，
 * 学生端与管理端都看不到任何原因。动作取 "upload:rejected"（校验类拒绝）/
 * "upload:failed"（解码与其它异常），细节进 metadata，**不记文件名与文件内容**。
 * recordAudit 内部静默降级，审计绝不阻断响应。
 */
function auditUploadFailure(request: NextRequest, ctx: UploadFailureContext): void {
  const { ip, user_agent } = getRequestContext(request);
  const metadata = {
    prefix: ctx.prefix ?? null,
    sizeBytes: ctx.file?.size ?? null,
    mime: ctx.file?.type ?? null,
    limitMb: ctx.limitMb ?? null,
    cause: ctx.cause instanceof Error ? ctx.cause.message : ctx.cause ? String(ctx.cause) : null,
  };
  void (async () => {
    const actor = await getAuditActor(request);
    await recordAudit({
      ...actor,
      action: ctx.action,
      method: "POST",
      path: "/api/upload",
      resource_type: "upload",
      resource_id: normalizeClaimedStudentId(ctx.claimedStudentId),
      status: "failed",
      error_message: ctx.message,
      ip,
      user_agent,
      metadata,
    });
  })();
}

export async function POST(request: NextRequest) {
  // 三个表单字段与体积上限声明在 try 之外：formData 解析后、抛错前的现场信息
  // 要能被失败审计带上（截断的请求体、格式不匹配的文件等都是靠这些才能定位）
  let file: File | null = null;
  let prefix: string | null = null;
  let studentId: string | null = null;
  let limitMb: number | undefined;
  try {
    const formData = await request.formData();
    file = formData.get("file") as File | null;
    prefix = formData.get("prefix") as string | null;
    studentId = formData.get("studentId") as string | null;

    /** 校验类拒绝：统一记审计后再回响应，避免「返回了 400 但审计里什么都没有」 */
    const reject = (message: string) => {
      auditUploadFailure(request, {
        action: "upload:rejected",
        message,
        prefix,
        file,
        limitMb,
        claimedStudentId: studentId,
      });
      return NextResponse.json({ error: message }, { status: 400 });
    };

    if (!file) {
      return reject("未选择文件");
    }

    if (!file.type.startsWith("image/")) {
      return reject("仅支持图片文件");
    }

    // SVG 可内嵌脚本，直接提供会构成存储型 XSS（#111 安全加固）：显式拒绝，仅接受经 sharp 光栅化的位图
    if (file.type.includes("svg") || /\.(svg|svgz)$/i.test(file.name ?? "")) {
      return reject("不支持 SVG 格式，请使用 JPG / PNG 等图片");
    }

    if (!prefix || !studentId) {
      return reject("缺少 prefix 或 studentId");
    }
    if (prefix !== "avatar" && prefix !== "evaluation") {
      return reject("资源类型无效");
    }

    // 按资源类型校验大小上限（#111，管理后台可配置，默认头像 5MB / 词云 10MB）
    limitMb = prefix === "avatar" ? await getMaxAvatarSizeMb() : await getMaxEvaluationSizeMb();
    if (file.size > limitMb * 1024 * 1024) {
      return reject(`图片大小不能超过 ${limitMb}MB`);
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 服务端压缩（#111）：尺寸约束 + 质量 85，只存处理后版本，降低存储与带宽成本
    const resize = RESIZE_LIMITS[prefix];
    const jpgBuffer = await sharp(buffer)
      .resize({ width: resize.width, height: resize.height, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    // 写入当前默认存储后端（#111），并返回文件所在后端 id 供档案保存记录路由
    const backend = await getDefaultStorageBackend();
    if (!backend) {
      return NextResponse.json({ error: "存储后端未初始化" }, { status: 500 });
    }
    const key = generateObjectKey(prefix, studentId);

    // #118：同步生成并落盘缩略图（key 按 `_thumb` 后缀派生，DB 零字段）；失败不阻断原图上传
    try {
      const thumbBuffer = await createThumbnail(jpgBuffer, prefix as "avatar" | "evaluation");
      const thumbKey = getThumbnailKey(key);
      if (backend.type === "local") {
        // 动态路径校验需运行时解析（防穿越），豁免 Turbopack 静态追踪
        const uploadDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "uploads");
        await mkdir(uploadDir, { recursive: true });
        await writeFile(path.join(uploadDir, thumbKey), thumbBuffer);
      } else {
        const storage = await getStorage(backend.id);
        await storage.upload(thumbKey, thumbBuffer, "image/jpeg");
      }
    } catch (thumbErr) {
      console.error("Thumbnail generation failed, original upload continues:", thumbErr);
    }

    if (backend.type === "local") {
      // 动态路径校验需运行时解析（防穿越），豁免 Turbopack 静态追踪
      const uploadDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "uploads");
      await mkdir(uploadDir, { recursive: true });
      await writeFile(path.join(uploadDir, key), jpgBuffer);
      return NextResponse.json({ url: `/api/uploads/${key}`, storageId: backend.id });
    }

    const storage = await getStorage(backend.id);
    await storage.upload(key, jpgBuffer, "image/jpeg");
    return NextResponse.json({ url: key, storageId: backend.id });
  } catch (err) {
    console.error("Upload error:", err);
    // 解码失败细分为「格式不支持」：学生能据此换格式，而不是反复重试同一张图
    const cause = err instanceof Error ? err.message : String(err);
    const message = isUnsupportedFormatError(cause) ? UPLOAD_UNSUPPORTED_FORMAT_MESSAGE : UPLOAD_FAILED_MESSAGE;
    auditUploadFailure(request, {
      action: "upload:failed",
      message,
      prefix,
      file,
      limitMb,
      claimedStudentId: studentId,
      cause,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
