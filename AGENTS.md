<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

> `CLAUDE.md` 内容仅为 `@AGENTS.md`（引用入口），AGENTS.md 是 AI Agent 指南的唯一主文件。
> **本文件只写不变量与决策依据，不写文件级清单**：需要具体文件/路由/表名时现读代码（见 §9）。

## 1. Project Overview

- 项目名称：Career Explorer（学生职业探索工具），v2.0.0 已于 2026-09-03 发布
- 三角色统一用户体系：admin / teacher / student，单一 `users` 表 + 班级邀请码激活
- 技术栈：Next.js 16 App Router（**不是 15，API 有破坏性变更**）+ React 19 + TypeScript strict + Tailwind CSS v4
- 数据库：MySQL (mysql2) / SQLite (better-sqlite3) 双适配器，同一 `DbAdapter` 接口
- 影响写码的关键依赖：jose（JWT HS256）、bcrypt、sharp（仅服务端）、exceljs + jszip、@aws-sdk/client-s3、lucide-react（图标唯一来源）、recharts（数据大屏图表）、sonner（toast 通知）、vitest
- 开发环境：Node.js 24（engines `>=24`，`.nvmrc` 与 CI 同为 24）、npm

## 2. Directory Structure

<!-- 对账：只到目录级；文件级清单一律现读（见下方命令），不要写进文档 -->

| 目录 | 职责 |
|---|---|
| `src/app/` | App Router 页面 + API 路由 |
| `src/app/dashboard/{admin,teacher,student}/` | 三角色面板，导航分组见 `docs/architecture.md`「面板导航结构」 |
| `src/app/api/{auth,setup}/` | 认证与安装端点，天然在 proxy matcher 之外 |
| `src/app/api/manage/` | 管理域 API，admin + teacher 共用，角色差异由 `proxy.ts` 声明式权限表控制 |
| `src/app/api/shared/` | 共享域 API，不进 proxy，**路由自鉴权**（档案、提交历史、存储签名、本组名单） |
| `src/app/api/{tags,upload,uploads}/` | 开放端点：标签与配置读取、上传、本地文件静态服务（含路径穿越防护） |
| `src/components/` | 全站公共组件；子目录 `admin/`（面板 Tab 页命名 `*Tab.tsx`，同目录另有共用 UI 组件如 `AdminUI` / `ConfirmDialog` / `*Table`）、`dashboard/`（管理/教师侧边栏）、`student/`（学生侧边栏） |
| `src/hooks/` | 客户端自定义 hook，命名一律 `use*.ts` |
| `src/lib/` | 服务端数据层与工具，按前缀分组（`db*` / `storage*` / `media-*` / `thumbnail*` / `profile-*` / `assessment-*` / `onet*` / `tag*` 等，分组表见 `docs/overview.md`） |
| `scripts/` | 离线数据导入脚本（`import-onet.mjs` 生成 O\*NET 职业库快照，#226），不进运行时 |
| `src/proxy.ts` | 角色权限中间件（替代已删除的 `middleware.ts`），内置 `TEACHER_ALLOWED` 声明式权限表 |
| `src/types/`、`src/__tests__/` | 类型定义；Vitest 测试按被测对象命名——lib / hook 用 `<模块名>.test.ts`，API 路由与跨模块行为用 `<资源>-api.test.ts` / `<行为>.test.ts`（如 `profile-api`、`submission-deadline`）；改代码必须同步改对应测试 |
| `uploads/`、`data/` | 本地存储后端的上传文件（含 `*_thumb.jpg` 缩略图）、SQLite 库文件，均 gitignored |

现读命令（需要真值时直接执行，不要凭记忆）：

```bash
ls src/lib/ && ls src/components/admin/ && ls src/hooks/
find src/app -name page.tsx && find src/app/api -name route.ts
```

## 3. Database Conventions

