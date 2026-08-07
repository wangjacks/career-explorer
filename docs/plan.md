# Career Explorer — v2.0.0 开发计划

> 目标：2026 年 9 月开学前完成测试上线，之后正式发布 v2.0.0

## 设计原则

- **小步提交** — 每个 Issue 独立 commit，独立可回退，不做大跃进式提交
- **安全优先** — 安全漏洞 > 生产事故 > 体验 Bug > 新功能
- **先重构再叠加** — 先拆好 admin 结构，再在其上构建新功能
- **先后端再前端** — API 先行，页面适配
- **迁移即删除** — 旧路由迁移到新路径后直接删除原路径，不保留并存
- **解耦变更** — 路由迁移、认证改造、功能新增分开提交，避免耦合导致回退代价大

---

## 已完成阶段

### Phase 1：安全漏洞修复 ✅

| Issue | 内容 | 状态 |
|---|---|---|
| #15 | `/api/uploads/[...path]` 路径穿越防护 | ✅ PR #23 |
| #26 | CI workflow 未限制 GITHUB_TOKEN 权限 | ✅ PR #27 |

### Phase 2：生产 Bug 修复 ✅

| Issue | 内容 | 状态 |
|---|---|---|
| #8 | 首页 JS chunk 404 缓存问题 | ✅ PR #24 + #30 + Nginx |
| #13 | `layout.tsx` 添加 viewport meta | ✅ PR #24 |
| #14 | `validate-student` 返回 evaluationUrl | ✅ PR #24 |
| #16 | InstallGuard fetch 失败时保持 loading | ✅ PR #24 |

### Phase 3：Admin 组件拆分 ✅

| Issue | 内容 | 状态 |
|---|---|---|
| #17 | `admin/page.tsx` 拆分为 4 个 Tab 子组件 | ✅ PR #28 |

### Phase 4：认证安全重构 ✅

| Issue | 内容 | 状态 |
|---|---|---|
| #18 | bcrypt + JWT HttpOnly Cookie + middleware 统一鉴权 | ✅ PR #31 |

**关键变更：**
- 密码 hash 存储在 `admin-hash.txt` 文件（绕过 dotenv 的 `$` 插值问题）**→ v2.0.0 废弃，迁移到 `users` 表**
- 登录后签发 JWT token，通过 HttpOnly Cookie 传递
- middleware 自动拦截未认证的 `/admin` 和 `/api/admin` 请求

### Phase 5：代码质量与响应式 ✅

| Issue | 内容 | 状态 |
|---|---|---|
| #22 | 空 `catch {}` 补充错误处理 | ✅ 已完成 |
| #21 | 页面响应式断点适配 | ✅ 已完成 |

### Phase 6：数据大屏 ✅

| Issue | 内容 | 状态 |
|---|---|---|
| #19 | 扩展统计 API（时间维度聚合） | ✅ PR #42 |
| #20 | admin Dashboard Tab + recharts 可视化 | ✅ PR #42 |

### Phase 7：SQLite + 备份恢复 ✅

| Issue | 内容 | 状态 |
|---|---|---|
| #45 | SQLite 数据库支持 | ✅ PR #47 |
| #46 | 备份恢复功能 | ✅ PR #47 |

### Phase 8：管理面板增强 ✅

| Issue | 内容 | 状态 |
|---|---|---|
| #38 | Cookie 方案修复（刷新丢失登录） | ✅ PR #41 |
| — | 数据列表标签筛选 + stats 全量标签统计 | ✅ 0458e3b |

---

## v2.0.0 统一用户体系

### 当前状态（0458e3b）

- 单角色（admin），`admin_token` cookie + JWT 认证
- `students` 表 + `profiles` 表（分离设计）
- 路由：`/admin`、`/student`、`/tags`、`/evaluation`、`/avatar`、`/complete`、`/wordcloud`
- `middleware.ts` 保护 `/admin` 和 `/api/admin`
- bcrypt + jose JWT 已就位

### 目标架构

- **三角色**：admin / teacher / student，统一 `users` 表
- **路由重组**：`/dashboard/*`（管理面板）+ `/form/*`（学生完整表单流程）+ `/login`（登录）+ `/register`（学生注册）
- **旧路由清理**：路由迁移后删除原 `/admin` 页面，不保留旧路径
- **权限层级**：admin 可管理教师和学生账户，teacher 可管理学生账户
- **安装引导**：首次安装配置管理员密码
- **班级管理**：邀请码机制
- **标签可配置**：管理面板动态管理标签

### 目标路由结构

