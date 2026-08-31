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
- **v2.0.0 目标**：三角色统一用户体系（admin / teacher / student），四表设计，班级邀请码激活

## 2. Directory Structure & Module Responsibilities

| 目录 | 职责 |
|---|---|
| `src/app/` | Next.js App Router 页面 + API 路由 |
| `src/app/dashboard/admin/` | 管理面板（三组两级导航：数据中心[概览/大屏/导出]、用户管理[学生/教师/班级/标签]、系统设置[数据源/功能设置]） |
| `src/app/dashboard/student/` | 学生面板（个人信息通览 + 就地修改，步骤 9 实现） |
| `src/app/dashboard/teacher/` | 教师面板（三组两级导航：主页、数据中心[概览/大屏/导出]、数据管理[数据列表/学生/班级/标签]、系统设置[功能设置]） |
| `src/app/form/` | 学生档案创建表单：单路由 `/form/create-profile?step=`（登录门 → 标签 → 词云 → 评价 → 形象 → 确认 → 完成），登录优先 + 确认页延迟上传 + 草稿暂存 |
| `src/app/login/` | 登录页（三角色统一登录） |
| `src/app/activate/` | 学生账户激活页（学号 + 姓名 + 邀请码三要素核验） |
| `src/app/setup/` | 安装引导（首次配置数据库 + 管理员密码） |
| `src/app/api/auth/` | 统一认证端点（POST 登录 / GET 会话 / DELETE 登出） |
| `src/app/api/auth/activate/` | 学生账户激活端点 |
| `src/app/api/manage/` | 管理域 API（stats、students、classes、teachers、tags、profiles、settings、export、backup、test-db、profile-config、audit-logs）；`students/batch-password` 子路由：批量重置学生密码（每人生成不同随机密码）；`audit-logs` 只读查询（教师限本人记录，#110）；admin + teacher 共用，角色差异由 proxy 声明式权限表控制 |
| `src/app/api/shared/profile/` | 学生档案（路由自鉴权）：POST 仅学生本人会话保存（拒绝显式指定学号）+ GET 会话查询本人档案 |
| `src/app/api/upload/` | 文件上传 |
| `src/app/api/setup/` | 安装引导 API（含 status/test 子路由） |
| `src/app/api/uploads/[...path]/` | 静态文件服务（含路径穿越防护） |
| `src/components/admin/` | Admin/Teacher 面板子组件（DashboardTab、ExportTab、OverviewTab、SettingsTab、StudentsTab、TagsTab、ClassesTab、TeachersTab、ProfilesTab 数据列表、ClassOverviewTable 班级概览、TeacherHomeTab 教师主页） |
| `src/components/` | 公共组件（ErrorBoundary、NavigationBar、UserMenu、SiteFooter、TagSelector、ImageUploadBox、FormSteps、WordCloudCanvas/Client） |
| `src/hooks/` | 自定义 React hooks（useAdminAuth、useSession、useTheme、useProfileDraft 表单草稿） |
| `src/lib/` | 数据层和工具库 |
| `src/lib/db.ts` | 数据库抽象层（DbAdapter 接口 + 工厂函数） |
| `src/lib/db-mysql.ts` | MySQL 适配器 |
| `src/lib/db-sqlite.ts` | SQLite 适配器 |
| `src/lib/db-config.ts` | 数据库配置读写（db-config.json） |
| `src/lib/auth.ts` | 认证工具（bcrypt 密码验证） |
| `src/lib/password.ts` | 强密码生成（crypto.getRandomValues，浏览器/Node 两端通用） |
| `src/lib/token.ts` | JWT 签发/验证（三角色：role + uid + name claim） |
| `src/lib/sanitize.ts` | URL 安全校验（XSS 防护） |
| `src/lib/tagData.ts` | 标签初始化种子（步骤 7 后不参与运行时展示） |
| `src/lib/tag-utils.ts` | 标签工具函数 |
| `src/lib/profile-draft.ts` | 表单草稿纯逻辑（键定义/存在性判定/标签切换） |
| `src/lib/profile-submit.ts` | 档案提交共享工具（图片上传 + 保存，确认页与学生面板共用） |
| `src/types/` | TypeScript 类型定义 |
| `src/proxy.ts` | 角色权限中间件（替代已删除的 middleware.ts）；内置 TEACHER_ALLOWED 声明式权限表（前缀 + 方法） |
| `src/__tests__/` | 单元测试（auth、proxy、sanitize、token、db-schema） |
| `uploads/` | 用户上传文件（头像、评价词云图片，gitignored） |
| `data/` | SQLite 数据库文件（gitignored） |
| `docs/` | 项目文档（architecture、standards、plan、plan-v2.0.0-uiux、ui-conventions、overview、issue-standard）— **已纳入 Git 跟踪** |

