import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const API_DIR = join(process.cwd(), "src/app/api");
const HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** 有意不包裹的豁免路由及原因（新增豁免必须在此登记原因，否则视为违规） */
const EXEMPT: Record<string, string> = {
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

/** 枚举文件里实际导出的 HTTP 方法名：`export async function`、`export const`、`export { ... [as NAME] } [from]` */
function exportedHttpNames(src: string): Set<string> {
  const names = new Set<string>();
  for (const m of src.matchAll(new RegExp(`export\\s+async\\s+function\\s+(${HTTP.join("|")})\\b`, "g"))) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(new RegExp(`export\\s+const\\s+(${HTTP.join("|")})\\b`, "g"))) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}(?:\s*from\s*["'][^"']+["'])?/g)) {
    for (const raw of m[1].split(",")) {
      const tok = raw.trim().replace(/\/\/.*$/, "").trim();
      if (!tok) continue;
      const asMatch = tok.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      const name = asMatch ? asMatch[1] : tok.split(/\s+/)[0];
      if (HTTP.includes(name)) names.add(name);
    }
  }
  return names;
}

/** 某个导出名是否在本文件里被 `const NAME = withDemoScope(...)` 绑定（初始化可跨行，取到首个 `;`） */
function boundToWithDemoScope(src: string, name: string): boolean {
  const m = src.match(new RegExp(`\\bconst\\s+${name}\\s*=\\s*([\\s\\S]*?);`));
  return !!m && m[1].trimStart().startsWith("withDemoScope(");
}

describe("demo-scope 覆盖率守卫", () => {
  it("豁免清单与磁盘上的实际路由一致（避免清单漂移）", () => {
    const rels = files.map(rel);
    for (const r of Object.keys(EXEMPT)) {
      expect(rels, `豁免项应仍存在: ${r}`).toContain(r);
    }
  });

  it("每个非豁免文件导出的每个 HTTP handler 都必须绑定 withDemoScope", () => {
    const violations: string[] = [];
    for (const f of files) {
      const r = rel(f);
      if (EXEMPT[r]) continue;
      const src = readFileSync(f, "utf8");
      const exported = exportedHttpNames(src);

      for (const name of exported) {
        const bareFn = new RegExp(`export\\s+async\\s+function\\s+${name}\\b`).test(src);
        if (bareFn) {
          violations.push(`${r}: ${name} 是未包裹的裸 handler 导出`);
        } else if (!boundToWithDemoScope(src, name)) {
          violations.push(`${r}: ${name} 导出未绑定 withDemoScope`);
        }
      }
    }
    expect(violations, `发现未覆盖路由:\n${violations.join("\n")}`).toEqual([]);
  });

  it("守卫自身可识别多行初始化 / 部分包裹 / 重导出（防不变量退化）", () => {
    // 多行 const 初始化仍应判为已绑定
    const multiLine = "const GET_impl = () => {};\nexport const GET =\n  withDemoScope(GET_impl);\n";
    expect(exportedHttpNames(multiLine).has("GET")).toBe(true);
    expect(boundToWithDemoScope(multiLine, "GET")).toBe(true);

    // 部分包裹：GET 已包、POST 裸导出——POST 应被枚举且判为未绑定
    const partial = "export const GET = withDemoScope(a);\nexport async function POST(r) { return 1; }\n";
    expect([...exportedHttpNames(partial)].sort()).toEqual(["GET", "POST"]);
    expect(boundToWithDemoScope(partial, "GET")).toBe(true);
    expect(boundToWithDemoScope(partial, "POST")).toBe(false);

    // `export { x as GET }` 重导出但无 withDemoScope 绑定——应检出
    const reexport = 'import { handler } from "./x";\nexport { handler as GET };\n';
    expect(exportedHttpNames(reexport).has("GET")).toBe(true);
    expect(boundToWithDemoScope(reexport, "GET")).toBe(false);
  });
});