```
/dashboard/admin      -- 管理面板（从 /admin 迁移，移除内嵌登录）
/dashboard/teacher    -- 教师面板（新建）
/dashboard/student    -- 学生面板（新建，登录后查看个人信息、提交状态）

/form/student         -- 学生编号校验（从 /student 迁移，查 users 表校验存在性）
/form/tags            -- 标签选择（从 /tags 迁移）
/form/wordcloud       -- 词云展示（从 /wordcloud 迁移，保持表单流程连贯）
/form/evaluation      -- 评价词云上传（从 /evaluation 迁移）
/form/avatar          -- 头像上传（从 /avatar 迁移）
/form/complete        -- 提交完成（从 /complete 迁移）

/login                -- 登录页（新建）
/register             -- 学生注册页（新建，需邀请码）
```

> 学生完整流程全部在 `/form/*` 下：student → tags → wordcloud → evaluation → avatar → complete

### 全局交互设计

- **右上角用户菜单（全局组件，出现在每一页）**：
  - 未登录时：显示「登录」按钮，点击跳转 `/login`
  - 已登录时：显示用户信息（姓名/编号），点击展开下拉菜单：
    - 「个人信息」→ 跳转对应角色的 dashboard（`/dashboard/admin`、`/dashboard/teacher`、`/dashboard/student`）
    - 「退出登录」→ 清除 session
- **`/form/*` 默认即为快速提交模式**（无需登录，但必须已有用户记录）
- **快速提交校验流程**：输入学生编号（12 位 `user_code`）→ 查 `users` 表是否存在 `role=student` 且 `user_code` 匹配的记录 → 存在则继续 → 不存在则拒绝
- **快速提交已有数据处理**：校验通过后，若该学生已有提交数据（`submitted_at` 不为空），弹出选择对话框：
  - 「恢复历史记录」— 从数据库加载已有数据（标签、头像、评价词云），继续编辑
  - 「从空白开始」— 清除本地缓存，以空白状态重新填写（提交后覆盖旧数据）
  - 「取消」— 返回上一步
  - 若无已有数据，直接清除本地缓存，按空白状态继续

### 关键技术决策

- **认证**：bcrypt 哈希密码 + jose JWT，`auth_token` httpOnly cookie
- **三角色**：admin / teacher / student，proxy.ts 层做角色权限检查
- **Next.js 16**：用 `proxy.ts` 替代 `middleware.ts`（已弃用）
- **数据库 — 四表设计**：
  - **废弃 `students` 和 `profiles` 两张旧表**，合并为 `users` 表
  - `users` 表统一存储用户身份 + 学生提交数据：
    - 主键：`id`（自增）
    - 编号字段：`user_code`（用户唯一编号，与主键无关，**同时作为登录标识**）
      - 学生：12 位数字
      - 教师：8 位数字
      - 管理员：5 位数字（从 10001 起自增）
    - 身份字段：`password_hash`(nullable), `role`, `name`, `class_id`
    - 学生数据字段：`tags`(JSON ID数组), `avatar_url`, `evaluation_url`, `submitted_at`
  - 学生账户可通过 `/register` 页面自行注册（需邀请码），或由管理员/教师在后台创建
  - 教师账户只能由管理员在后台创建
  - `password_hash` 可为 NULL（未设置密码）
  - 学生后续可「设置密码」升级为完整账户（补填 `password_hash`）
- **数据权限 — 教师权限**：
  - 教师可自由创建班级，无需 admin 分配
  - 教师可管理所有班级的学生（不限自己创建的班级）
  - `teacher_classes` 关联表记录教师创建的班级（多对多）
- **标签设计 — 全局共享 + 二级层级**：
  - 新建 `tags` 表，全局共享（所有班级使用同一套标签）
  - 二级层级结构（与当前 `tagData.ts` 一致）：
    - 父级：分类（如「兴趣」「技能」「性格」）
    - 子级：具体标签（如「阅读」「编程」「认真」）
  - `tags` 表字段：`id`, `name`, `category`(父类名), `category_order`, `sort_order`
  - `users.tags` 存储标签 ID 数组（如 `[1,5,12]`），确保改名/删除后历史数据可追溯
- **学生表单**：独立于 dashboard，全部放在 `/form/*` 子路由，默认快速提交模式
- **安装引导**：首次安装强制配置管理员密码（`user_code` 自动生成，初始为 10001）
- **备份恢复**：`BackupData` 格式随四表设计更新（`users`+`classes`+`teacher_classes`+`tags`），备份包含 `password_hash`，恢复后用户可直接使用原密码登录；不包含上传文件（头像/评价词云等文件系统数据）
- **学生端双模式**：快速通道（已有账户记录，无需登录）+ 登录后（`/dashboard/student` 查看个人信息）
- **班级邀请码**：仅在 `/register` 学生注册时要求填写，用于绑定班级；快速提交模式不涉及邀请码

