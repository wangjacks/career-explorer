import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../../next.config";

/**
 * #318：/form 占位页已彻底删除。
 * 这个守卫锁四件事：旧链接由 next.config.ts 永久重定向兜底、页面目录不再存在、
 * 全局用户菜单不再为它保留分支、站内代码不再引用该路径。
 * 任何一条被改回来都会让本测试失败。
 */
describe("/form retirement", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  /** 递归收集 src 下的 .ts/.tsx，供「无站内引用」守卫逐文件扫描 */
  const collectSources = (dir: string, acc: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collectSources(full, acc);
      else if (/\.tsx?$/.test(entry.name)) acc.push(full);
    }
    return acc;
  };

  it("redirects /form to the homepage permanently, with a single matching rule", async () => {
    expect(typeof nextConfig.redirects).toBe("function");
    const rules = await nextConfig.redirects!();
    const formRules = rules.filter((rule) => rule.source === "/form");

    // 只能有一条：两条同源规则会让最终落点取决于声明顺序
    expect(formRules).toHaveLength(1);
    // permanent: true 在 Next 中产出 308；/form 之下从未存在子路由，不需要通配
    expect(formRules[0]).toMatchObject({ destination: "/", permanent: true });
  });

  it("no longer ships the placeholder page directory", () => {
    expect(existsSync(join(process.cwd(), "src/app/form"))).toBe(false);
  });

  it("keeps /form out of the global user menu page set", () => {
    const userMenu = read("src/components/UserMenu.tsx");
    const start = userMenu.indexOf("const APP_PAGES");
    const end = userMenu.indexOf("function shouldShowMenu");

    // 切片边界必须真的找到，否则下面的断言会因为空字符串而假通过
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const appPages = userMenu.slice(start, end);
    expect(appPages).not.toContain('"/form"');
    // 收敛时不得误删其他页面，否则菜单会在这些页面上消失
    for (const page of ["/", "/about", "/dashboard/admin", "/dashboard/teacher", "/dashboard/student"]) {
      expect(appPages).toContain(`"${page}"`);
    }
  });

  it("leaves no runtime reference to /form outside the redirect config", () => {
    const self = join(process.cwd(), "src/__tests__/route-form-retirement.test.ts");
    const offenders = collectSources(join(process.cwd(), "src"))
      .filter((file) => file !== self)
      .filter((file) => readFileSync(file, "utf8").includes('"/form"'));

    // 重定向配置在 next.config.ts（src 之外），站内代码里不应再出现该路径
    expect(offenders).toEqual([]);
  });
});
