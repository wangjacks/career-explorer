import { AsyncLocalStorage } from "async_hooks";
import type { NextRequest } from "next/server";
import { verifyToken } from "./token";

/**
 * 演示沙箱的请求级数据源作用域。
 *
 * 物理隔离方案：进程内并存生产 adapter 与独立演示库 adapter，`src/lib/db.ts` 的
 * `ensureInit()` 依此作用域决定返回哪一个。AsyncLocalStorage 只覆盖 Node runtime
 * 内的 await 链——本项目全部 DB 访问都在 API 路由 handler 内 await，故在路由入口
 * 用 `withDemoScope` 设定作用域即可完整覆盖（页面/中间件/hook 均不碰 DB）。
 */

const als = new AsyncLocalStorage<{ demo: true }>();

/** 当前执行是否处于演示作用域（默认否 = 生产） */
export function isDemoScope(): boolean {
  return als.getStore()?.demo === true;
}

/** 在演示作用域内运行 `fn`，其 await 下游的 DB 调用都会改道到演示库 */
export function runInDemoScope<T>(fn: () => T): T {
  return als.run({ demo: true }, fn);
}

/**
 * 演示沙箱总开关。每次调用读取 env（改后重启进程即生效），仿 `APP_PUBLIC_URL`
 * 的模式；刻意不放进 `DbConfig`，避免经 settings API 暴露或被 PUT 覆盖。
 */
export function isDemoEnabled(): boolean {
  return process.env.DEMO_ENABLED === "true";
}

/** 演示库文件路径；须落在 cwd 或临时目录内（由 SqliteAdapter 构造再校验） */
export function getDemoDbPath(): string {
  return process.env.DEMO_DB_PATH || "./data/career-demo.db";
}

/**
 * 包裹 Next API 路由 handler：请求携带的 token 若为演示会话，则在演示作用域内执行，
 * 使 handler 内所有 `@/lib/db` 调用改道到演示库；否则原样执行（生产 adapter）。
 *
 * fail-safe：判定为 demo 即进 demo 作用域——即便随后 `DEMO_ENABLED` 被关闭，
 * `db.ts` 的演示 adapter 工厂会抛错（→ 500），绝不回落到生产库。
 */
/**
 * 包裹 Next API 路由 handler：请求携带的 token 若为演示会话，则在演示作用域内执行，
 * 使 handler 内所有 `@/lib/db` 调用改道到演示库；否则原样执行（生产 adapter）。
 *
 * 用变泛型 `<A, R>` 透传每个 handler 自身的入参数量与返回类型：静态/公开 handler 可能
 * 无参（如 `GET()`），动态路由则要求 `(request, { params })`——包装器保留各自签名，
 * 不强行注入可选 `ctx`（否则会与「必填 ctx」的动态路由 handler 冲突）。
 *
 * fail-safe：判定为 demo 即进 demo 作用域——即便随后 `DEMO_ENABLED` 被关闭，
 * `db.ts` 的演示 adapter 工厂会抛错（→ 500），绝不回落到生产库。
 */
export function withDemoScope<A extends unknown[], R>(
  handler: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const request = args[0] as NextRequest | undefined;
    const token = request?.cookies?.get("auth_token")?.value;
    if (token) {
      const result = await verifyToken(token);
      if (result.valid && result.demo === true) {
        return runInDemoScope(() => handler(...args));
      }
    }
    return handler(...args);
  };
}
