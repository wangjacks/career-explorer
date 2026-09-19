<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

> `CLAUDE.md` 内容仅为 `@AGENTS.md`（引用入口），AGENTS.md 是 AI Agent 指南的唯一主文件。
> **本文件只写不变量与决策依据，不写文件级清单**：需要具体文件/路由/表名时现读代码（见 §9）。

## 1. Project Overview

- 项目名称：Career Explorer（学生职业探索工具），v2.0.0 已于 2026-09-03 发布
- 三角色统一用户体系：admin / teacher / student，单一 `users` 表 + 班级邀请码激活
- 技术栈：Next.js 16 App Router（**不是 15，API 有破坏性变更**）+ React 19 + TypeScript strict + Tailwind CSS v4
- 数据库：MySQL (mysql2) / SQLite (better-sqlite3) 双适配器，同一 `DbAdapter` 接口
- 影响写码的关键依赖：jose（JWT HS256）、bcrypt、sharp（仅服务端）、exceljs + jszip、@aws-sdk/client-s3、lucide-react（图标唯一来源）、vitest
- 开发环境：Node.js 24（engines `>=24`，`.nvmrc` 与 CI 同为 24）、npm

## 2. Directory Structure

<!-- 对账：只到目录级；文件级清单一律现读（见下方命令），不要写进文档 -->

| 目录 | 职责 |
|---|---|
| `src/app/` | App Router 页面 + API 路由 |
| `src/app/dashboard/{admin,teacher,student}/` | 三角色面板，导航分组见 `docs/architecture.md`「面板导航结构」 |
| `src/app/form/create-profile/` | 学生档案表单：单路由多步 `?step=`（登录门 → 标签 → 词云 → 评价 → 形象 → 确认 → 完成），确认页延迟上传 + 草稿暂存 |
| `src/app/api/{auth,setup}/` | 认证与安装端点，天然在 proxy matcher 之外 |
| `src/app/api/manage/` | 管理域 API，admin + teacher 共用，角色差异由 `proxy.ts` 声明式权限表控制 |
| `src/app/api/shared/` | 共享域 API，不进 proxy，**路由自鉴权**（档案、提交历史、存储签名） |
| `src/app/api/{tags,upload,uploads}/` | 开放端点：标签与配置读取、上传、本地文件静态服务（含路径穿越防护） |
| `src/components/` | 全站公共组件；子目录 `admin/`（面板 Tab，命名一律 `*Tab.tsx`）、`dashboard/`（管理/教师侧边栏）、`student/`（学生侧边栏） |
| `src/hooks/` | 客户端自定义 hook，命名一律 `use*.ts` |
| `src/lib/` | 服务端数据层与工具，按前缀分组（`db*` / `storage*` / `media-scan`+`thumbnail*` / `profile-*` / `audit` 等，分组表见 `docs/overview.md`） |
| `src/proxy.ts` | 角色权限中间件（替代已删除的 `middleware.ts`），内置 `TEACHER_ALLOWED` 声明式权限表 |
| `src/types/`、`src/__tests__/` | 类型定义；Vitest 测试，文件名与被测模块同名（改模块必须同步改同名测试） |
| `uploads/`、`data/` | 本地存储后端的上传文件（含 `*_thumb.jpg` 缩略图）、SQLite 库文件，均 gitignored |

现读命令（需要真值时直接执行，不要凭记忆）：

```bash
ls src/lib/ && ls src/components/admin/ && ls src/hooks/
find src/app -name page.tsx && find src/app/api -name route.ts
```

## 3. Database Conventions

- 抽象层：`src/lib/db.ts` 定义 `DbAdapter` 接口，**所有数据库操作必须走此接口**，两适配器（`db-mysql.ts` / `db-sqlite.ts`）行为须一致
- 配置来源：`db-config.json`（运行时文件，gitignored），经 `db-config.ts` 读写；`DbConfig` 含 `type: "mysql" | "sqlite"`、`installed` 标志、连接参数
- **八张表**（权威定义在两适配器的 `CREATE TABLE`，完整字段与备份口径见 `docs/architecture.md`「数据库」）：

