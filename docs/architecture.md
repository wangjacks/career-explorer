# Career Explorer — 架构说明

> v2.0.0：三角色统一用户体系（admin / teacher / student）

## 认证体系

- 统一 `users` 表存储三角色账户，bcrypt 哈希密码（`password_hash` 可为 NULL = 未设置密码）
- 登录签发 JWT（jose HS256, 24h，含 role/uid/name），HttpOnly Cookie `auth_token` 传递
- `proxy.ts`（Next.js 16，替代已弃用的 middleware）拦截管理域路由做角色权限校验
- 学生账户由教师导入名单预建（无密码），学生凭学号 + 姓名 + 本班邀请码三要素核验后激活

| 面板 | 路由 | 访问权限 |
|---|---|---|
| 管理面板 | `/dashboard/admin` | admin |
| 教师面板 | `/dashboard/teacher` | teacher |
| 学生面板 | `/dashboard/student` | student |

## 页面路由

| 路由 | 说明 |
|---|---|
| `/` | 首页 |
| `/login` | 登录页（三角色统一） |
| `/activate` | 学生账户激活（学号 + 姓名 + 邀请码三要素核验） |
| `/form/create-profile?step=` | 学生档案创建表单（单路由多步：登录门 → 标签 → 词云 → 评价 → 形象 → 确认 → 完成），登录优先 |
| `/dashboard/admin` | 管理面板（三组两级导航：数据中心 / 用户管理 / 系统设置） |
| `/dashboard/teacher` | 教师面板（三组两级导航：主页 / 数据中心 / 数据管理） |
| `/dashboard/student` | 学生面板（个人信息通览 + 就地修改） |
| `/setup` | 安装引导（首次配置数据库 + 管理员密码） |

## API 路由

### 认证层（proxy 之外，公开）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/auth` | POST / GET / DELETE | 登录 / 会话检测 / 登出 |
| `/api/auth/activate` | POST | 学生账户激活（三要素核验通过后设置密码并自动登录） |

### 安装层（proxy 之外）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/setup` | POST | 安装配置（数据库 + 管理员密码） |
| `/api/setup/status` | GET | 安装状态检查 |
| `/api/setup/test` | POST | 数据库连接测试 |

### 管理域 `/api/manage/*`（proxy 拦截：admin 全放行，teacher 按声明式权限表）

| 路由 | teacher 权限 | 说明 |
|---|---|---|
| `/api/manage/teachers`（含 `/[id]`） | 禁止 | 教师账户 CRUD + 改密 |
| `/api/manage/settings` | 禁止 | 数据源配置读写 |
| `/api/manage/backup` | 禁止 | 备份下载 / 恢复 |
| `/api/manage/test-db` | 禁止 | 数据库连接测试 |
| `/api/manage/classes`（含 `/[id]`、`/[id]/reset-code`） | 全方法 | 班级 CRUD + 邀请码 |
| `/api/manage/students`（含 `/batch-password`） | 全方法 | 学生管理 + 批量改密 |
| `/api/manage/tags`（含 `/batch`） | 全方法 | 预设标签管理（CRUD / 物理删除 / 批量导入 / 排序） |
| `/api/manage/profile-config` | 全方法 | 档案功能配置（自定义标签上限 #94、提交截止时间 #96、上传大小上限 #111） |
| `/api/manage/audit-logs` | 仅 GET | 操作审计只读查询（#110；教师强制限本人记录，查询自身被审计） |
| `/api/manage/storage`（含 `/test`、`/migrate`） | 禁止 | 存储后端管理（#111）：注册表 CRUD + 设默认 + 连通性测试 + 本地→云迁移，均记审计 |
| `/api/manage/export` | 全方法 | Excel/CSV 导出（XLSX 支持原生单元格图片与浮动图片双模式，默认单元格图片） |
| `/api/manage/export-images` | 全方法 | 图片打包导出 |
| `/api/manage/stats`（含 `compare`/`distribution`/`trends`） | 仅 GET | 统计数据 |
| `/api/manage/profiles` | GET + DELETE | 档案列表 |

### 共享域 `/api/shared/*`（不进 proxy，路由自鉴权）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/shared/profile` | GET / POST | GET 会话查询本人档案（含提交截止状态，#96）；POST 仅学生本人会话保存（拒绝显式指定学号；超过提交时限强制 403） |
| `/api/shared/storage-sign` | GET | 文件访问地址签发（#111）：本地后端回显代理路径；云后端按归属记录的 `storage_id` 签发 30 分钟签名 URL；权限校验：学生仅本人、教师仅管辖班级、管理员全量 |

