<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

> `CLAUDE.md` 内容仅为 `@AGENTS.md`（引用入口），AGENTS.md 是 AI Agent 指南的唯一主文件。

## 1. Project Overview

- 项目名称：Career Explorer（学生职业探索工具）
- 技术栈：Next.js 16 App Router + React 19 + TypeScript strict + Tailwind CSS v4
- 数据库：MySQL (mysql2) / SQLite (better-sqlite3) 双适配器
- 关键依赖：jose (JWT)、bcrypt、recharts、exceljs、jszip、sharp、sonner
- 开发环境：Node.js 24 LTS, npm

## 2. Directory Structure & Module Responsibilities

| 目录 | 职责 |
|---|---|
| `src/app/` | Next.js App Router 页面 + API 路由 |
| `src/app/admin/` | 教师管理面板（单页面，组件在 components/admin/） |
| `src/app/api/admin/` | 管理端 API（auth、stats、students、profiles、settings、export、export-images、backup、test-db） |
| `src/app/api/profile/` | 学生档案保存 |
| `src/app/api/upload/` | 文件上传 |
| `src/app/api/validate-student/` | 学号验证 |
| `src/app/api/setup/` | 安装引导（首次配置数据库，含 status/test 子路由） |
| `src/app/api/uploads/[...path]/` | 静态文件服务（含路径穿越防护） |
| `src/components/admin/` | Admin 面板子组件（DashboardTab、ExportTab、OverviewTab、SettingsTab、StudentsTab 等） |
| `src/components/` | 公共组件（ErrorBoundary、InstallGuard、NavigationBar、WordCloudCanvas 等） |
| `src/lib/` | 数据层和工具库 |
| `src/lib/db.ts` | 数据库抽象层（DbAdapter 接口 + 工厂函数） |
| `src/lib/db-mysql.ts` | MySQL 适配器 |
| `src/lib/db-sqlite.ts` | SQLite 适配器 |
| `src/lib/db-config.ts` | 数据库配置读写（db-config.json） |
| `src/lib/auth.ts` | 认证工具（bcrypt 密码验证、jose JWT 签发/验证） |
| `src/lib/sanitize.ts` | URL 安全校验（XSS 防护） |
| `src/lib/tagData.ts` | 标签数据（硬编码的标签分类） |
| `src/hooks/` | 自定义 React hooks（useAdminAuth） |
| `src/types/` | TypeScript 类型定义 |
| `src/middleware.ts` | 认证中间件（JWT Cookie 校验） |
| `src/__tests__/` | 单元测试（auth、middleware、sanitize） |
| `uploads/` | 用户上传文件（头像、评价词云图片，gitignored） |
| `data/` | SQLite 数据库文件（gitignored） |
| `docs/` | 项目文档（architecture、standards、plan、overview、issue-standard） |

## 3. Database Conventions

- 抽象层：`src/lib/db.ts` 定义 `DbAdapter` 接口，所有数据库操作通过此接口
- 适配器模式：`db-mysql.ts`（MySQL）和 `db-sqlite.ts`（SQLite）实现 `DbAdapter`
- 配置来源：`db-config.json`（运行时文件，gitignored），通过 `db-config.ts` 读写
- 配置结构：`DbConfig` 接口 — `type: "mysql" | "sqlite"`，`installed` 标志，连接参数
- 当前表：`students` + `profiles`（两表分离设计）
- 初始化流程：首次访问 -> `/setup` 页面配置数据库 -> 写入 `db-config.json`
- 安装状态检查：`isInstalled()` 函数 + `/api/setup/status` 端点

## 4. Coding Conventions

- TypeScript strict 模式（`"strict": true`）
- 路径别名：`@/*` -> `./src/*`
- 组件使用默认导出，工具函数使用具名导出
- 客户端组件加 `"use client"` 指令
- API 路由使用 `NextRequest` / `NextResponse`
- 中文 UI，注释可不写或写英文
- 禁止空 `catch {}`，至少加 `console.error` 或用户错误提示
- 测试框架：vitest（`npm run test`）

## 5. Security & Authentication

- 认证流程：`/api/admin/auth` 验证密码（bcrypt）-> 签发 JWT（jose HS256, 24h）-> HttpOnly Cookie (`admin_token`)
- 中间件：`middleware.ts` 拦截 `/admin/*` 和 `/api/admin/*`，校验 `admin_token` cookie
- 白名单：`/api/admin/auth` 放行（登录端点）；非 API 路由放行（客户端处理登录态）
- URL 安全：`sanitize.ts` 防止 `javascript:` 协议 XSS
- 路径穿越防护：`/api/uploads/[...path]` 已加固
- 环境变量：`ADMIN_PASSWORD_HASH`（管理员密码 bcrypt hash，备用）、`JWT_SECRET`（JWT 签名密钥）、`ALLOWED_ORIGINS`（CORS 白名单）
- 密码 hash 来源：`admin-hash.txt` 文件 > 环境变量 `ADMIN_PASSWORD_HASH`

## 6. Git Workflow & Commit Conventions

- 双分支策略：`main`（稳定发布）+ `dev`（日常开发）
- PR 始终目标 `dev`，使用 Squash and Merge
- Commit 格式：`<type>: <中文描述>`（feat/fix/refactor/chore/docs/test）
- 所有 commit 必须 GPG 签名
- Pre-commit hooks：husky + lint-staged 自动 `eslint --fix`
- CI：GitHub Actions（lint + build）

## 7. Key Design Patterns

- 安装引导：`InstallGuard` 组件检测安装状态，未安装时重定向到 `/setup`
- 文件上传：`/api/upload` 处理上传 -> `uploads/` 目录 -> `/api/uploads/[...path]` 静态服务
- 数据导出：ExcelJS (Excel) + JSZip (ZIP 打包)
- 词云渲染：`WordCloudCanvas` + `WordCloudClient` 客户端组件
- 管理面板：Tab 式布局（DashboardTab、StudentsTab、ExportTab、OverviewTab、SettingsTab）