| 表 | 一句话职责 |
|---|---|
| `users` | 三角色统一用户表，`user_code` 兼登录标识（学生 12 位 / 教师 8 位 / 管理员 5 位，管理员从 10001 起），`password_hash` 可为 NULL |
| `classes` | 班级，`invitation_code` 唯一 |
| `teacher_classes` | 教师-班级多对多 |
| `tags` | 预设二级标签（`type` + `parent_id`），#94 起仅为表单预设项，物理删除、`active` 列保留不操作 |
| `configs_profile` | 档案功能配置键值表（自定义标签上限、提交截止、上传大小上限、历史版本上限、孤儿保留期） |
| `audit_logs` | 操作审计（#110），只追加 + 查询，操作者快照冗余 |
| `storage_backends` | 存储后端注册表（#111），凭据不入库 |
| `profile_submissions` | 档案提交历史版本（#95），`version` + 快照字段 + `is_current` |

- 学生 `tags` 为**标签名称文本数组**（#94 起，预设 + 自定义直存，与 `tags` 表解耦）
- 初始化流程：手动访问 `/setup` 配置数据库 + 管理员密码 → 写入 `db-config.json` 与 `users`；安装状态经 `isInstalled()` + `/api/setup/status`
- **日期时间字段统一用 TEXT 存储**（`datetime('now', 'localtime')`）

## 4. Coding Conventions

- TypeScript strict 模式（`"strict": true`）；路径别名 `@/*` -> `./src/*`
- 组件使用默认导出，工具函数使用具名导出
- 客户端组件加 `"use client"` 指令；API 路由使用 `NextRequest` / `NextResponse`
- 中文 UI，注释可不写或写英文
- 禁止空 `catch {}`，至少加 `console.error` 或用户错误提示
- 测试框架：vitest（`npm run test`）
- 完整开发标准（分支模型、PR 规范、发布流程、环境变量表）见 `docs/standards.md`

## 5. Security & Authentication

- **三角色认证**：`/api/auth` POST 验证 `user_code` + 密码（bcrypt）→ 签发 JWT（jose HS256, 24h, 含 role/uid/name）→ HttpOnly Cookie（`auth_token`, secure, sameSite=lax）
- 会话检测：`GET /api/auth` 返回 `{ ok, role, uid, name }`（httpOnly cookie 前端不可读，必须经 API 检测）；登出 `DELETE /api/auth`
- 中间件：`proxy.ts` matcher 仅 `/dashboard/admin/:path*` 与 `/api/manage/:path*`；teacher/student 面板不经 proxy，由路由自鉴权
- 权限模型：`/api/manage/*` admin 全放行；teacher 按 `TEACHER_ALLOWED`（前缀 + 方法，**改代码必须同步改 `docs/architecture.md` 权限表**）；`/api/shared/*` 路由自鉴权；其余 `/api/*` 不拦截
- 路由设计原则：API 面向资源组织 + 业务域前缀（manage/shared），角色差异收敛于 proxy 权限表，**权限演化不搬路径**（否决过按角色拆分路由的设计）
- 激活（#93 两步单页）：`POST /api/auth/activate/verify` 核验学号 + 姓名 + 本班邀请码三要素并取回名单姓名 → `POST /api/auth/activate` 设置密码并自动登录；账户须先由教师导入名单预建（无密码）
- 错误信息不泄露账号存在性：用户不存在与密码错误共用「编号或密码错误」；无 `password_hash` 账户提示「该账户尚未设置密码，请联系管理员」
- 已登录访问 `/login`、`/activate` 自动重定向到对应角色面板
- URL 安全：`sanitize.ts` 防 `javascript:` 协议 XSS；`/api/uploads/[...path]` 已加固路径穿越；上传显式拒绝 SVG（防存储型 XSS）；云对象一律经 `/api/shared/storage-sign` 签发 30 分钟限时 URL（签名前按角色 + 班级归属校验）
- 环境变量：清单以 `docs/standards.md` §11 为唯一权威（模板 `.env.example`，两处须同步）；`JWT_SECRET` 未配置会回退到代码内置的不安全默认值
- 管理员密码：安装引导中配置，bcrypt 哈希存于 `users`（`user_code=10001`）；无自助改密端点，重置方式见 `DEPLOY.md`