## 3. Database Conventions

- 抽象层：`src/lib/db.ts` 定义 `DbAdapter` 接口，所有数据库操作通过此接口
- 适配器模式：`db-mysql.ts`（MySQL）和 `db-sqlite.ts`（SQLite）实现 `DbAdapter`
- 配置来源：`db-config.json`（运行时文件，gitignored），通过 `db-config.ts` 读写
- 配置结构：`DbConfig` 接口 — `type: "mysql" | "sqlite"`，`installed` 标志，连接参数
- **四表设计（v2.0.0）**：
  - `users` — 统一用户表（替代旧 students + profiles）：
    - `user_code`：用户唯一编号（学生 12 位 / 教师 8 位 / 管理员 5 位从 10001 起），同时作为登录标识
    - `password_hash`：nullable（NULL = 未设置密码）
    - `role`：`admin` | `teacher` | `student`
    - `name`、`class_id`（仅学生）、`tags`（#94 起为标签名称文本数组，如 `["阅读","自定义爱好"]`；预设 + 自定义直存，与标签表解耦）、`avatar_url`、`evaluation_url`、`submitted_at`
  - `classes` — 班级表（`name`、`invitation_code` 唯一）
  - `teacher_classes` — 教师-班级多对多关联
  - `tags` — 预设标签表（`type=category` 一级分类、`type=tag` 二级标签，`parent_id` 建立层级，`class_id=0` = 全局）；#94 起降级为表单预设项，物理删除（分类级联删子标签），停用机制下线（`active` 列保留不再操作）
  - `configs_profile` — 档案功能配置键值表（#94/#96）：配置项 `max_custom_tags`（自定义标签数量上限，默认 6）与 `submission_deadline`（档案提交截止时间 `YYYY-MM-DD HH:mm`，空 = 不限制），纳入备份恢复
  - `audit_logs` — 操作审计表（#110）：只追加 + 查询，无修改/删除接口；操作者字段快照冗余（账号改名/删除后仍可追溯）；敏感键（密码/凭据）脱敏剔除，metadata 截断 2000 字符；索引 `created_at` / `actor_id` / `(resource_type, resource_id)`；纳入备份恢复
- 初始化流程：首次访问 -> `/setup` 页面配置数据库 + 管理员密码 -> 写入 `db-config.json` + `users` 表
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
- **日期时间字段统一用 TEXT 存储**（`datetime('now', 'localtime')`）

## 5. Security & Authentication

