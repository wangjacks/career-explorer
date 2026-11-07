/**
 * 演示库 adapter 的进程级状态（#354）。
 *
 * Next 会为每个 route bundle 各打包一份服务端模块；若状态放在 db.ts 的模块级变量里，
 * status/accounts/reset 等路由会各持一条 SQLite 连接，reset 的 closeDemoDb 只能关掉
 * 当前 bundle 的那一份，其余连接仍锁着文件（Windows 无法删除；Linux 删除后其他 bundle
 * 会继续使用旧 inode）。因此状态必须挂到 globalThis，保证同一进程内所有 bundle 共享。
 */
import type { DbAdapter } from "./db";

export interface DemoDbState {
  adapter: DbAdapter | null;
  type: string;
  init: Promise<void> | null;
}

const GLOBAL_KEY = "__careerExplorerDemoDbState";

type GlobalWithDemoDbState = typeof globalThis & {
  [GLOBAL_KEY]?: DemoDbState;
};

export function getDemoDbState(): DemoDbState {
  const g = globalThis as GlobalWithDemoDbState;
  return (g[GLOBAL_KEY] ??= { adapter: null, type: "", init: null });
}