## 6. Git Workflow & Commit Conventions

- 分支模型：`main`（稳定发布）+ `dev`（日常开发）+ `release/vX.Y.Z` + `hotfix/xxx`；日常 PR 目标 `dev`，`main` 只接受 release / hotfix PR
- Commit 格式：`<type>: <English description>`（feat/fix/refactor/chore/docs/test），描述必须纯英文
- **commit 必须在 GitHub 显示 Verified**：本地 GPG/SSH 签名（公钥已上传 GitHub），或 GitHub 网页端操作（自动签名）均可；本地签名失败则停止告知用户
- **所有 tag 必须签名**（annotated tag：`git tag -s -a`），确保在 GitHub 显示 Verified
- 合并方式一律 **Create a merge commit**：不用 squash（保留步骤历史），不用 rebase（避免签名失效）
- 发布流程：从 `dev` 切 `release/vX.Y.Z` → `npm version X.Y.Z --no-git-tag-version` → 更新 `CHANGELOG.md` → `chore: release vX.Y.Z` → 打签名 tag → PR 到 `main` → 合并后立即把 `main` 回流 `dev`；功能集完成即发布，禁止积压
- Hotfix：从 `main` 拉 `hotfix/xxx` → 合 `main` → 回流 `dev`
- Pre-commit：husky + lint-staged 自动 `eslint --fix`；CI 为 GitHub Actions（lint + test + build），CodeQL 走 GitHub 默认代码扫描
- **GitHub Issue 管理**：编写规范见 `docs/issue-standard.md`；PR 关联对应 Issue，合并到 `dev` 后手动关闭

## 7. Key Design Patterns

- 安装引导：手动访问 `/setup`（InstallGuard 全局拦截已移除，**不再自动重定向**；未安装时管理面板显示「数据库未配置」提示）
- 全局用户菜单：`UserMenu` 在根布局单点挂载（`fixed top-0 right-0 z-[45]`），认证页与安装页不渲染；z-index 层级见 `docs/ui-conventions.md`
- 主题系统：`useTheme` 三态（浅色/深色/跟随系统）持久化 localStorage `theme`；`layout.tsx` 内联脚本在 hydration 前预设 `.dark` 防闪烁，`<html>` 加 `suppressHydrationWarning`；class-based dark
- 品牌色系统：`globals.css` 语义 token（`--color-brand` 深绿 / `--color-accent` 琥珀等），`.dark` 下自动提亮；标签三色（兴趣绿/技能蓝/性格琥珀）；**新代码用语义 token，不用硬编码色值**，详见 `docs/ui-conventions.md`
- 表单登录优先：档案创建必须学生本人登录（快速提交通道已于 #92 移除）；未登录显示登录门，登录页支持 `?next=` 回跳（仅站内相对路径）；已提交学生再进入被引导去面板修改
- 标签体系（#94）：标签名称文本直存；预设标签支持物理删除、批量导入/删除、恢复默认（均二次确认）；自定义上限存 `configs_profile`，表单端经开放端点 `/api/tags` 读取
- 提交时限（#96）：`submission_deadline` 超时后 `POST /api/shared/profile` 强制 403，学生面板入口禁用；截止状态由服务端按 Asia/Shanghai 计算后下发
- 提交历史（#95）：每次保存生成新版本，学生可查看/恢复（恢复生成新版本，**不回写旧记录**）；超上限时删最旧版本，管理端可查超限学生并手动清理
- 操作审计（#110）：`audit.ts` 提供 `recordAudit`（**失败静默降级，绝不阻断业务**）/ `getAuditActor`（操作者快照）/ `sanitizeMetadata`（敏感键剔除 + 截断 2000 字符）；管理域写操作、认证事件（含登录失败）、档案提交、导出/备份等触点成败均记；查询端点只读，教师强制限本人记录且查询自身也被审计
- 对象存储（#111）：一切文件读写走 `StorageAdapter`（本地 / S3 兼容双实现），归属后端由记录的 `storage_id` 决定，**切换默认后端不影响存量文件**；前端取访问地址一律经 `useFileUrl` / `StorageImage`，不要自己拼 URL（细节见 `docs/architecture.md`「文件存储」）
- 媒体治理（#117/#118）：孤儿**不做自动删除**（保留期可配 + 人工确认清理，服务端重扫自证不信任前端）；缩略图生成仅服务端（依赖 sharp），key 派生 `{base}.jpg` → `{base}_thumb.jpg`
- 上传与导出：上传走服务端压缩 + 可配置大小上限 + 唯一命名不覆盖；导出用 ExcelJS（XLSX 默认原生单元格图片，可切浮动图片）+ JSZip 打包图片
- 面板结构：Tab 式布局，管理/教师面板子组件一律命名 `*Tab.tsx`；词云为客户端 canvas 组件

