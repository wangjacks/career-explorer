# Career Explorer — 架构说明

> v2.0.0：三角色统一用户体系（admin / teacher / student）

## 认证体系

- 统一 `users` 表存储三角色账户，bcrypt 哈希密码（`password_hash` 可为 NULL = 未设置密码）
- 登录签发 JWT（jose HS256, 24h，含 role/uid/name），HttpOnly Cookie `auth_token` 传递
- `proxy.ts`（Next.js 16，替代已弃用的 middleware）拦截管理域路由做角色权限校验
- 学生账户由教师导入名单预建（无密码），学生凭学号 + 姓名 + 本班邀请码三要素核验后激活；激活为两步单页（#93）：先 `verify` 核验取回名单姓名，再 `activate` 设置密码并自动登录

| 面板 | 路由 | 访问权限 |
|---|---|---|
| 管理面板 | `/dashboard/admin` | admin |
| 教师面板 | `/dashboard/teacher` | teacher |
| 学生面板 | `/dashboard/student` | student |

## 页面路由

<!-- 对账：`find src/app -name page.tsx`（当前 9 个） -->

| 路由 | 说明 |
|---|---|
| `/` | 首页 |
| `/about` | 关于页（学生探索 / 教师管理 / 数据统计三段产品介绍） |
| `/login` | 登录页（三角色统一） |
| `/activate` | 学生账户激活（学号 + 姓名 + 邀请码三要素核验；支持 `?invite=` 二维码预填，仅预填不绕过校验） |
| `/form/create-profile?step=` | 学生档案创建表单（单路由多步：登录门 → 标签 → 词云 → 评价 → 形象 → 确认 → 完成），登录优先 |
| `/dashboard/admin` | 管理面板（分组见「面板导航结构」） |
| `/dashboard/teacher` | 教师面板（分组见「面板导航结构」） |
| `/dashboard/student` | 学生面板（我的档案通览 + 就地修改 / 历史提交 #95，两个 Tab） |
| `/setup` | 安装引导（首次配置数据库 + 管理员密码） |

## 面板导航结构

<!-- 对账：读 src/app/dashboard/{admin,teacher}/page.tsx 的 MENU_GROUPS 与 src/app/dashboard/student/page.tsx 的 Tab 定义 -->

**管理面板 `/dashboard/admin`** — 三组两级：

| 组 | 项 |
|---|---|
| 数据中心 | 数据概览 / 数据大屏 / 数据导出 / 提交历史（#95） |
| 用户管理 | 学生管理 / 教师管理 / 班级管理 / 标签管理 |
| 系统设置 | 数据源设置 / 功能设置 / 存储管理（#111） / 媒体管理（#117） / 操作审计（#110） |

**教师面板 `/dashboard/teacher`** — 四组：

| 组 | 项 |
|---|---|
| （无组标题） | 主页 |
| 数据中心 | 数据概览 / 数据大屏 / 数据导出 |
| 数据管理 | 数据列表 / 学生管理 / 班级管理 / 标签管理 |
| 系统设置 | 功能设置 / 操作审计（仅本人记录） |

**学生面板 `/dashboard/student`** — 两个 Tab：我的档案（通览 + 就地修改，二次确认）/ 历史提交（#95，懒加载，恢复生成新版本）。

## API 路由

<!-- 对账：`find src/app/api -name route.ts | wc -l`（当前 48 条 = manage 35 + auth 3 + setup 3 + shared 4 + tags/upload/uploads 各 1） -->

### 认证层（proxy 之外，公开）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/auth` | POST / GET / DELETE | 登录 / 会话检测 / 登出 |
| `/api/auth/activate/verify` | POST | 激活前置核验（#93 两步激活第一步）：校验学号 + 姓名 + 邀请码三要素，不设置密码；通过时返回名单姓名供第二步问候语展示 |
| `/api/auth/activate` | POST | 学生账户激活（#93 第二步）：三要素核验通过后设置密码并自动登录 |

### 安装层（proxy 之外）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/setup` | POST | 安装配置（数据库 + 管理员密码） |
| `/api/setup/status` | GET | 安装状态检查 |
| `/api/setup/test` | POST | 数据库连接测试 |

### 管理域 `/api/manage/*`（proxy 拦截：admin 全放行，teacher 按声明式权限表）

<!-- 对账：路由清单 `find src/app/api/manage -name route.ts`（共 35 条）；teacher 权限列须与 src/proxy.ts 的 TEACHER_ALLOWED 逐条一致 -->

