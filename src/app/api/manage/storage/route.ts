import { NextRequest, NextResponse } from "next/server";
import {
  countUsersByStorageId,
  deleteStorageBackend,
  getStorageBackend,
  insertStorageBackend,
  listStorageBackends,
  setDefaultStorageBackend,
  updateStorageBackend,
  type StorageBackendRow,
} from "@/lib/db";
import { verifyToken } from "@/lib/token";
import { getS3Credentials } from "@/lib/storage-s3";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

/**
 * 存储后端管理（#111，仅管理员；教师不在 TEACHER_ALLOWED，proxy 层即 403，此处路由内二次校验）：
 * - GET 列表（凭据仅返回"是否已配置"，绝不回显明文）
 * - POST 新增（仅 s3；本地后端为内置，返回新 id 供配置 `S3_{id}_*` 环境变量）
 * - PUT 更新 / DELETE 删除（本地 / 默认 / 被用户文件引用的后端禁止删除）
 * - PATCH 设默认（事务保证唯一默认）
 */

async function requireAdmin(request: NextRequest): Promise<NextResponse | null> {
  const token = request.cookies.get("auth_token")?.value;
  const result = token ? await verifyToken(token) : { valid: false };
  if (!result.valid || !result.role || result.uid == null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (result.role !== "admin") {
    return NextResponse.json({ error: "仅管理员可管理存储后端" }, { status: 403 });
  }
  return null;
}

/** 后端凭据是否已在环境变量中配置（s3 后端；本地后端恒为 true） */
function credentialsConfigured(backend: StorageBackendRow): boolean {
  if (backend.type === "local") return true;
  try {
    getS3Credentials(backend.id);
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const backends = await listStorageBackends();
    return NextResponse.json({
      backends: backends.map((b) => ({ ...b, credentialsConfigured: credentialsConfigured(b) })),
    });
  } catch (err) {
    console.error("Storage GET error:", err);
    return NextResponse.json({ error: "获取存储后端失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100) {
      return NextResponse.json({ error: "后端名称须为 1-100 字" }, { status: 400 });
    }
    // 本地后端为内置，不允许额外创建
    if (body.type !== "s3") {
      return NextResponse.json({ error: "新增后端仅支持 S3 兼容类型" }, { status: 400 });
    }
    const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    const region = typeof body.region === "string" ? body.region.trim() : "";
    const bucket = typeof body.bucket === "string" ? body.bucket.trim() : "";
    if (!endpoint || !region || !bucket) {
      return NextResponse.json({ error: "S3 后端须填写 endpoint、region、bucket" }, { status: 400 });
    }
    const internalEndpoint = typeof body.internal_endpoint === "string" ? body.internal_endpoint.trim() : "";
    const pathPrefix = typeof body.path_prefix === "string" ? body.path_prefix.trim() : "";

    let id: number;
    try {
      id = await insertStorageBackend({
        name,
        type: "s3",
        endpoint,
        internal_endpoint: internalEndpoint || null,
        region,
        bucket,
        path_prefix: pathPrefix || null,
      });
    } catch {
      return NextResponse.json({ error: "后端名称已存在" }, { status: 400 });
    }

    void recordAudit({
      ...actor, action: "storage:create", method: "POST", path: "/api/manage/storage",
      resource_type: "storage-backend", resource_id: String(id),
      status: "success", error_message: null, ip, user_agent,
      metadata: { name, type: "s3", endpoint, bucket },
    });
    // 返回新 id：凭据按 `S3_{id}_*` 约定配置（不入库），配置后需重启服务生效
    return NextResponse.json({
      ok: true,
      id,
      message: `创建成功。请在 .env.local 中配置 S3_${id}_ACCESS_KEY / S3_${id}_SECRET_KEY 后重启服务`,
    });
  } catch (err) {
    console.error("Storage POST error:", err);
    return NextResponse.json({ error: "创建存储后端失败" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) {
      return NextResponse.json({ error: "缺少后端 id" }, { status: 400 });
    }
    const existing = await getStorageBackend(id);
    if (!existing) {
      return NextResponse.json({ error: "存储后端不存在" }, { status: 404 });
    }

    const fields: Record<string, string | null> = {};
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 100) {
        return NextResponse.json({ error: "后端名称须为 1-100 字" }, { status: 400 });
      }
      fields.name = name;
    }
    for (const key of ["endpoint", "internal_endpoint", "region", "bucket", "path_prefix"] as const) {
      if (body[key] !== undefined) {
        if (body[key] !== null && typeof body[key] !== "string") {
          return NextResponse.json({ error: `${key} 须为字符串` }, { status: 400 });
        }
        const value = body[key] === null ? "" : (body[key] as string).trim();
        fields[key] = value || null;
      }
    }
    // S3 后端三要素不允许被清空
    if (existing.type === "s3") {
      const endpoint = fields.endpoint !== undefined ? fields.endpoint : existing.endpoint;
      const region = fields.region !== undefined ? fields.region : existing.region;
      const bucket = fields.bucket !== undefined ? fields.bucket : existing.bucket;
      if (!endpoint || !region || !bucket) {
        return NextResponse.json({ error: "S3 后端的 endpoint、region、bucket 不可为空" }, { status: 400 });
      }
      // endpoint 存储为 ''（NOT NULL）之外的规范化值
      if (fields.endpoint !== undefined) fields.endpoint = fields.endpoint || "";
    }
    if (fields.endpoint !== undefined && fields.endpoint === null) fields.endpoint = "";

    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "未提供需要更新的字段" }, { status: 400 });
    }
    await updateStorageBackend(id, fields);

    void recordAudit({
      ...actor, action: "storage:update", method: "PUT", path: "/api/manage/storage",
      resource_type: "storage-backend", resource_id: String(id),
      status: "success", error_message: null, ip, user_agent,
      metadata: { fields: Object.keys(fields) },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Storage PUT error:", err);
    const message = err instanceof Error && err.message.includes("UNIQUE") ? "后端名称已存在" : "更新存储后端失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const id = Number(request.nextUrl.searchParams.get("id"));
    if (!Number.isInteger(id) || id < 1) {
      return NextResponse.json({ error: "缺少后端 id" }, { status: 400 });
    }
    const existing = await getStorageBackend(id);
    if (!existing) {
      return NextResponse.json({ error: "存储后端不存在" }, { status: 404 });
    }
    // 删除保护：本地后端内置不可删、默认后端不可删、仍有用户文件引用的后端不可删
    if (existing.type === "local") {
      return NextResponse.json({ error: "本地存储为内置后端，不可删除" }, { status: 400 });
    }
    if (existing.is_default === 1) {
      return NextResponse.json({ error: "默认后端不可删除，请先切换默认" }, { status: 400 });
    }
    const refCount = await countUsersByStorageId(id);
    if (refCount > 0) {
      return NextResponse.json(
        { error: `该后端仍有 ${refCount} 名用户的文件引用，请先迁移后再删除` },
        { status: 400 }
      );
    }
    await deleteStorageBackend(id);

    void recordAudit({
      ...actor, action: "storage:delete", method: "DELETE", path: "/api/manage/storage",
      resource_type: "storage-backend", resource_id: String(id),
      status: "success", error_message: null, ip, user_agent,
      metadata: { name: existing.name },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Storage DELETE error:", err);
    return NextResponse.json({ error: "删除存储后端失败" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) {
      return NextResponse.json({ error: "缺少后端 id" }, { status: 400 });
    }
    const existing = await getStorageBackend(id);
    if (!existing) {
      return NextResponse.json({ error: "存储后端不存在" }, { status: 404 });
    }
    // 设为默认的 S3 后端必须已配置凭据，否则上传会失败
    if (existing.type === "s3" && !credentialsConfigured(existing)) {
      return NextResponse.json(
        { error: `该后端凭据未配置（S3_${id}_ACCESS_KEY / S3_${id}_SECRET_KEY），不可设为默认` },
        { status: 400 }
      );
    }
    await setDefaultStorageBackend(id);

    void recordAudit({
      ...actor, action: "storage:set-default", method: "PATCH", path: "/api/manage/storage",
      resource_type: "storage-backend", resource_id: String(id),
      status: "success", error_message: null, ip, user_agent,
      metadata: { name: existing.name },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Storage PATCH error:", err);
    return NextResponse.json({ error: "设置默认后端失败" }, { status: 500 });
  }
}
