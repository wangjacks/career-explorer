import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FILE = "src/components/GeetestCaptcha.tsx";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CODE = stripComments(readFileSync(join(process.cwd(), FILE), "utf8"));
const holderLine = CODE.split("\n").find((line) => line.includes("ref={containerRef}")) ?? "";

// #276：极验用 bind 形态，验证弹层挂在 `<body>` 上，组件里的挂载点永远不会有内容。
// 历史上它被套了一层「槽位」样式（min-h-[46px] + bg-background/60 + border），
// 于是在密码框与提交按钮之间渲染成一个没有任何内容的空黑框。
// 槽位样式一旦回来就会在线上复发（本地不配凭证时整块不渲染，跑不到那条分支），
// 所以这里从源码层面钉死：挂载点可以存在，但不许有任何视觉。
const SLOT_STYLES = ["min-h-[46px]", "bg-background", "border-border-soft", "rounded-xl"];

describe("人机验证挂载点不得有可见槽位样式（#276）", () => {
  it("挂载点那行不含槽位的尺寸 / 底色 / 描边 / 圆角类", () => {
    expect(holderLine, "找不到极验挂载点，容器可能被删了").not.toBe("");
    for (const cls of SLOT_STYLES) {
      expect(holderLine, `挂载点不该带槽位样式: ${cls}`).not.toContain(cls);
    }
  });

  it("整个组件不再出现旧的槽位容器写法", () => {
    expect(CODE).not.toContain("min-h-[46px]");
  });

  it("挂载点仍在渲染树里，且不用 display:none 藏起来（SDK 需要一个可见渲染的元素）", () => {
    expect(holderLine).toContain("ref={containerRef}");
    // 允许 absolute / h-0 / overflow-hidden 这类不占位的写法，唯独不能整块从渲染树摘掉
    expect(holderLine).not.toMatch(/(?:^|["'\s])hidden(?:["'\s]|$)/);
    expect(holderLine).not.toMatch(/\bdisplay\s*:\s*none/);
  });

  it("验证形态与提交口径不变：仍是 bind，且未拿到票据时走 showBox 弹层", () => {
    expect(CODE).toContain('product: "bind"');
    expect(CODE).toContain("showBox()");
    expect(CODE).toContain("onVerifiedRef.current(null)"); // 未配凭证时的降级提交口径
  });
});