- **三角色认证**：admin / teacher / student，统一 `users` 表
- 认证流程：`/api/auth` POST 验证 `user_code` + 密码（bcrypt）-> 签发 JWT（jose HS256, 24h, 含 role/uid/name）-> HttpOnly Cookie (`auth_token`, secure, sameSite=lax)
- 中间件：`proxy.ts` 拦截 `/dashboard/admin/:path*` 和 `/api/manage/:path*`，校验角色权限
- 权限模型（步骤 11 重组）：`/api/manage/*` admin 全部放行；teacher 按 `TEACHER_ALLOWED` 声明式权限表放行（classes/students/tags/export/profile-config 全方法、stats 仅 GET、profiles GET+DELETE，其余 403）；`/api/shared/*` 不进 matcher 由路由自鉴权；其余 `/api/*` 不在拦截范围
- 路由设计原则（步骤 11 决策修订）：API 面向资源组织 + 业务域前缀（manage/shared），角色差异收敛于 proxy 权限表，权限演化不搬路径；否决了按角色拆分路由的原设计
- 白名单：`/api/auth/*` 天然在 proxy matcher 范围外；非 API 路由放行（客户端处理登录态）
- 会话检测：`GET /api/auth` 返回 `{ ok, role, uid, name }`（httpOnly cookie 前端不可读，须经 API 检测）
- 登出：`DELETE /api/auth` 清除 cookie
- 激活：`POST /api/auth/activate` — 名单内学号 + 姓名 + 本班邀请码三者一致后设置密码激活（账户须先由教师导入名单预建），成功自动登录
- 已登录访问 `/login`、`/activate` 自动重定向到对应角色面板
- 用户不存在与密码错误共用「编号或密码错误」（不泄露账号存在性）；无 password_hash 账户提示「该账户尚未设置密码，请联系管理员」
- URL 安全：`sanitize.ts` 防止 `javascript:` 协议 XSS
- 路径穿越防护：`/api/uploads/[...path]` 已加固
- 环境变量（模板 `.env.example`）：`JWT_SECRET`（JWT 签名密钥，生产必需）、`FONT_CDN_PREFIX`（可选，Google Fonts 镜像前缀，构建时生效）、`ALLOWED_ORIGINS`（仅 dev 模式 allowedDevOrigins 白名单，生产无效）
- 管理员密码：在安装引导中配置，bcrypt 哈希存于 `users` 表（user_code=10001）

## 6. Git Workflow & Commit Conventions

- 分支策略：`main`（稳定发布）+ `dev`（日常开发）+ 阶段特性分支（`feat/v2-foundation`、`feat/v2-features`、`feat/v2-panels`、`feat/v2-api-reorg`）
- 日常 PR 目标 `dev`；阶段 PR 使用 **`--no-ff` 合并**（保留每个步骤的独立 commit 历史）
- Commit 格式：`<type>: <中文描述>`（feat/fix/refactor/chore/docs/test）
- **所有 commit 必须 GPG 签名**（`commit.gpgsign=true`），失败则停止告知用户
- **所有 tag 必须 GPG 签名**（annotated tag：`git tag -s -a`）
- 发布流程（release 分支 → main）：
  - 功能集完成即发布，禁止积压；发布动作 = 合并动作，合并即部署
  - 从功能集收官点切 `release/vX.Y.Z`，执行 `npm version X.Y.Z --no-git-tag-version`（同步 package.json / package-lock.json），提交 `chore: release vX.Y.Z`
  - 打签名 tag `vX.Y.Z`，开 PR 到 `main`，合并方式用 **Create a merge commit**（不用 squash），保留发布节点
  - 合并后立即把 `main` 合回 `dev`（尽早处理冲突，版本号随合并继承）
- Hotfix 路径：从 `main` 拉 `hotfix/xxx` → 合 `main`（发布）→ 合回 `dev`
- Pre-commit hooks：husky + lint-staged 自动 `eslint --fix`
- CI：GitHub Actions（lint + test + build，监听 main/dev 的 push 与 PR）
- **GitHub Issue 管理**：每个阶段一个父 Issue，每个步骤一个子 Issue；PR 关联到对应 Issue

## 7. Key Design Patterns

