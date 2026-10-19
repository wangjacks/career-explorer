import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const API_DIR = join(process.cwd(), "src/app/api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** 有意不包裹的豁免路由及原因（新增豁免必须在此登记原因，否则视为违规） */
const EXEMPT: Record<string, string> = {
  "src/app/api/uploads/[...path]/route.ts": "纯文件系统静态服务，无 DB、无鉴权",
  "src/app/api/setup/route.ts": "安装引导，直接 new 适配器绕过单例",
  "src/app/api/setup/status/route.ts": "仅读 db-config.json，不访问 DB",
  "src/app/api/setup/test/route.ts": "连接测试，直接 new 适配器绕过单例",
  "src/app/api/manage/test-db/route.ts": "DB 连通性诊断，直接 new 适配器绕过单例",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e === "route.ts") out.push(p);
  }
  return out;
}

const files = walk(API_DIR);
const rel = (f: string) => f.slice(process.cwd().length + 1).replace(/\\/g, "/");

describe("demo-scope 覆盖率守卫", () => {
  it("豁免清单与磁盘上的实际路由一致（避免清单漂移）", () => {
    const rels = files.map(rel);
    for (const r of Object.keys(EXEMPT)) {
      expect(rels, `豁免项应仍存在: ${r}`).toContain(r);
    }
  });

  it("所有非豁免路由的每个 HTTP handler 都经 withDemoScope 包裹", () => {
    const violations: string[] = [];
    for (const f of files) {
      const r = rel(f);
      if (EXEMPT[r]) continue;
      const src = readFileSync(f, "utf8");

      // 1) 禁止裸的 `export async function METHOD`（未包裹）
      const bare = new RegExp(`^export\\s+async\\s+function\\s+(${METHODS.join("|")})\\b`, "m");
      if (bare.test(src)) violations.push(`${r}: 存在未包裹的裸 handler 导出`);

      // 2) 每个 `export const METHOD` 的初始化必须是 withDemoScope(...)
      const exportRe = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=\s*([^\n]+)/g;
      let m: RegExpExecArray | null;
      while ((m = exportRe.exec(src))) {
        if (!m[2].trimStart().startsWith("withDemoScope(")) {
          violations.push(`${r}: export const ${m[1]} 未使用 withDemoScope`);
        }
      }

      // 3) 非豁免文件至少有一个 handler 被包裹
      if (!/withDemoScope\(/.test(src)) {
        violations.push(`${r}: 无任何 withDemoScope 包裹`);
      }
    }
    expect(violations, `发现未覆盖路由:\n${violations.join("\n")}`).toEqual([]);
  });
});
