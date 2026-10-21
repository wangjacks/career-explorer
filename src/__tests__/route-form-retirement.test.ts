import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../../next.config";

/**
 * #318：/form 占位页已彻底删除。
 * 这个守卫锁三件事：旧链接由 next.config.ts 永久重定向兜底、页面目录不再存在、
 * 全局用户菜单不再为它保留显示分支。任何一条被改回来都会让本测试失败。
 */
describe("/form retirement", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("redirects /form to the homepage permanently", async () => {
    expect(typeof nextConfig.redirects).toBe("function");
    const rules = await nextConfig.redirects!();
    const formRule = rules.find((rule) => rule.source === "/form");

    expect(formRule).toBeDefined();
    // permanent: true 在 Next 中产出 308；/form 之下从未存在子路由，不需要通配
    expect(formRule).toMatchObject({ destination: "/", permanent: true });
  });

  it("no longer ships the placeholder page directory", () => {
    expect(existsSync(join(process.cwd(), "src/app/form"))).toBe(false);
  });

  it("keeps /form out of the global user menu page set", () => {
    const userMenu = read("src/components/UserMenu.tsx");
    const appPages = userMenu.slice(
      userMenu.indexOf("const APP_PAGES"),
      userMenu.indexOf("function shouldShowMenu")
    );

    expect(appPages).not.toContain('"/form"');
    // 收敛时不得误删其他页面，否则菜单会在这些页面上消失
    for (const page of ["/", "/about", "/dashboard/admin", "/dashboard/teacher", "/dashboard/student"]) {
      expect(appPages).toContain(`"${page}"`);
    }
  });

  it("leaves no runtime reference to /form outside the redirect config", () => {
    const homePage = read("src/app/page.tsx");
    expect(homePage).not.toContain('"/form"');
  });
});