- 安装引导：手动访问 `/setup` 完成首次安装（InstallGuard 全局安装拦截已移除，不再自动重定向；未安装时管理面板显示「数据库未配置」提示）
- 全局用户菜单：`UserMenu` 组件在根布局 `layout.tsx` 单点挂载（`fixed top-0 right-0 z-[45]`），未登录显示「登录」按钮，已登录显示姓名 + 下拉菜单（主题切换 + 个人信息 + 退出登录）
- 主题系统：`useTheme` hook 三态切换（浅色/深色/跟随系统），持久化 localStorage `theme`；`layout.tsx` 内联脚本在 hydration 前预设 `.dark` class 防闪烁，`<html>` 加 `suppressHydrationWarning`；class-based dark（`@custom-variant dark`）
- 品牌色系统：`globals.css` 语义 token（`--color-brand` 深绿 / `--color-accent` 琥珀 / `--color-background` / `--color-card` 等），品牌色在 `.dark` 下自动提亮；全站深绿顶栏 + 大字报 hero；TagSelector 标签三色（兴趣绿/技能蓝/性格琥珀）；详见 `docs/plan-v2.0.0-uiux.md` 与 `docs/ui-conventions.md`
- 共享会话检测：`useSession` hook 供 UserMenu 与 NavigationBar 共用，按 pathname 变化重新检测
- 表单登录优先：档案创建必须学生本人登录（快速提交通道已于 #92 移除）；未登录访问 `/form/create-profile` 显示登录门，登录页支持 `?next=` 回跳（仅站内相对路径）；已提交学生再进入被引导去学生面板修改
- 标签体系（#94）：学生标签文本直存（预设 + 自定义，后端校验自定义数量上限）；预设标签管理支持物理删除与批量导入/删除（均二次确认）；自定义标签上限存 `configs_profile`，管理/教师面板「功能设置」页可配（`/api/manage/profile-config`），表单端经开放端点 `/api/tags` 读取
- 提交时限（#96）：`configs_profile.submission_deadline` 存最晚提交时间（未设置 = 不限制）；超时后 `POST /api/shared/profile` 强制 403，学生面板修改/提交入口禁用，表单登录门与确认页展示已截止；截止状态由服务端按 Asia/Shanghai 计算，经 `/api/tags` 与 `/api/shared/profile` 下发
- 操作审计（#110）：`src/lib/audit.ts` 提供 `recordAudit`（失败静默降级，绝不阻断业务）/ `getAuditActor`（操作者快照）/ `sanitizeMetadata`（敏感键剔除 + 截断）；管理域写操作、认证事件（含登录失败）、档案提交、导出/备份等 22 触点成功与失败均记；查询端点 `/api/manage/audit-logs` 只读，教师强制 `actor_id = 本人`，查询自身也被审计；审计页在管理/教师面板「系统设置」组
- 班级邀请码：仅在 `/activate` 学生激活时要求填写，用于核验学号所属班级
- 文件上传：`/api/upload` 处理上传 -> `uploads/` 目录 -> `/api/uploads/[...path]` 静态服务
- 数据导出：ExcelJS (Excel) + JSZip (ZIP 打包)
- 词云渲染：`WordCloudCanvas` + `WordCloudClient` 客户端组件
- 管理面板：Tab 式布局（DashboardTab、StudentsTab、ExportTab、OverviewTab、SettingsTab、TagsTab）

## 8. Development Environment Notes

- **禁止 `npm run dev`**：用户自己手动运行，避免端口冲突或重复启动
- **PowerShell GBK 编码陷阱**：
  - `gh` CLI 输出中文时，PowerShell 管道会按 GBK 解码 UTF-8 导致乱码
  - 读取：用 `Start-Process gh -RedirectStandardOutput file` 落盘原始字节，再用 Read 工具读文件
  - 写入：用 Write 工具写 UTF-8 文件，再用 `gh issue edit --body-file`；**绝不用 `Write-Output` 写临时文件**（PowerShell 默认 UTF-16 LE，与 Write 工具混用同一路径会导致混合编码乱码）
- **`.env` 中 bcrypt hash 需单引号包裹**：hash 含 `$` 字符，PowerShell 双引号内会变量插值
- **GitHub MCP token 只读**：写操作（创建 Issue/PR 等）需改用 `gh` CLI（此MCP仅在部分工具配置）