## 8. Development Environment Notes

- **禁止 `npm run dev`**：用户自己手动运行，避免端口冲突或重复启动
- **PowerShell GBK 编码陷阱**：
  - `gh` CLI 输出中文时，PowerShell 管道会按 GBK 解码 UTF-8 导致乱码
  - 读取：用 `Start-Process gh -RedirectStandardOutput file` 落盘原始字节，再用 Read 工具读文件
  - 写入：用 Write 工具写 UTF-8 文件，再用 `gh issue edit --body-file`；**绝不用 `Write-Output` 写临时文件**（PowerShell 默认 UTF-16 LE，与 Write 工具混用同一路径会导致混合编码乱码）
- **`.env` 中 bcrypt hash 需单引号包裹**：hash 含 `$` 字符，PowerShell 双引号内会变量插值
- **GitHub MCP token 只读**：写操作（创建 Issue/PR 等）需改用 `gh` CLI（此 MCP 仅在部分工具配置）

## 9. Documentation Authority

一条信息一个家；改文档前先确认权威来源，其他文件只放指针，**不要复制副本**。

| 信息 | 权威文件 |
|---|---|
| 技术栈全量清单、目录模块划分、路线图 | `docs/overview.md` |
| 页面/API 路由表、数据库八表、教师权限表、面板导航分组 | `docs/architecture.md` |
| 分支模型、提交/PR/发布规范、环境变量表 | `docs/standards.md` |
| 色彩 token、组件与交互规范、z-index 层级 | `docs/ui-conventions.md` |
| Issue 标题/标签/正文/验收标准 | `docs/issue-standard.md` |
| 部署步骤、运行环境要求、运维排障 | `DEPLOY.md` |
| 对外门面与快速上手 | `README.md` |
| 变更历史 | `CHANGELOG.md` |
| 历史归档（只读，不据此判断现状） | `REFACTOR-PLAN.md`、`docs/plan-v2.0.0.md`、`docs/plan-v2.0.0-uiux.md` |

写文档的判定标准（四测全过才写进文档）：① 半年内变动 ≤2 次 ② 无 ≤10 秒只读命令可得真值 ③ 缺失会导致错误设计 ④ 全仓仅此一处。文件级清单（lib / hooks / components / tests 的文件名）一律不写，改为分组约定 + 现读命令。