### 数据库 Schema 完整定义

```sql
-- 班级表
CREATE TABLE classes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  invitation_code TEXT  NOT NULL UNIQUE,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 统一用户表（替代 students + profiles）
CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_code       TEXT    NOT NULL UNIQUE,        -- 学生12位 / 教师8位 / 管理员5位(从10001起)
  password_hash   TEXT,                           -- NULL = 未设置密码
  role            TEXT    NOT NULL,               -- 'admin' | 'teacher' | 'student'
  name            TEXT    NOT NULL,
  class_id        INTEGER,                        -- 仅学生使用，FK → classes.id
  tags            TEXT,                           -- JSON 数组，如 [1,5,12]，仅学生使用
  avatar_url      TEXT,
  evaluation_url  TEXT,
  submitted_at    TEXT,                           -- 最近提交时间
  created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL
);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_class_id ON users(class_id);
CREATE INDEX idx_users_user_code ON users(user_code);

-- 教师-班级关联表（多对多）
CREATE TABLE teacher_classes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id  INTEGER NOT NULL,                  -- FK → users.id
  class_id    INTEGER NOT NULL,                  -- FK → classes.id
  created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(teacher_id, class_id),
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (class_id)   REFERENCES classes(id) ON DELETE CASCADE
);
CREATE INDEX idx_teacher_classes_teacher ON teacher_classes(teacher_id);
CREATE INDEX idx_teacher_classes_class ON teacher_classes(class_id);

-- 标签表（全局共享 + 班级专属）
CREATE TABLE tags (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  category      TEXT    NOT NULL,                -- 父分类名（如「兴趣」「技能」「性格」）
  class_id      INTEGER,                         -- NULL = 全局标签，非NULL = 班级专属
  category_order INTEGER NOT NULL DEFAULT 0,     -- 分类排序
  sort_order    INTEGER NOT NULL DEFAULT 0,      -- 标签排序
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_tags_name_class ON tags(name, class_id);
CREATE INDEX idx_tags_category_order ON tags(category_order, sort_order);
```

**表间关系：**
- `users.class_id` → `classes.id`（学生所属班级）
- `teacher_classes.teacher_id` → `users.id`（教师创建的班级）
- `teacher_classes.class_id` → `classes.id`
- `tags.class_id` → `classes.id`（NULL 表示全局标签）
- `users.tags` 存储标签 ID 的 JSON 数组（如 `[1,5,12]`）

### 执行计划（每步独立 commit）