- 抽象层：`src/lib/db.ts` 定义 `DbAdapter` 接口，**所有数据库操作必须走此接口**，两适配器（`db-mysql.ts` / `db-sqlite.ts`）行为须一致
- 配置来源：`db-config.json`（运行时文件，gitignored），经 `db-config.ts` 读写；`DbConfig` 含 `type: "mysql" | "sqlite"`、`installed` 标志、连接参数
- **十七张表**（权威定义在两适配器的 `CREATE TABLE`，完整字段与备份口径见 `docs/architecture.md`「数据库」）：

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
| `class_groups` / `class_group_members` | **当前**分组（#101）：组与成员，成员表 `user_id` 全局唯一（一人同时只属于一个组，转班/删人必须清理） |
| `group_batches` / `group_batch_groups` / `group_batch_members` | 分组历史批次（#101）：每次自动分组追加一份不可变归档（策略、特征源、指标、组内聚度、成员姓名学号快照） |
| `assessments` / `assessment_questions` / `assessment_results` | 职业测评（#221）：量表定义（维度 JSON、计分类型、量表版本、署名与授权文本）、题库（题号 + 题干 + 维度 + 反向计分 + 题面版本）、作答与结果快照（`in_progress` 草稿 / `completed` 完成 + 三字码 + `is_current`）；题库进库、种子在 `assessment-data.ts` |
| `onet_occupations` | O*NET 职业库（#226）：`code` + 英文名 + 中文译名 + 官方兴趣高码 + 六型分 JSON + Job Zone + 学历 + SOC 职业群；**只读参考数据、不纳入备份**，快照 `onet-data.ts` 按版本整表重灌 |

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
- 例外：分组（`/api/manage/groups*`）前缀整体放行，**班级归属在路由内判定**——读不限（教师可看全校分组），写限自建班（`canModifyClass`），被拒的写同样落审计
- 例外：学生写入（`/api/manage/students*`）前缀整体放行，**归属由路由内 `WriteGuard` 判定**（#171）——学生以其 `class_id` 在教师关联班级内为准，未分班学生只有管理员可写，批量操作任一行越界即整批拒绝；读不限（教师可看全校名单）
- 例外：档案清除（`/api/manage/profiles` DELETE）沿用同一 `WriteGuard`（#243）——教师只能清除本人管辖班级学生的档案，未分班 / 他班 / 不在册 id 整批 403 且不落任何写入；成功与被拒均记审计 `profile:clear`，读列表仍不限班级
- 边界：全站生效的配置写入只归管理员（#171）——预设标签（`/api/manage/tags*`）与 `profile-config` 对教师收敛为仅 GET，教师面板相应 Tab 以 `readOnly` 呈现
- 路由设计原则：API 面向资源组织 + 业务域前缀（manage/shared），角色差异收敛于 proxy 权限表，**权限演化不搬路径**（否决过按角色拆分路由的设计）
- 激活（#93 两步单页）：`POST /api/auth/activate/verify` 核验学号 + 姓名 + 本班邀请码三要素并取回名单姓名 → `POST /api/auth/activate` 设置密码并自动登录；账户须先由教师导入名单预建（无密码）
- 错误信息不泄露账号存在性：用户不存在与密码错误共用「编号或密码错误」；无 `password_hash` 账户提示「该账户尚未设置密码，请联系管理员」
- 已登录访问 `/login`、`/activate` 自动重定向到对应角色面板
- URL 安全：`sanitize.ts` 防 `javascript:` 协议 XSS；`/api/uploads/[...path]` 已加固路径穿越；上传显式拒绝 SVG（防存储型 XSS）；云对象一律经 `/api/shared/storage-sign` 签发 30 分钟限时 URL（签名前按角色 + 班级归属校验；#101 起学生额外可签**同组同学的头像**，存量词云图片与其他文件不放行，同组判定为单条查询）
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
- 档案提交入口（#168 / #208 / #162）：分步向导与本地草稿已删除，提交与修改统一在学生面板内联完成；**标签与三条他人评价必填、头像选填**（评价为三条匿名自由文字，每条 1–300 字；客户端与服务端同口径，空标签或未填满三条 400）；仅历史图片账户在编辑时三条留空可保留旧图，部分填写仍拒绝；未提交学生在引导卡点「开始填写」直接进入编辑态；旧的 `/form` 占位页已删除（#318），旧链接由 `next.config.ts` 的 `redirects()` 永久重定向回首页（`permanent: true` → 308），**不要再新增任何站内入口指向 `/form`**
- 标签体系（#94）：标签名称文本直存；预设标签支持物理删除、批量导入/删除、恢复默认（均二次确认）；自定义上限存 `configs_profile`，学生面板经开放端点 `/api/tags` 读取
- 提交时限（#96）：`submission_deadline` 超时后 `POST /api/shared/profile` 强制 403，学生面板入口禁用；截止状态由服务端按 Asia/Shanghai 计算后下发
- 提交历史（#95）：每次保存生成新版本，学生可查看/恢复（恢复生成新版本，**不回写旧记录**）；超上限时删最旧版本，管理端可查超限学生并手动清理
- 操作审计（#110）：`audit.ts` 提供 `recordAudit`（**失败静默降级，绝不阻断业务**）/ `getAuditActor`（操作者快照）/ `sanitizeMetadata`（敏感键剔除 + 截断 2000 字符）；管理域写操作、认证事件（含登录失败）、档案提交、导出/备份等触点成败均记；查询端点只读，教师强制限本人记录且查询自身也被审计
- 对象存储（#111）：一切文件读写走 `StorageAdapter`（本地 / S3 兼容双实现），归属后端由记录的 `storage_id` 决定，**切换默认后端不影响存量文件**；前端取访问地址一律经 `useFileUrl` / `StorageImage`，不要自己拼 URL（细节见 `docs/architecture.md`「文件存储」）；#162 起评价不产生文件，评价上传前缀与历史词云图片仅存量兼容
- 媒体治理（#117/#118）：孤儿**不做自动删除**（保留期可配 + 人工确认清理，服务端重扫自证不信任前端）；缩略图生成仅服务端（依赖 sharp），key 派生 `{base}.jpg` → `{base}_thumb.jpg`；#162 起评价缩略图只服务历史图片
- 他人评价与词云（#162）：三条匿名他人评价存 `evaluation_text`（JSON 数组）与版本快照，`evaluation_url` 仅历史图片；服务端用 `Intl.Segmenter` 提词、按提及人数（1–3）计权，前端 `EvaluationWordCloud` 确定性布局实时绘制，**不生成新图片、不占上传带宽**；文字优先、旧图兜底，列表只显示摘要
- 课堂分组（#101）：算法是纯函数（`grouping-utils.ts` / `grouping-features.ts`），只认「特征源注册表」，不直接读 `users.tags`——新增数据源只加一条注册项；结果确定性（无随机，按学号升序）；**当前分组与历史批次两套表物理分离**，触发自动分组=覆盖当前 + 追加归档同一事务（口径见 `docs/architecture.md`「课堂分组」）
- 职业测评（#221）：三表 = 量表定义 / 题库 / 作答结果快照；**量表进库不写死代码**，种子在「`code` 缺失或题库为空」时补种、非空题库不覆盖；题库为 **120 题 RIASEC**（#281：Mini-IP 30 一字不改 + SF 30 中译 + 原创 60，`origin` 列区分来源），已有旧库由 `upgradeAssessmentBank()` **只增不改**升级（缺题 INSERT、已存在题号只回填 `origin`、定义字段仅随 `scale_version` 整体更新、同版本库的 `license_text` 与种子不一致时单独刷新（#284），单事务幂等）；`validateAssessmentSeed` 还拦每维题数/`origin` 分布/题干唯一与长度/禁词/原创题 anchor（须命中 O*NET 快照且维度在兴趣高码前两位）/近重复组覆盖；草稿与完成记录同表，可空 `draft_slot` + 唯一约束保证「一人一量表至多一条草稿」，完成时释放草稿位并保证 `is_current` 唯一（MySQL 用 `FOR UPDATE` 锁学生行串行化）；两库一致性另有三条硬约束：列名逐列相同、外键成对存在、`code` 用 `utf8mb4_bin` 保证大小写敏感的唯一语义；计分由计分引擎（#220）在落库前算好，数据层不重复实现算法（口径见 `docs/architecture.md`「职业测评数据层」）
- 题库放行门（#284）：`SAMPLING_EXCLUDED_ORIGINS`（`assessment-data.ts`）把未通过专家评审与班级试测的来源整批排除在抽题池外，当前排 `cn-original`——**题库不删题**（仍 120 题，历史快照与种子校验不受影响），线上只抽 60 道 O*NET 官方题（每维 10 道、每轮 5 道），`items_per_attempt = 0` 也只含官方题。排除来源计入 `poolFingerprint`（放行门一变旧快照自动重派）；在途草稿保留官方题作答、丢弃原创题作答并由官方题补齐。重测换卷时 C / E 两维因近重复组挤占会放宽排除集出现个别重题（其余四维完全换新），属预期行为。恢复放行 = 补齐评审与试测记录、更新 `license_text`、从常量移除来源；记录与复核日期见 `docs/assessment-validation.md`
- 职业测评中心（#222 / #225 / #291）：学生侧边栏固定五项「我的档案 / 我的小组（#101） / 职业测评 / 我的班级（占位）/ 成长记录（占位）」，条目定义与判定规则在 `src/lib/student-nav.ts`；「我的档案」「我的小组」是页内视图（高亮由 `StudentSidebar` 的 `activeView` 控制，历史提交作为「我的档案」子视图仍高亮「我的档案」），「职业测评」按路径前缀高亮（覆盖答题页），占位项不可点；在测评中心等未传 `onSelect` 的页面，页内视图项自动退化为 `Link` 回 `/dashboard/student`，不留死按钮。测评中心页 `/dashboard/student/assessment` **只承载入口、状态与说明**，数据来自 `GET /api/shared/assessment/list`（#291，只含启用量表、逐套带本人状态与进度），三态判定仍在 `src/lib/assessment-center.ts` 的纯函数里（优先级：进行中 > 已完成 > 未开始，重测草稿优先），多量表选择与清单行归一在 `src/lib/assessment-list.ts`（「我的测评」卡 = `deriveLatestActive`：草稿按 `updatedAt` 最新 → 最近完成 → 主测评兜底；清单每行都有带 `?code=` 的作答入口，`isPrimary` 已退役），结果解读留给「我的档案」测评区（#224）；量表停用（`enabled=false`）不出现在列表中、历史结果仍可在档案查看。内容卡：我的测评、测验清单、六型科普、大五科普（#291，随 IPIP 量表启用，含高低分表现与和霍兰德的呼应）、学职平台 + IPIP 外链（**只外链不复刻题目**，统一 `rel="noopener noreferrer"`，IPIP 标明公有领域）、页底「授权与免责」（O\*NET 署名取 `assessments` 表字段、不复制到前端；免责声明组件与结果区共用）；科普文案在 `src/lib/assessment-center-content.ts`，**不出现 SDS/Strong/MBTI 等商业量表名称**，六型科普、外链与授权卡在接口失败时也常驻（清单与大五科普随列表结果渲染）
- 职业测评作答（#223）：答题页 `/dashboard/student/assessment/quiz` 单题单屏 + Likert 1-5，**进度以服务端草稿为唯一真相**（每题 `POST /answer` 合并式 upsert，不用 localStorage），`resumeIndex` 续答；提交要求完整（缺答 400 回带 `missingIndexes`），作答内容只认服务端草稿、不接受客户端答案或 userId；结果按快照落库、重复提交生成新版本；审计 `assessment:answer`（只记进度不记选项）/ `assessment:submit` / `assessment:results`，停用量表拒绝新作答但历史结果仍可读（口径见 `docs/architecture.md`「职业测评作答流程」）
- 职业推荐（#226）：O\*NET **30.2** 快照离线导入 `onet_occupations`（**30.3 起兴趣表只是从 `Interests.txt` 改名为 `Career Interest Types.txt`、列结构与数值不变**，脚本两种文件名都认，本轮先锁 30.2）；数据快照由 `scripts/import-onet.mjs` 生成、中文译名单独维护（重新生成不覆盖），脚本会校验必需列与职业数、列名变化时拒绝生成；匹配是纯函数（六维各自归一化后算余弦，同分按 code 破平 → 可复现），画像优先用结果快照六维分、只有三字码时按 3/2/1 权重兜底；Job Zone 现行为 2–5（原 1–2 级已合并）；接口 `/api/shared/assessment/careers` 只认会话 uid，响应必须带 CC BY 4.0 署名（口径见 `docs/architecture.md`「职业库与推荐匹配」）
- 测评结果展示（#224 + #344）：「我的档案」hero 之下常驻测评结果卡（三字码徽章 + 六型雷达图 + 条状排名 + 逐条解读 + 推荐职业），**只在「我的档案」视图、非编辑态渲染**（#344：判定为 `assessment-view.ts` 的纯函数 `shouldRenderAssessmentResults`；速览四卡、结果卡与页尾授权同范围，「我的小组」「历史提交」与编辑态不挂载、不残留合规卡）；**自己读 `/results`、与档案提交流程完全解耦**——不受 `submissionClosed` 门控、不进档案版本快照、不显示归档状态；推荐职业是渐进增强（接口失败/为空整块静默不渲染）；视图模型纯函数在 `assessment-view.ts`（仓库无 DOM 测试环境，界面逻辑先落纯函数再测）（口径见 `docs/architecture.md`「职业测评结果展示」）
- 档案速览（#323）：hero 与折叠详情之间常驻**速览四卡**（兴趣三字码 + 人格 headline + 推荐职业 Top3 + 资料完成度，桌面 2×2），同样只在「我的档案」视图、非编辑态渲染（#344）；点「查看详情」受控展开对应折叠卡并滚动 + 短暂高亮（`aria-controls` 指向 `assessment-card-<code>` / `profile-info` / `assessment-results`）；**数据只拉一次**——拉取序列收在 `assessment-results-loader.ts`、由页面 `useAssessmentResults()` 挂一次并喂给速览与详情，摘要分数/排序**复用 `assessment-view.ts` 的 builders**（不写第二套算法）；资料完成度与 hero 环、资料卡共用 `profile-completion.ts`（#162：三条文字评价或存量图片）；单套失败只降级该卡、清单失败降级整区指针、推荐失败与为空给不同文案（口径见 `docs/architecture.md`「职业测评结果展示」）
- 教师端测评统计（#229）：两个端点分工是安全边界——`/api/manage/stats/assessment` **纯聚合**（班级完成度/六型计数/三字码 Top-10/总数，响应无个人标识，可投屏），`/api/manage/assessment/roster` 是唯一**专用的**「测评结果 + 姓名学号」下钻端点（档案数据列表 GET 也带测评字段，但走档案列表既有权限，见 #234），教师**恒收窄到本人归属班级**（越权 `classId` 直接 403）且每次读取（含被拒）都记审计 `assessment:roster`；归型依据是结果快照三字码首位（不重算分数，与学生端必然一致），分母是在册学生且完成率钳到 100%；适配器只出原始计数，完成率/排序/标签统一在 `assessment-stats.ts` 纯函数里（口径见 `docs/architecture.md`「教师端测评统计」）
- 数据概览（#230）：**概览只回答「有没有做」，图表一律归数据大屏**——概览 = 四张统计卡（第四张「测评完成」，复用 `purple` 色档）+ 班级概览表（追加「测评完成 / 交齐比例」两列，全表百分比取整）；测评数据复用 #229 聚合接口，接口不可用/无数据时卡片显示 0 + 「学生还没开始测评」、表格显示 `-`，**不出现报错态**；「去数据大屏」引导只在教师端（`mode="teacher"`），管理员概览不受影响（口径见 `docs/architecture.md`「面板导航结构」，视图模型在 `src/lib/assessment-overview.ts`）
- 测评看板（#314 / #315，取代 #232 的卡内三视图）：教师端数据大屏 = 页头（范围默认「我带的班」/「所有班级」+ 「怎么看这份数据」+ 刷新）→ **唯一深绿 hero**（档案完成度 + 班级点阵 + 各启用量表进度行）→ 班级完成矩阵（真 `<table>`：班级 | 档案提交 | 各启用量表 | 兴趣构成 | 操作）→ 两张**结构卡**（7/5 并排）→ 行动条 → 词云分布卡保持现状；hero 内**不放控件**，全页只一张深绿面。点阵规格固定（每格 1 人、`1px solid rgb(79,119,66)`、两行、按班分组、`clamp(12,60,ceil(total/2))`、`>200` 退化比例轨），**每格不得携带学生身份**（只有布尔位 + 整块一条 `aria-label`）；「看未完成」走 `roster?status=missing`，提醒话术是 `buildReminderText` 纯函数（不含姓名）。结构卡（#315）：兴趣 = 六型首位计数环图（固定 160×160）+ 恒六行图例 + Top-6 三字码胶囊（带中文展开；可下钻时点开名册走 `roster?code=`，名册 `code` 只随兴趣量表 Tab 发送）；人格 = N/E/O/A/C 恒按量表顺序、低/中/高三段**单一靛蓝族**堆叠条 + 三档人数 + `invalidCount`，无平均分/排名/原始分/分档下钻，`enabled:false` 或 `dimensions` 为空显示未开放，0 人已测显示空态；两卡共用一个「看的班级」选择——只列可下钻的班（教师看「所有班级」时只剩全部班级，避免别班 403），兴趣按 `byClass` 前端过滤不重发请求、人格按 `classId` 重取；空态按当前所选班级判，不按全部合计。说明抽屉三 Tab（兴趣六型/人格五项/怎么用）复用学生端 `RIASEC_INTRO`/`BIG_FIVE_INTRO`，教师增量文案在 `teacher-board-content.ts`，必须含 **E/A/C 同名不同义警告**与三档阈值说明，**不出现商业量表名与诊断式表述**。纯函数在 `teacher-board.ts`（`buildProgressGrid` / `pickActionTarget` / `buildReminderText` / `buildInterestCompositionBar` / `normalizeInterestStats` / `buildInterestStructure` / `normalizeBigFiveStats` / `buildBigFiveTeacherRows` / `resolveInterestStructureState` / `resolveBigFiveStructureState`），三档色值在 `assessment-colors.ts`（对比度单测），文案在 `TEACHER_BOARD_COPY`（禁词与教师侧一致、组件源码零中文字面量）；矩阵列由 `/stats/completion` 的 `columns` 驱动、切「所有班级」时行 `canDrilldown=false` 禁用下钻；管理端 `SubmissionHero` / `computeRosterBits` 零改动（口径见 `docs/architecture.md`「数据大屏 · 测评看板」）
- 教师端数据列表测评列（#234 / #330）：数据列表自 #330 起是**双列**「兴趣测评 + 人格特质」（9→10 列，空态 `colSpan` 同步）：兴趣列三字码徽章、人格列五大人格 Top2 画像（`IPIP` 小标、hover 完成时间），未测都是灰胶囊、两列都不排序；`/api/manage/profiles` 下发 `assessmentScales`（启用中的量表清单，列定义/维度标签唯一来源）+ 每行 `assessmentResults[code]`（只带 `{key, standard}` 轻量分），按当页学号**逐量表各批查一次**（与 #233 导出共用 `getCurrentAssessmentResultsByUserCodes`），只认 `completed + is_current`；某套量表失败只让该列降级为未测、旧字段 `assessmentCode/Status/At/Scores` 过渡期保留。**测评筛选互斥**：前端 `AssessmentFilter` 联合类型（none/interest/personality）+ 服务端同时收到两组参数 400，兴趣 = 六型字母多选 AND（≤3，`interest=S,A,I`）或未测，人格 = 已测/未测/单维度偏高偏低（`personality=C:high`，阈值 50），维度下标由路由按 `dimensions_json` 解析（客户端不传下标）；筛选与搜索、标签、排序全部下推服务端（#295 口径：分页在过滤后、`total` 为命中数、跨页可筛；SQL 由 `profile-query.ts` 的 `buildSubmittedProfilesSql` 两适配器共用，人格取分用 `json_extract`/`JSON_EXTRACT` 且**同时校验 key**，阈值必须是数值参数）；全选按「当页可见行是否全选」判定；**六型配色单一来源** `assessment-colors.ts`（`C` 用深色文字，单测锁对比度）；详情弹窗只加六型横条（复用 `buildRiasecBars`）与重测指引，未测整块不渲染、快照缺失不画六条 0，人格详情留给后续 issue（口径见 `docs/architecture.md`「教师端数据列表测评列」）
- 上传与导出：上传走服务端压缩 + 可配置大小上限 + 唯一命名不覆盖；导出用 ExcelJS（XLSX 默认原生单元格图片，可切浮动图片）+ JSZip 打包图片
- 数据导出自定义列（#233 / #162 / #331）：列定义与格式化是纯函数（`export-columns.ts`，含列顺序、CSV/Excel 表头差异、六型分合成/拆列、大五画像/得分、图片锚点列字母），路由与界面只消费它；默认列集合以 #233 为基线，#162 因替换评价维度追加他人评价1–3（历史图片列保留）；其余新列一律增量勾选；#331 的 `personality_traits` / `big_five_scores` 追加在末尾，既有列顺序与图片锚点不变；列表「导出名单」固定导出当前筛选结果（含所有页），`q/tag/interest/personality` 与列表共用 `profile-query.ts` 口径、按同一 SQL 全量取行，无筛选时保持原行为；列顺序以定义为准（与勾选顺序无关），xlsx 图片锚点按最终列下标算；评价文字在 CSV 单行化并防公式注入、在 XLSX 自动换行；测评列来自结果快照的当前有效版本（按学号一次批查，未测评整格留空），推荐职业列依赖职业库、未就绪时按钮置灰不隐藏（`?capabilities=1` 探测）（口径见 `docs/architecture.md`「数据导出」）
- 面板结构：Tab 式布局，管理/教师面板的 Tab 页命名 `*Tab.tsx`（同目录共用 UI 组件不套用该后缀）；词云为客户端确定性布局组件 `EvaluationWordCloud`

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
| 页面/API 路由表、数据库十七表、教师权限表、面板导航分组、课堂分组口径 | `docs/architecture.md` |
| 分支模型、提交/PR/发布规范、环境变量表 | `docs/standards.md` |
| 色彩 token、组件与交互规范、z-index 层级 | `docs/ui-conventions.md` |
| Issue 标题/标签/正文/验收标准 | `docs/issue-standard.md` |
| 量表信效度验证方案、判定阈值、常模实施预案（#227） | `docs/assessment-validation-plan.md`（阈值常量在 `src/lib/assessment-validation.ts`，改一处必须同步另一处） |
| 120 题库放行判据、专家评审/试测记录、回退结论与复核日期（#284） | `docs/assessment-validation.md` |
| 部署步骤、运行环境要求、运维排障 | `DEPLOY.md` |
| 对外门面与快速上手 | `README.md` |
| 变更历史 | `CHANGELOG.md` |
| 历史归档（只读，不据此判断现状） | `REFACTOR-PLAN.md`、`docs/plan-v2.0.0.md`、`docs/plan-v2.0.0-uiux.md` |

写文档的判定标准（四测全过才写进文档）：① 半年内变动 ≤2 次 ② 无 ≤10 秒只读命令可得真值 ③ 缺失会导致错误设计 ④ 全仓仅此一处。文件级清单（lib / hooks / components / tests 的文件名）一律不写，改为分组约定 + 现读命令。