**教师禁止（不在 `TEACHER_ALLOWED`，一律 403）**

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/manage/teachers` | GET / POST | 教师账户列表与新建 |
| `/api/manage/teachers/[id]` | PUT / DELETE | 教师账户改密 / 删除 |
| `/api/manage/settings` | GET / PUT | 数据源配置读写 |
| `/api/manage/backup` | GET / POST | 备份下载 / 恢复 |
| `/api/manage/test-db` | POST | 数据库连接测试 |
| `/api/manage/storage` | GET / POST / PUT / PATCH / DELETE | 存储后端管理（#111）：注册表 CRUD + 设默认，均记审计 |
| `/api/manage/storage/test` | POST | 存储后端连通性测试（#111） |
| `/api/manage/storage/migrate` | POST | 本地→云后端迁移（#111，幂等，已存在对象跳过） |
| `/api/manage/media/status` | GET / PUT | 媒体总览统计 + 孤儿保留期配置（#117，1–365 天） |
| `/api/manage/media/files` | GET | 媒体资源全量列表（#117）：类型/引用状态/学生/文件名筛选 + 分页 |
| `/api/manage/media/orphans` | GET | 孤儿文件分页明细（#117，按孤儿天数降序） |
| `/api/manage/media/orphans/cleanup` | POST | 批量删除孤儿（#117）：按清单（≤500）或 `mode:"all"`，服务端重扫自证 |
| `/api/manage/media/generate-thumbnails` | POST | 存量缩略图补生成（#118，单文件失败不中断） |
| `/api/manage/media/generate-thumbnails/status` | GET | 缩略图缺失检测（#118，只读统计） |
| `/api/manage/profiles/submissions/cleanup` | POST | 手动清理超限历史版本（#95，仅删 DB 记录、文件保留；指定 userId 或一键全量） |

> 媒体治理（`/media/*`）路由内二次校验仅 admin，教师即便前缀放行也拿不到数据。

**教师可用**

| 路由 | 方法 | teacher 权限 | 说明 |
|---|---|---|---|
| `/api/manage/classes` | GET / POST | 全方法 | 班级列表与新建 |
| `/api/manage/classes/[id]` | PATCH / DELETE | 全方法 | 班级改名 / 删除 |
| `/api/manage/classes/[id]/reset-code` | POST | 全方法 | 重置邀请码（旧码即时失效） |
| `/api/manage/classes/[id]/poster` | GET | 全方法 | 班级邀请海报 PNG（#102，`?download=1` 为附件） |
| `/api/manage/students` | GET / POST / PUT / DELETE | 全方法 | 学生名单查询 / 导入 / 修改 / 删除 |
| `/api/manage/students/batch-password` | POST | 全方法 | 批量重置学生密码（每人生成不同随机密码） |
| `/api/manage/tags` | GET / POST / PATCH / DELETE | 全方法 | 预设标签查询 / 新建 / 改名排序 / 物理删除（分类级联删子标签） |
| `/api/manage/tags/batch` | POST | 全方法 | 标签批量导入 / 批量删除 |
| `/api/manage/tags/restore` | POST | 全方法 | 恢复默认预设（#94，清空后重插，前端二次确认） |
| `/api/manage/profile-config` | GET / PUT | 全方法 | 档案功能配置：自定义标签上限（#94）、提交截止时间（#96）、上传大小上限（#111）、历史版本上限（#95） |
| `/api/manage/export` | GET / POST | 全方法 | Excel/CSV 导出（XLSX 支持原生单元格图片与浮动图片双模式，默认单元格图片） |
| `/api/manage/export-images` | GET | 全方法 | 图片打包导出（ZIP） |
| `/api/manage/stats` | GET | 仅 GET | 统计汇总 |
| `/api/manage/stats/compare` | GET | 仅 GET | 班级/维度对比 |
| `/api/manage/stats/distribution` | GET | 仅 GET | 标签分布 |
| `/api/manage/stats/trends` | GET | 仅 GET | 提交趋势 |
| `/api/manage/profiles` | GET / DELETE | GET + DELETE | 档案列表 / 清除档案字段 |
| `/api/manage/profiles/submissions` | GET | GET | 管理端查看学生提交历史（#95）：admin 全量、teacher 仅管辖班级 |
| `/api/manage/profiles/submissions/exceeding` | GET | GET | 超出版本上限的学生列表（#95） |
| `/api/manage/audit-logs` | GET | 仅 GET | 操作审计只读查询（#110；教师强制限本人记录，查询自身也被审计） |

> 前缀匹配特性：`/api/manage/export` 覆盖 `export-images`；`/api/manage/profiles` 的 GET+DELETE 覆盖 submissions 子路由的 GET，但 `submissions/cleanup` 是 POST，教师被拒。

### 共享域 `/api/shared/*`（不进 proxy，路由自鉴权）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/shared/profile` | GET / POST | GET 会话查询本人档案（含提交截止状态，#96）；POST 仅学生本人会话保存（拒绝显式指定学号；超过提交时限强制 403），每次保存生成一个历史版本 |
| `/api/shared/profile/submissions` | GET | 学生本人历史提交列表（#95，按版本倒序返回完整快照元数据） |
| `/api/shared/profile/submissions/restore` | POST | 学生恢复历史版本（#95）：截止后 403 → 校验版本归属 → 生成新版本（不回写旧记录）→ 审计 `profile:restore` |
| `/api/shared/storage-sign` | GET | 文件访问地址签发（#111）：本地后端回显代理路径；云后端按归属记录的 `storage_id` 签发 30 分钟签名 URL；权限校验：学生仅本人、教师仅管辖班级、管理员全量 |

### 其他开放端点（proxy 之外）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/tags` | GET | 预设标签 + 自定义标签上限（#94）+ 提交截止状态（#96）加载（表单流程 + 学生面板） |
| `/api/upload` | POST | 文件上传（头像 / 评价词云图；#111 起按默认后端路由 + 服务端压缩 + 大小上限 + SVG 拒绝） |
| `/api/uploads/[...path]` | GET | 静态文件服务（本地后端的代理路径，含路径穿越防护） |

## 数据库

<!-- 对账：`grep -oE "CREATE TABLE IF NOT EXISTS \`?[a-z_]+" src/lib/db-sqlite.ts src/lib/db-mysql.ts`；两适配器表集合必须一致（当前 8 张） -->

八张表，SQLite / MySQL 双适配器实现同一 `DbAdapter` 接口（`src/lib/db.ts`）。权威定义在两适配器的 `CREATE TABLE`，本表为索引：

| 表 | 用途 | 引入 | 纳入备份 |
|---|---|---|---|
| `users` | 统一用户表（三角色）：`user_code`（学生 12 位 / 教师 8 位 / 管理员 5 位，兼登录标识）、`password_hash`（NULL = 未设置）、`role`、`name`、`class_id`（仅学生）、`tags`（#94 起为标签名称文本数组）、`avatar_url`、`evaluation_url`、`submitted_at`、`storage_id`（#111 文件级路由） | v2.0.0 | ✅（含 `password_hash`） |
| `classes` | 班级：`name`、`invitation_code`（唯一） | v2.0.0 | ✅ |
| `teacher_classes` | 教师-班级多对多关联 | v2.0.0 | ✅ |
| `tags` | 预设二级标签：`type`（category/tag）、`parent_id` 层级、`class_id=0` 为全局；#94 起降级为表单预设项，物理删除（分类级联删子标签），`active` 列保留但不再操作 | v2.0.0 | ✅ |
| `configs_profile` | 档案功能配置键值表：`max_custom_tags`(#94)、`submission_deadline`(#96)、`max_avatar_size_mb` / `max_evaluation_size_mb`(#111)、`max_profile_submissions`(#95)、`media_orphan_retention_days`(#117) | #94 | ✅ |
| `audit_logs` | 操作审计（#110）：只追加 + 查询，操作者字段快照冗余，敏感键脱敏剔除、metadata 截断 2000 字符；索引 `created_at` / `actor_id` / `(resource_type, resource_id)` | #110 | ✅ |
| `storage_backends` | 存储后端注册表（#111）：内置本地后端（不可删）+ 多个 S3 兼容实例；凭据不入库（走 `.env.local`）；`name` 唯一 | #111 | ✅（不含凭据） |
| `profile_submissions` | 档案提交历史版本（#95）：`user_id` + `version` + 快照字段（`tags`/`avatar_url`/`evaluation_url`/`storage_id`/`submitted_at`）+ `is_current`；索引 `(user_id, version)`、`(user_id, is_current)` | #95 | ✅ |

备份格式 `BackupData`（**version 4**，定义在 `src/lib/db.ts`）：八表全量，其中 `audit_logs` / `configs_profile` / `storage_backends` / `profile_submissions` 为可选字段（旧备份缺失时读取方容忍 `undefined`，`storage_backends` 缺失时保留当前后端表并回填本地后端）；含 `password_hash`，不含上传文件。

## 文件存储（#111 对象存储）

- **统一抽象**：`src/lib/storage.ts` 定义 `StorageAdapter`（上传 / 读取 / 删除 / 存在性 / 访问地址签发），文件类型中立；本地实现 `storage-local.ts`（uploads/ 目录）+ S3 兼容实现 `storage-s3.ts`（`@aws-sdk/client-s3`，覆盖腾讯云 COS / 阿里云 OSS / MinIO / AWS S3）
- **多后端注册表**：`storage_backends` 表 + `users.storage_id` 文件级路由；切换默认后端只影响新上传，存量文件按归属后端照常读写；迁移端点幂等（已存在对象跳过）
- **私有读写**：云对象访问一律经 `/api/shared/storage-sign` 签发 30 分钟签名 URL（按角色 + 班级权限校验）；本地后端保持代理路径行为不变；前端经 `useFileUrl` / `StorageImage` 统一解析并缓存签名结果（28 分钟）
- **双端点**：服务端读写（上传/迁移/导出读图）优先内网端点，签名 URL 强制公网端点；对象路径 = `{bucket}/{path_prefix}/{key}`
- **上传约束**：服务端压缩（头像 ≤512×512、词云长边 ≤1024，JPEG 质量 85）、可配置大小上限（默认头像 5MB / 词云 10MB）、唯一命名不覆盖、SVG 显式拒绝（防存储型 XSS）

## 媒体资源治理（#117 孤儿检测 / #118 缩略图）

- **扫描口径**：`src/lib/media-scan.ts` 枚举全部后端的对象，与 `users`（当前档案）+ `profile_submissions`（历史快照）的引用比对，得出「被引用 / 孤儿」状态与关联学生
- **孤儿保留期**：`configs_profile.media_orphan_retention_days`（1–365 天，默认见代码），仅超期孤儿可删；**不做自动删除**，一律人工在管理面板「系统设置 → 媒体管理」确认后清理
- **清理安全链**：按清单（≤500 条）或 `mode:"all"`；服务端重新扫描自证（引用重查 + 保留期校验），不信任前端；删除源图连带 `_thumb` 缩略图，幂等静默；审计记统计与明细（key 条数受限，超出打 `truncated` 标记）
- **缩略图**：key 派生规则 `{base}.jpg` → `{base}_thumb.jpg`（仅 `.jpg` 派生，常量在 `src/lib/thumbnail-utils.ts`，生成逻辑 `src/lib/thumbnail.ts` 仅服务端）；`generate-thumbnails/status` 只读检测缺失，`generate-thumbnails` 补生成（单文件失败不中断，返回统计）
- **权限**：媒体治理不开放教师，路由内二次校验仅 admin

## 数据流

```
学生端（档案创建）：登录门 → 标签选择（预设 + 自定义，自定义受后台配置上限）→ 词云展示 → 评价词云 → 虚拟形象 → 最终确认（延迟上传）→ 提交完成；已提交学生再进入被引导去面板修改；草稿暂存支持中途刷新后继续/重新开始
学生端（登录态）：登录 → 学生面板「我的档案」通览 → 就地修改（二次确认，生成新版本）；「历史提交」Tab 查看/恢复旧版本（#95）
学生端（激活）：/activate 第一步 verify 三要素核验（#93）→ 第二步设置密码并自动登录
教师端：登录 → 主页（问候 + 统计）→ 数据中心（概览/大屏/导出）→ 数据管理（数据列表/学生/班级/标签）→ 系统设置（功能设置/操作审计）
管理端：登录 → 数据中心（概览/大屏/导出/提交历史）→ 用户管理（学生/教师/班级/标签）→ 系统设置（数据源/功能设置/存储管理/媒体管理/操作审计）
```

## 班级邀请海报（#102）

- **入口**：管理/教师面板「班级管理」列表，有权限（admin 全权 / teacher 本人创建）的班级可生成海报；`GET /api/manage/classes/[id]/poster` 返回 PNG（`?download=1` 为附件下载）
- **生成链路**：`src/lib/invite-poster.ts` 用 `qrcode` 生成二维码 SVG，拼入海报 SVG（班级名称 + 邀请说明 + 品牌配色），再由 `sharp` 栅格化为 600×800 PNG；二维码基址由 `resolvePosterBaseUrl()` 解析——生产环境必须显式配置 `NEXT_PUBLIC_APP_URL`，缺失或非法时接口返回 503 与中文原因、不产出错误域名的海报（#148），仅非生产模式回退请求 origin；成功响应的 `X-Invite-Url` 头把生效链接回给面板核对
- **安全边界**：二维码只携带 `/activate?invite=CODE`，激活页仅做表单预填，服务端 `resolveActivation` 仍强制学号 + 姓名 + 班级归属三要素一致；邀请码重置后旧码在数据库即失效，旧海报二维码无法通过校验；海报不含学生个人信息、管理员凭据等敏感数据
- **文本渲染依赖**：海报中文由服务端系统字体渲染（SVG 多字体回退栈）；Linux 部署须安装中文字体（如 `fonts-noto-cjk`），见 DEPLOY.md
- **审计**：生成海报计入操作审计（`class:poster`），邀请码本身不落审计日志（#110 凭据类数据不落库）

## 守护进程

PM2 管理。重启命令：

```bash
PORT=<端口> pm2 restart <应用名>
pm2 save
```

## 配置文件

- `db-config.json` — 数据库连接信息（安装引导生成，gitignored）
- `.env.local` — 环境变量（gitignored），模板 `.env.example`；**变量清单以 `docs/standards.md` §11 为唯一权威**，两处必须同步