| 步骤 | 内容 | 依赖 | 说明 |
|------|------|------|------|
| 1 | 纯路由迁移 + 删除旧路由 | 无 | `/admin` → `/dashboard/admin`（迁移后删除原 `/admin`），学生页面 → `/form/*`（含 wordcloud，迁移后删除原路径）；沿用 `admin_token`，不改认证逻辑；middleware matcher 同步更新为 `/dashboard/admin/:path*`；**迁移后必须验证：登录 → 进入面板 → 刷新页面 → cookie 持久有效（不丢失登录态）** |
| 2 | DB Schema 重构 | 无 | 新增 `users`（废弃 `students` + `profiles`）、`classes`、`teacher_classes`、`tags`（全局二级标签）表；`tags` 表预填充当前标签（从 `tagData.ts` 导入），旧 `profiles.tags` 名称→ID 转换后迁移到 `users.tags`；旧数据迁移时按角色生成 `user_code`（学生 12 位、管理员 5 位从 10001 起）；废弃 `admin-hash.txt`，管理员密码写入 `users` 表；**同步更新所有引用旧表的 API 路由**（`/api/admin/*`、`/api/profile`、`/api/validate-student`） |
| 3 | 认证系统重构 | 2 | `auth.ts` 支持三角色签发；`middleware.ts` → `proxy.ts` 角色权限；cookie 从 `admin_token` 改为 `auth_token`；**同步更新管理面板前端读取 `auth_token`** |
| 4 | 安装引导改造 | 2, 3 | setup 流程增加管理员密码配置步骤 |
| 5 | 登录页 + 学生注册页 | 2, 3 | 新建 `/login`（登录）+ `/register`（学生自助注册，需邀请码绑定班级）；两页底部互相跳转；登录标识为 `user_code`；邀请码验证 API 随本步骤实现，邀请码管理 UI 在步骤 8 |
| 6 | 全局右上角用户菜单 | 3 | 每一页右上角：未登录显示登录按钮，已登录显示用户信息下拉菜单（个人信息+退出登录） |
| 7 | 标签可配置化 | 2, 3 | 管理面板标签管理（增删改分类+标签）+ 动态加载替代硬编码 |
| 8 | 班级管理 | 2, 3 | 邀请码生成/管理 + 班级 CRUD；教师可自由创建班级，admin 可管理所有班级 |
| 9 | 学生面板 | 3, 6, 8 | `/dashboard/student` 查看个人信息、提交状态（标签/头像/评价词云是否已提交及提交时间）、班级信息；支持直接修改已提交数据（修改时需二次确认） |
| 10 | 管理面板 UI + 批量操作 | 3, 7, 8 | 页面：admin 用户管理（教师+学生）+ 班级概览统计（各班学生总数/已提交/未提交/提交率）+ 教师管理 + 密码修改；teacher 班级创建 + 学生管理（全部班级）+ 学生账户创建/批量导入 + 密码修改；支持图形化批量管理（创建/导入/删除）和批量修改密码；沿用现有 `/api/admin/*` 路由结构，仅扩展接口支持新角色 |
| 11 | API 路由重组 + 备份恢复改造 | 10 | `/api/admin/*` 重组为角色化路由（`/api/dashboard/admin/*` 管理员专属 + `/api/dashboard/teacher/*` 教师专属 + `/api/shared/*` 共用），与页面路由 `/dashboard/*` 对称；**同步更新所有前端 API 调用路径**；备份恢复：`BackupData` 格式从 `students`+`profiles` 改为 `users`+`classes`+`teacher_classes`+`tags`，备份包含 `password_hash`（恢复后用户密码不变） |

### 执行策略

1. **路由迁移和认证改造彻底分开** — 步骤 1 只做路径变更，不碰认证逻辑
2. **每个 commit 独立可构建** — build 通过后才做下一步
3. **路由迁移即删除旧路径** — 步骤 1 迁移完成后直接删除原 `/admin`、`/student` 等旧路径，不保留并存
4. **DB 重构一步到位** — 步骤 2 直接废弃 `students` 表，旧数据迁移到 `users`，不保留双表并存
5. **步骤构建保障范围**：
   - 步骤 2：同步更新所有引用旧表的 API 路由（`/api/admin/*`、`/api/profile`、`/api/validate-student`）
   - 步骤 3：同步更新管理面板前端读取 `auth_token`
   - 步骤 11：同步更新所有前端 API 调用路径
6. **本地逐 commit 测试** — 每个 commit 完成后本地验证构建通过

### 分支与合并策略

按阶段分组，每阶段一个特性分支，PR 合并到 dev：

| 阶段 | 分支名 | 包含步骤 | 基分支 | PR 到 |
|------|--------|---------|--------|-------|
| 基础迁移 | `feat/v2-foundation` | 1, 2, 3 | dev | dev |
| 功能搭建 | `feat/v2-features` | 4, 5, 6, 7, 8 | dev（已含 foundation） | dev |
| 面板与交互 | `feat/v2-panels` | 9, 10 | dev（已含 features） | dev |
| API 重组 | `feat/v2-api-reorg` | 11 | dev（已含 panels） | dev |

**合并方式**：PR 使用 `--no-ff` 合并，保留每个步骤的独立 commit 历史。

**Issue 管理**：每个阶段开始前创建对应的 GitHub Issue，绑定 v2.0.0 milestone，PR 关联到对应 Issue：

| 阶段 | Issue 标题（建议） | 绑定 Milestone |
|------|-------------------|----------------|
| 基础迁移 | `v2.0.0: 基础迁移（路由迁移 + DB重构 + 认证重构）` | v2.0.0 |
| 功能搭建 | `v2.0.0: 功能搭建（安装引导 + 登录注册 + 用户菜单 + 标签配置 + 班级管理）` | v2.0.0 |
| 面板与交互 | `v2.0.0: 面板与交互（学生面板 + 管理面板UI）` | v2.0.0 |
| API 重组 | `v2.0.0: API 重组 + 备份恢复改造` | v2.0.0 |

---

## 待讨论（v2.0.0 范围外）

- 开发者面板 `/dev`（DB 配置迁移、健康检查）
- WebAuthn Passkey 登录
- API 容错降级（try-catch + 降级数据）
- 健康检查系统 + 前端故障遮罩
