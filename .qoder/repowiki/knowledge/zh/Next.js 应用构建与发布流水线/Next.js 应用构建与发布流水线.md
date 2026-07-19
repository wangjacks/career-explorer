---
kind: build_system
name: Next.js 应用构建与发布流水线
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - next.config.ts
    - tsconfig.json
    - postcss.config.mjs
    - eslint.config.mjs
    - .github/workflows/ci.yml
    - .husky/pre-commit
---

本项目基于 Next.js App Router，采用纯 npm 脚本驱动构建流程，配合 GitHub Actions 实现 CI 检查与构建。整体构建体系围绕 package.json 中的脚本、next.config.ts 运行时配置以及 .github/workflows/ci.yml 流水线展开，未引入 Makefile、Dockerfile 等外部构建工具。

1. 构建系统与方法
- 构建工具：Next.js 内置构建器（next build），通过 npm run build 触发。
- 开发服务器：next dev 提供热重载开发体验。
- 生产启动：next start 运行编译后的产物。
- 类型检查与编译：TypeScript 6 + Next.js TypeScript 插件，tsconfig.json 中启用 strict 模式与 moduleResolution: bundler，并通过 @/* 路径别名指向 src/。
- CSS 处理：Tailwind CSS v4 + @tailwindcss/postcss，由 PostCSS 在构建时处理。
- Lint：ESLint 9 + eslint-config-next，集成 Core Web Vitals 与 TypeScript 规则，并通过 lint-staged 在 pre-commit 阶段自动修复 TS/TSX 文件。

2. 关键配置文件
- package.json：定义所有构建脚本、依赖版本及 husky/lint-staged 钩子。
- next.config.ts：声明 serverExternalPackages: ["mysql2"] 以将数据库客户端保留在服务端；配置 allowedDevOrigins 环境变量；为根路径设置 Cache-Control: no-cache, no-store, must-revalidate 响应头。
- tsconfig.json：统一目标 ES2017、开启严格模式、增量编译、Next.js 插件与路径映射。
- postcss.config.mjs：仅注册 Tailwind PostCSS 插件。
- eslint.config.mjs：继承 Next 官方 ESLint 配置并覆盖忽略列表与图片规则。
- .github/workflows/ci.yml：在 push/PR 到 main/dev 分支时执行 npm ci → npm run lint → npm run build。
- .husky/pre-commit：结合 lint-staged 在提交前对 TS/TSX 执行 eslint --fix。

3. 架构与约定
- 无独立打包器（Webpack/Vite/Rollup）暴露配置，全部通过 Next.js 提供的扩展点（next.config.ts、PostCSS、ESLint）进行定制。
- 服务端包隔离：mysql2 被显式加入 serverExternalPackages，避免将其打入前端 bundle。
- 构建产物输出至默认 .next/ 目录，未被 git 跟踪。
- 版本号管理：项目版本集中在 package.json 的 version 字段，未使用 lerna/pnpm workspace 等多包方案。
- 依赖锁定：使用 package-lock.json，CI 通过 npm ci 保证可重复安装。

4. 开发者应遵循的规则
- 新增依赖后需同步更新 package.json，并确保其可在 Node 24 环境下安装（CI 固定使用该版本）。
- 若引入新的服务端第三方包，需在 next.config.ts 的 serverExternalPackages 中声明，防止误入客户端 bundle。
- 修改样式时需遵循 Tailwind v4 语法，并通过 PostCSS 构建验证。
- 提交前确保 npm run lint 通过，lint-staged 会自动修复可自动修正的问题。
- 如需自定义构建行为（如重写、headers、环境变量注入），优先在 next.config.ts 中完成，而非直接操作底层打包器。
- 当前仓库未包含 Dockerfile 或部署脚本，部署方式未在代码中体现，需参考外部文档（如 DEPLOY.md）。