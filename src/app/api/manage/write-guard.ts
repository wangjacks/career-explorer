import { NextResponse, type NextRequest } from "next/server";
import { getAuditActor, getRequestContext, recordAudit, type AuditActor } from "@/lib/audit";
import {
  canWriteClass,
  canWriteStudent,
  getSession,
  writableClassIds,
  type ClassScope,
  type Session,
} from "./classes/helpers";

/** 全站生效配置（预设标签、档案功能设置）的拒绝文案：这些项影响所有班级与学生 */
export const GLOBAL_WRITE_ONLY = "该项全站生效，仅管理员可修改";

/** 审计坐标：一个端点的一种写操作（与 `@/lib/audit` 的 `AuditEntry` 不同，这里只有定位字段） */
export interface AuditTarget {
  action: string;
  method: string;
  path: string;
  resource_type: string;
}

/**
 * 管理域写端点的归属闸门（#171）。
 *
 * 存在理由：`proxy.ts` 只做「角色 + 前缀 + 方法」的粗粒度放行，判不了「这条记录属不属于该教师」；
 * 且前缀匹配是 `startsWith`，`/api/manage/students` 会连带放行 `students/batch-password`，
 * 权限表也无法把二者区分开。归属一律在路由内判定，被拒的写同样落审计
 * （AGENTS.md：管理域写操作成败均记）。
 */
export class WriteGuard {
  readonly actor: AuditActor;
  readonly session: Session | null;
  /** 写权限的班级范围：`null` = 不受限（管理员），其余角色拿到具体集合 */
  readonly scope: ClassScope;
  private readonly ip: string;
  private readonly userAgent: string;

  private constructor(
    actor: AuditActor,
    session: Session | null,
    scope: ClassScope,
    ip: string,
    userAgent: string
  ) {
    this.actor = actor;
    this.session = session;
    this.scope = scope;
    this.ip = ip;
    this.userAgent = userAgent;
  }

  static async from(request: NextRequest): Promise<WriteGuard> {
    const [actor, session] = await Promise.all([getAuditActor(request), getSession(request)]);
    const scope = await writableClassIds(session);
    const { ip, user_agent } = getRequestContext(request);
    return new WriteGuard(actor, session, scope, ip, user_agent);
  }

  /** 全站生效的配置（预设标签、档案功能设置）只有管理员能改 */
  get canWriteGlobal(): boolean {
    return this.scope === null;
  }

  /** 会话缺失时的出口（路由不经 proxy 或未带 token） */
  unauthenticated(): NextResponse {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /**
   * 写操作被拒的出口：先落失败审计，再返回错误响应。
   * 默认 403（越权）；参数校验类拒绝传 400。
   */
  deny(
    entry: AuditTarget,
    resource_id: string | null,
    error: string,
    status = 403,
    metadata: unknown = null
  ): NextResponse {
    void recordAudit({
      ...this.actor,
      ...entry,
      resource_id,
      status: "failed",
      error_message: error,
      ip: this.ip,
      user_agent: this.userAgent,
      metadata,
    });
    return NextResponse.json({ error }, { status });
  }

  /** 目标班级是否可写（`classId` 为 null 表示未分班，教师一律不可） */
  canWriteClass(classId: number | null): boolean {
    return canWriteClass(this.scope, classId);
  }

  /** 学生是否可写：以其当前 `class_id` 为准，未分班学生不在任何教师的管辖范围内 */
  canWriteStudent(student: { class_id: number | null }): boolean {
    return canWriteStudent(this.scope, student);
  }
}