### 其他开放端点（proxy 之外）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/tags` | GET | 预设标签 + 自定义标签上限（#94）+ 提交截止状态（#96）加载（表单流程 + 学生面板） |
| `/api/upload` | POST | 文件上传（头像 / 评价词云图；#111 起按默认后端路由 + 服务端压缩 + 大小上限 + SVG 拒绝） |
| `/api/uploads/[...path]` | GET | 静态文件服务（本地后端的代理路径，含路径穿越防护） |

## 数据库

四表设计（SQLite / MySQL 双适配器，`src/lib/db.ts` 定义 `DbAdapter` 接口）：

- `users` — 统一用户表：`user_code`（学生 12 位 / 教师 8 位 / 管理员 5 位）、`password_hash`、`role`、`name`、`class_id`、学生数据字段（`tags` #94 起为标签名称文本数组、`avatar_url`、`evaluation_url`、`submitted_at`）、`storage_id`（#111：文件所在存储后端，文件级路由）
- `classes` — 班级表（`name`、`invitation_code` 唯一）
- `teacher_classes` — 教师-班级多对多关联
- `tags` — 预设二级标签（`type` category/tag、`parent_id` 层级）；#94 起降级为表单预设项，物理删除，停用机制下线（`active` 列保留）
- `configs_profile` — 档案功能配置键值表（#94/#96/#111：`max_custom_tags`、`submission_deadline`、`max_avatar_size_mb`、`max_evaluation_size_mb`）
- `audit_logs` — 操作审计表（#110）：只追加 + 查询；操作者快照冗余；索引 `created_at` / `actor_id` / `(resource_type, resource_id)`
- `storage_backends` — 存储后端注册表（#111）：内置本地后端（不可删）+ 多个 S3 兼容实例；凭据不入库（走 `.env.local`）；索引 `name` 唯一

完整 Schema 见 `docs/plan-v2.0.0.md`。备份格式 `BackupData`（version 3）：`users` + `classes` + `teacher_classes` + `tags` + `configs_profile`（#94 起）+ `audit_logs`（#110 起）+ `storage_backends`（#111 起，不含凭据；旧备份缺失时保留当前后端表并回填本地后端），含 `password_hash`，不含上传文件。

## 文件存储（#111 对象存储）

- **统一抽象**：`src/lib/storage.ts` 定义 `StorageAdapter`（上传 / 读取 / 删除 / 存在性 / 访问地址签发），文件类型中立；本地实现 `storage-local.ts`（uploads/ 目录）+ S3 兼容实现 `storage-s3.ts`（`@aws-sdk/client-s3`，覆盖腾讯云 COS / 阿里云 OSS / MinIO / AWS S3）
- **多后端注册表**：`storage_backends` 表 + `users.storage_id` 文件级路由；切换默认后端只影响新上传，存量文件按归属后端照常读写；迁移端点幂等（已存在对象跳过）
- **私有读写**：云对象访问一律经 `/api/shared/storage-sign` 签发 30 分钟签名 URL（按角色 + 班级权限校验）；本地后端保持代理路径行为不变；前端经 `useFileUrl` / `StorageImage` 统一解析并缓存签名结果（28 分钟）
- **双端点**：服务端读写（上传/迁移/导出读图）优先内网端点，签名 URL 强制公网端点；对象路径 = `{bucket}/{path_prefix}/{key}`
- **上传约束**：服务端压缩（头像 ≤512×512、词云长边 ≤1024，JPEG 质量 85）、可配置大小上限（默认头像 5MB / 词云 10MB）、唯一命名不覆盖、SVG 显式拒绝（防存储型 XSS）

## 数据流

```
学生端（档案创建）：登录门 → 标签选择（预设 + 自定义，自定义受后台配置上限）→ 词云展示 → 评价词云 → 虚拟形象 → 最终确认（延迟上传）→ 提交完成；已提交学生再进入被引导去面板修改；草稿暂存支持中途刷新后继续/重新开始
学生端（登录态）：登录 → 学生面板通览 → 就地修改（二次确认）
教师端：登录 → 主页（问候+统计）→ 数据中心（概览/大屏/导出）→ 数据管理（列表/学生/班级/标签）
管理端：登录 → 数据中心 → 用户管理（学生/教师/班级/标签）→ 系统设置（数据源/功能设置）
```

## 守护进程

PM2 管理。重启命令：

```bash
PORT=3621 pm2 restart career-app
pm2 save
```

## 配置文件

- `db-config.json` — 数据库连接信息（本地文件，gitignored）
- `.env.local` — 环境变量（必需 `JWT_SECRET`，可选 `FONT_CDN_PREFIX`；#111 起可选 `S3_{后端ID}_ACCESS_KEY` / `S3_{后端ID}_SECRET_KEY` 对象存储凭据；gitignored），模板见 `.env.example`
