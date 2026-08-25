import { NextRequest, NextResponse } from "next/server";
import {
  getUsersByStorageId,
  listStorageBackends,
  updateUserStorageRef,
  type UserRow,
} from "@/lib/db";
import { verifyToken } from "@/lib/token";
import { createStorage } from "@/lib/storage";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

/**
 * 本地 → 云对象存储批量迁移（#111，仅管理员）：
 * - 扫描所有归属本地后端的用户，将其头像/词云上传到目标 S3 后端
 * - 幂等：目标已存在的对象跳过（重复执行安全，不覆盖已有有效对象）
 * - 单个用户任一文件失败即跳过该用户（不改引用），不影响其他用户
 * - 成功后原子更新文件引用（本地代理路径 → 对象 key）与后端归属
 */

/** 从本地模式的文件 URL 中提取对象 key：去查询参数、去 `/api/uploads/` 前缀 */
function extractLocalKey(url: string): string {
  const noQuery = url.split("?")[0];
  const proxyPrefix = "/api/uploads/";
  return noQuery.startsWith(proxyPrefix) ? noQuery.slice(proxyPrefix.length) : noQuery;
}

export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);

  const token = request.cookies.get("auth_token")?.value;
  const result = token ? await verifyToken(token) : { valid: false };
  if (!result.valid || !result.role || result.uid == null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (result.role !== "admin") {
    return NextResponse.json({ error: "仅管理员可执行存储迁移" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const targetId = Number(body.targetId);
    if (!Number.isInteger(targetId) || targetId < 1) {
      return NextResponse.json({ error: "缺少目标后端 targetId" }, { status: 400 });
    }

    const backends = await listStorageBackends();
    const local = backends.find((b) => b.type === "local");
    const target = backends.find((b) => b.id === targetId);
    if (!local) {
      return NextResponse.json({ error: "本地后端不存在" }, { status: 500 });
    }
    if (!target) {
      return NextResponse.json({ error: "目标后端不存在" }, { status: 404 });
    }
    if (target.type !== "s3") {
      return NextResponse.json({ error: "迁移目标必须是 S3 兼容后端" }, { status: 400 });
    }

    const targetStorage = createStorage(target);
    const localStorage = createStorage(local);
    const users = await getUsersByStorageId(local.id);

    let migrated = 0;
    let skippedObjects = 0;
    let failed = 0;
    const errors: { userCode: string; error: string }[] = [];

    for (const user of users) {
      try {
        const refs = await migrateUserFiles(user, localStorage, targetStorage);
        skippedObjects += refs.skipped;
        await updateUserStorageRef(user.id, target.id, refs.avatarUrl, refs.evaluationUrl);
        migrated++;
      } catch (err) {
        // 单用户失败不中断整体：保持本地引用不变，可重新执行迁移
        failed++;
        errors.push({
          userCode: user.user_code,
          error: err instanceof Error ? err.message : "迁移失败",
        });
      }
    }

    const summary = { targetId: target.id, targetName: target.name, migrated, skippedObjects, failed };
    void recordAudit({
      ...actor, action: "storage:migrate", method: "POST", path: "/api/manage/storage/migrate",
      resource_type: "storage-backend", resource_id: String(target.id),
      status: failed === 0 ? "success" : "failed",
      error_message: failed > 0 ? `${failed} 名用户迁移失败` : null,
      ip, user_agent,
      metadata: { ...summary, errors: errors.slice(0, 10) },
    });
    return NextResponse.json({ ok: failed === 0, ...summary, errors: errors.slice(0, 20) });
  } catch (err) {
    console.error("Storage migrate error:", err);
    const message = err instanceof Error ? err.message : "迁移失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 迁移单个用户的两个文件；返回更新后的引用与跳过计数 */
async function migrateUserFiles(
  user: UserRow,
  localStorage: ReturnType<typeof createStorage>,
  targetStorage: ReturnType<typeof createStorage>
): Promise<{ avatarUrl: string | null; evaluationUrl: string | null; skipped: number }> {
  let skipped = 0;
  const avatarUrl = user.avatar_url ? await migrateOne(user.avatar_url) : user.avatar_url ?? null;
  const evaluationUrl = user.evaluation_url ? await migrateOne(user.evaluation_url) : user.evaluation_url ?? null;
  return { avatarUrl, evaluationUrl, skipped };

  async function migrateOne(url: string): Promise<string> {
    const key = extractLocalKey(url);
    if (await targetStorage.exists(key)) {
      skipped++;
      return key;
    }
    const content = await localStorage.read(key);
    await targetStorage.upload(key, content, "image/jpeg");
    return key;
  }
}
